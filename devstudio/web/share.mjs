// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Share links: a production build of a project's app, public, at https://s-<id>.<preview domain>/.
//
//   build(id)          `npx ng build --configuration production` in the container, then the built
//                      files (the application builder's browser/ folder) copied out as a tar stream.
//   publish(id, files) writes them to <dir>/<id>/v-<stamp>/ with runtime-config/share.json, then points
//                      <dir>/<id>/current at that folder (a symlink swapped with rename: atomic), and
//                      deletes the older folders.
//   save(id, files)    with an object store: the build's tar, gzipped, as shares/<id>.tar.gz.
//   restore(id)        with an object store: when this host has no files for the share, gets that tar
//                      and publishes it again. Returns 'present', 'restored' or 'none' (no copy saved).
//   remove(id)         the whole <dir>/<id>/ folder, and shares/<id>.tar.gz. Caddy then answers
//                      "This link is not active."
//   serve(...)         laptop mode only: the same files at http://s-<id>.localhost:<port>/. On a server
//                      Caddy serves them (infra/core/Caddyfile, the "share" snippet) from the same folder,
//                      mounted read-only.
//
// Caddy serves the files from this host's disk (DEVSTUDIO_DATA/shares), and never asks web for them.
// So the copy in the object store (S3 when DEVSTUDIO_S3_BUCKET is set) is what makes a share survive a
// new host or a lost disk: on start, server.mjs restores every share whose record says it is on and
// whose files are not here (app.mjs restoreShares). The page's project load restores a missing one
// too, and so does laptop serving. Without an object store the files are on this host only, as before.
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, renameSync, statSync, realpathSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { dirname, join, sep, extname, normalize } from 'node:path';
import { parseTar } from './github.mjs';

const OUT = '/tmp/ds-share';
/** Object key of a share's saved build. */
export const shareKey = (id) => `shares/${id}.tar.gz`;
// A built app is bigger than its source: allow more than a push does.
export const SHARE_LIMITS = { files: 5000, fileBytes: 30 << 20, totalBytes: 150 << 20 };
export const SHARE_OFF_TEXT = 'This link is not active.';

/** A share that cannot be made, with words for the partner and, for a failed build, the build's last lines. */
export class ShareError extends Error {
  constructor(message, log = '') { super(message); this.log = log; }
}

async function collect(child, max) {
  const out = [];
  let n = 0, err = '';
  child.stderr?.on('data', (c) => { err += c; });
  const closed = new Promise((r) => child.on('close', (code) => r(code)));
  for await (const c of child.stdout) {
    n += c.length;
    if (n > max) { child.kill?.(); throw new ShareError(`The built app is larger than ${max >> 20} MB.`); }
    out.push(c);
  }
  return { buf: Buffer.concat(out), code: await closed, err };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

/**
 * @param objects  the object store (objects.mjs or s3.mjs) for a copy of each build, or null to keep
 *                 the files on this host only
 */
export function createShares({ dir, driver, fetchImpl = fetch, apiUrl = 'https://ingress.ambivo.com/', log = console.log, objects = null }) {
  mkdirSync(dir, { recursive: true });
  const base = (id) => join(dir, id);
  const current = (id) => join(base(id), 'current');

  /** Build the app in the container and copy the built files out. Throws ShareError. */
  async function build(id) {
    try { await driver.sh(id, 'test -f /work/app/package.json'); }
    catch { throw new ShareError('There is no app to share yet.'); }
    try {
      // The build goes to its own folder, so the project's dist/ and the running Preview are untouched.
      await driver.sh(id,
        `rm -rf ${OUT} && { [ -d node_modules ] || npm install --no-audit --no-fund; } > /tmp/share.log 2>&1 && ` +
        `npx ng build --configuration production --output-path ${OUT} >> /tmp/share.log 2>&1`, { workdir: '/work/app' });
    } catch {
      const out = await driver.sh(id, 'tail -n 30 /tmp/share.log').then((o) => o.stdout, () => '');
      throw new ShareError('The app did not build, so it cannot be shared. Ask the assistant to fix it, and share this:', out);
    }
    // The application builder writes browser/ (and server/ for server rendering, never shared).
    const child = driver.exec(id, ['sh', '-c',
      `d=${OUT}/browser; [ -d "$d" ] || d=${OUT}; [ -f "$d/index.html" ] || exit 3; exec tar --format=pax -C "$d" -cf - .`],
    { interactive: false });
    const { buf, code, err } = await collect(child, SHARE_LIMITS.totalBytes + (16 << 20));
    if (code === 3) throw new ShareError('The build finished without an index.html. Ask the assistant to check the build output.');
    if (code !== 0) throw new ShareError(`Dev Studio could not copy the built app. ${String(err).slice(-200)}`.trim());
    let files;
    try { files = parseTar(buf, SHARE_LIMITS); } catch (e) { throw new ShareError(`The built app is too large to share. ${e.message}`); }
    if (!files.some((f) => f.path === 'index.html')) throw new ShareError('The build finished without an index.html. Ask the assistant to check the build output.');
    // The tar as it came out, for save().
    Object.defineProperty(files, 'tar', { value: buf });
    return files;
  }

  /** Write the files as the new version of the share, then switch `current` to it in one step. */
  function publish(id, files) {
    const localCfg = files.find((f) => f.path === 'runtime-config/localhost.json');
    if (!localCfg) throw new ShareError('The app has no public/runtime-config/localhost.json, so the link would not know where the Ambivo API is. Ask the assistant to add it.');
    let cfg;
    try { cfg = JSON.parse(localCfg.content.toString('utf8')); } catch { throw new ShareError('The app\'s runtime-config/localhost.json is not valid JSON. Ask the assistant to fix it.'); }
    // The share host relays /api/* to the Ambivo API (Caddy), like the Preview does.
    const shareCfg = { ...cfg, apiUrl: '/api/' };

    mkdirSync(base(id), { recursive: true });
    const ver = `v-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const vdir = join(base(id), ver);
    try {
      for (const f of files) {
        const dest = normalize(join(vdir, f.path));
        if (!dest.startsWith(vdir + sep)) continue;   // parseTar already refuses .. and absolute names
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, f.content, { mode: 0o644 });
      }
      mkdirSync(join(vdir, 'runtime-config'), { recursive: true });
      writeFileSync(join(vdir, 'runtime-config', 'share.json'), `${JSON.stringify(shareCfg, null, 2)}\n`, { mode: 0o644 });
      // Relative target: it resolves the same inside Caddy's read-only mount.
      const tmp = join(base(id), `.current-${randomBytes(4).toString('hex')}`);
      symlinkSync(ver, tmp);
      renameSync(tmp, current(id));
    } catch (e) {
      rmSync(vdir, { recursive: true, force: true });
      throw e;
    }
    for (const name of readdirSync(base(id))) {
      if (name !== ver && name !== 'current') rmSync(join(base(id), name), { recursive: true, force: true });
    }
    log(`share ${id}: ${files.length} files in ${ver}`);
    return { version: ver, files: files.length };
  }

  /** Keep the build's tar in the object store. Returns false when there is no object store. */
  async function save(id, files) {
    if (!objects || !files?.tar) return false;
    const gz = gzipSync(files.tar, { level: 6 });
    await objects.put(shareKey(id), gz, { contentType: 'application/gzip' });
    return true;
  }

  const restoring = new Map();   // id -> promise of the restore in progress
  /** Publish the saved build again when this host has no files for it. */
  function restore(id) {
    if (exists(id)) return Promise.resolve('present');
    if (!objects) return Promise.resolve('none');
    if (restoring.has(id)) return restoring.get(id);
    const p = (async () => {
      const o = await objects.get(shareKey(id));
      if (!o) return 'none';
      const files = parseTar(gunzipSync(o.body), SHARE_LIMITS);
      if (exists(id)) return 'present';   // shared again here while the copy was on its way
      publish(id, files);
      log(`share ${id}: restored from storage`);
      return 'restored';
    })().finally(() => restoring.delete(id));
    restoring.set(id, p);
    return p;
  }

  async function remove(id) {
    rmSync(base(id), { recursive: true, force: true });
    if (objects) await objects.delete(shareKey(id));
  }

  /** True when this host has the share's files. */
  function exists(id) {
    return existsSync(join(current(id), 'index.html'));
  }

  // ---- laptop mode: serve http://s-<id>.localhost:<port>/ ----------------------------------------

  function notActive(res) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not active</title><body style="font:16px/1.5 system-ui,sans-serif;margin:32px 16px"><h2>${SHARE_OFF_TEXT}</h2></body>`);
  }

  async function relay(req, res, url) {
    const target = new URL(url.pathname.replace(/^\/api\//, '') + url.search, apiUrl);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      // The visitor's Origin and hop-by-hop headers are replaced; cookies go without Dev Studio's own.
      if (['host', 'cookie', 'origin', 'referer', 'connection', 'content-length', 'accept-encoding'].includes(k)) continue;
      headers[k] = v;
    }
    const cookies = String(req.headers.cookie || '').split(/;\s*/).filter((c) => c && !/^ds_[a-z]+=/.test(c));
    if (cookies.length) headers.cookie = cookies.join('; ');
    headers.origin = 'https://apps.ambivo.com';
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let r;
    try {
      r = await fetchImpl(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: 'manual' });
    } catch (e) {
      log(`share relay: ${e.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'The Ambivo API could not be reached.' }));
    }
    const out = {};
    r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(k)) out[k] = v; });
    const setCookie = r.headers.getSetCookie?.() ?? [];
    if (setCookie.length) out['set-cookie'] = setCookie;
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  }

  async function serve(req, res, id, url, { on = false } = {}) {
    // `on`: the record says the link is on, so a missing build is put back from storage first.
    if (!exists(id) && on) await restore(id).catch((e) => log(`share ${id}: restoring: ${e.message}`));
    if (!exists(id)) return notActive(res);
    if (url.pathname.startsWith('/api/')) return relay(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let path = url.pathname;
    if (/^\/runtime-config\/s-[^/]+\.json$/.test(path)) path = '/runtime-config/share.json';
    let root;
    try { root = realpathSync(current(id)); } catch { return notActive(res); }
    let file;
    try { file = normalize(join(root, decodeURIComponent(path))); } catch { file = ''; }
    const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
    if (!file.startsWith(root + sep) || !isFile(file)) file = join(root, 'index.html');   // the app's own routes
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': file.endsWith('index.html') || file.endsWith('share.json') ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  }

  return { dir, build, publish, save, restore, remove, exists, serve };
}
