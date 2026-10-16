// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// The local driver: Dev Studio inside the Ambivo dev container, on the maker's own computer.
//
// The Docker driver gives every project its own container, because the hosted Dev Studio runs many
// partners on one server. In the dev container there is one maker and no Docker, and the container is
// already the wall around their computer. So this driver runs each command right here, as the
// terminal does, and keeps each project in its own folder:
//
//   /work/<app-name>-<id>    the project: app/, brief/, as /work is in a project's container
//
// The rest of Dev Studio speaks of /work as the project's own folder (the prompts, the phase files,
// the brief). This driver turns that /work into the project's folder in every path, command and prompt
// it is given, so the code shared with the hosted Dev Studio stays as it is.
//
// One preview at a time: every project's preview uses port 4200, so starting one stops the other.
// Same operations as drivers/docker.mjs; the volume ones are hosted-only (saving to storage).
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';
import { mkdir, readFile as fsRead, writeFile as fsWrite, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import http from 'node:http';
import { PREVIEW_PORT, EXPORT_EXCLUDES } from './docker.mjs';

export { PREVIEW_PORT };
const ID = /^[a-f0-9]{12}$/;
const VIRTUAL = '/work';
// A folder Dev Studio made: "<slug>-<id>" or "<id>". Anything else (a renamed folder with spaces or $) is not used.
const FOLDER = /^(?:[a-z0-9-]{1,40}-)?[a-f0-9]{12}$/;
// Deleted projects are moved here, not erased: they are folders on the maker's computer.
export const TRASH = '.devstudio-trash';

/** "Stock Count!" -> "stock-count"; empty when nothing usable is left. */
export function slug(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/**
 * Turns Dev Studio's /work into `dir` wherever /work stands as a path of its own: "/work", "/work/app",
 * "cd /work &&". A path that only contains it ("/home/x/work", "/workshop") is left alone.
 */
export function translate(text, dir) {
  if (typeof text !== 'string') return text;
  const own = dir.startsWith(`${VIRTUAL}/`) ? dir.slice(VIRTUAL.length) : null;   // "/stock-<id>" when root is /work
  return text.replace(/(^|[^\w.\/~-])\/work(?=$|[^\w.-]|\.(?:\s|$))/g, (match, before, offset) => {
    // Already this project's own path (/work/stock-<id>/...): leave it, so translating twice changes nothing.
    if (own && text.startsWith(own, offset + before.length + VIRTUAL.length)
        && /^($|[^\w.-])/.test(text.slice(offset + before.length + VIRTUAL.length + own.length))) return match;
    return `${before}${dir}`;
  });
}

/** The environment a command gets: the container's own, without Dev Studio's settings, plus `env`. */
function childEnv(env) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVSTUDIO_')));
  return { ...base, ...env };
}

/** A stand-in for a child process whose stdin input is translated before it is written. */
function wrap(child, dir) {
  const stdin = child.stdin && {
    write: (data, ...rest) => child.stdin.write(typeof data === 'string' ? translate(data, dir) : data, ...rest),
    end: (data, ...rest) => child.stdin.end(typeof data === 'string' ? translate(data, dir) : data, ...rest),
    on: (...a) => child.stdin.on(...a),
  };
  return {
    stdin, stdout: child.stdout, stderr: child.stderr, pid: child.pid,
    on: (...a) => { child.on(...a); return undefined; },
    once: (...a) => { child.once(...a); return undefined; },
    kill: (sig) => child.kill(sig),
  };
}

/**
 * @param root  the folder projects live in (the maker's folder, mounted at /work)
 */
export function createLocalDriver({ root = '/work', previewPort = PREVIEW_PORT } = {}) {
  const run = promisify(execFile);
  const folders = new Map();   // id -> folder name under root
  const detached = new Map();  // id -> [child, ...] started with sh(..., { detach: true })
  let previewOwner = null;     // the id whose preview holds the port

  function checkId(id) {
    if (!ID.test(String(id))) throw new Error(`not a project id: ${id}`);
  }

  /** The project's folder, found by its id; a project not made here yet gets a folder named by id. */
  async function dirOf(id) {
    checkId(id);
    if (!folders.has(id)) {
      let names = [];
      try { names = await readdir(root); } catch { /* no root yet: create makes it */ }
      const found = names.find((n) => FOLDER.test(n) && (n === id || n.endsWith(`-${id}`)));
      if (found) folders.set(id, found);
      else return join(root, id);
    }
    return join(root, folders.get(id));
  }

  /** dirOf without waiting, for exec. */
  function dirOfNow(id) {
    checkId(id);
    if (!folders.has(id)) {
      let names = [];
      try { names = readdirSync(root); } catch { /* no root yet */ }
      const found = names.find((n) => FOLDER.test(n) && (n === id || n.endsWith(`-${id}`)));
      if (!found) return join(root, id);
      folders.set(id, found);
    }
    return join(root, folders.get(id));
  }

  async function exists(path) {
    try { await stat(path); return true; } catch { return false; }
  }

  async function create(id, _image, { name } = {}) {
    checkId(id);
    if (!(await exists(await dirOf(id)))) {
      const s = slug(name);
      folders.set(id, s ? `${s}-${id}` : id);
    }
    await mkdir(await dirOf(id), { recursive: true });
  }

  /**
   * The folder is the project; nothing to start. A missing folder is never made again empty: the maker
   * most likely started Dev Studio from another folder, and the app's files are there.
   */
  async function ensureRunning(id) {
    const dir = await dirOf(id);
    if (await exists(dir)) return { state: 'running', sessionKept: true };
    throw new Error(`This app's folder is not in the folder Dev Studio was started from. Start Dev Studio from the folder that holds ${folders.get(id) ?? `the folder ending in ${id}`}.`);
  }

  /** Stops the project's detached commands; resolves once they have exited (SIGKILL after 5 s). */
  function stopDetached(id) {
    const children = detached.get(id) ?? [];
    detached.delete(id);
    if (previewOwner === id) previewOwner = null;
    return Promise.all(children.map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      // Each detached command leads its own process group, so npx and ng serve under it stop too.
      try { process.kill(-child.pid, 'SIGTERM'); } catch { clearTimeout(timer); resolve(); }
    })));
  }

  async function stop(id) { checkId(id); await stopDetached(id); }

  async function remove(id) {
    await stopDetached(id);
    const dir = await dirOf(id);
    if (!(await exists(dir))) { folders.delete(id); return; }
    const bin = join(root, TRASH);
    await mkdir(bin, { recursive: true });
    await rename(dir, join(bin, `${folders.get(id) ?? id}-${Date.now()}`));
    folders.delete(id);
  }

  /** Runs a command in the project's folder and streams it. /work in argv and stdin means that folder. */
  function exec(id, argv, { env = {}, workdir, interactive = true } = {}) {
    // The caller needs the child now, so the folder is found without waiting.
    const dir = dirOfNow(id);
    const cwd = workdir ? translate(workdir, dir) : dir;
    const [cmd, ...args] = argv.map((a) => translate(a, dir));
    // stdin stays a pipe either way: `interactive` only matters to `docker exec -i`.
    const child = spawn(cmd, args, { cwd, env: childEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    return wrap(child, dir);
  }

  /** A short shell command in the project's folder; resolves with { stdout }, rejects on a non-zero exit. */
  async function sh(id, cmd, { detach = false, workdir } = {}) {
    const dir = await dirOf(id);
    const cwd = workdir ? translate(workdir, dir) : dir;
    const line = translate(cmd, dir);
    if (detach) {
      // The preview: only one project's app can hold the port, so the last one asked for wins.
      if (line.includes(`--port ${previewPort}`)) {
        // The old app must let go of the port first, or the new one fails and the old one answers for it.
        if (previewOwner && previewOwner !== id) await stopDetached(previewOwner);
        previewOwner = id;
      }
      const child = spawn('sh', ['-c', line], { cwd, env: childEnv({}), detached: true, stdio: 'ignore' });
      child.unref();
      child.on('exit', () => {
        const list = (detached.get(id) ?? []).filter((c) => c !== child);
        if (list.length) detached.set(id, list); else detached.delete(id);
      });
      detached.set(id, [...(detached.get(id) ?? []), child]);
      return { stdout: '' };
    }
    return run('sh', ['-c', line], { cwd, env: childEnv({}), maxBuffer: 1 << 20 });
  }

  async function writeFile(id, path, content) {
    const file = translate(path, await dirOf(id));
    await mkdir(dirname(file), { recursive: true });
    await fsWrite(file, content);
  }

  /** A file from the project as a Buffer, or null when it is not there. Small files only (4 MB). */
  async function readFile(id, path) {
    try {
      const file = translate(path, await dirOf(id));
      if ((await stat(file)).size > (4 << 20)) return null;
      return await fsRead(file);
    } catch { return null; }
  }

  async function previewTarget(id) { checkId(id); return `127.0.0.1:${previewPort}`; }

  /** True when this project's preview holds the port and answers. Another project's app does not count. */
  function previewReady(id) {
    if (previewOwner !== id) return Promise.resolve(false);
    return new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: previewPort, path: '/', timeout: 2000 }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  function exportZip(id) {
    const x = [...EXPORT_EXCLUDES.flatMap((p) => [p, `${p}/*`, `*/${p}`, `*/${p}/*`]), '*.env*']
      .map((p) => `"${p}"`).join(' ');
    return exec(id, ['sh', '-c', `cd /work && zip -qr - . -x ${x}`], { interactive: false });
  }

  function exportTar(id) {
    const x = EXPORT_EXCLUDES.map((p) => `--exclude='${p}'`).join(' ');
    return exec(id, ['sh', '-c', `if [ -d /work/app ]; then cd /work/app; else cd /work; fi; exec tar --format=pax -cf - ${x} .`], { interactive: false });
  }

  async function hasVolume(id) { return exists(await dirOf(id)); }
  function hostedOnly() { throw new Error('Saving a project to storage works in the hosted Dev Studio only.'); }

  async function isRunning(id) { return (detached.get(id) ?? []).length > 0; }

  return {
    kind: 'local', serverMode: false, root,
    isRunning, isCurrent: async () => true, stop, create, ensureRunning, recreate: async () => {}, remove,
    exec, sh, writeFile, readFile, previewTarget, previewReady, exportZip, exportTar, hasVolume,
    exportVolume: hostedOnly, importVolume: hostedOnly,
    dirOf,
  };
}
