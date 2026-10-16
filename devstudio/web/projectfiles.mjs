// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// A project's files and Claude Code session, saved to the object store so another server can take
// the project over:
//
//   projects/<id>/work.tar.gz     /work               the app, including its .git history
//   projects/<id>/claude.tar.gz   /home/dev/.claude   Claude Code's sessions, for --resume
//
// What /work leaves out (VOLUME_EXCLUDES in drivers/docker.mjs): node_modules, dist, .angular and
// coverage, which `npm install` and a build make again. The download zip leaves out more (.git,
// .claude, .env files) because it goes to someone; this copy is the project itself, so it keeps
// them. The shared npm cache volume stays on each server: it is only a cache.
//
// save(id): after each finished message (app.mjs). The tar is gzipped here (mtime 0, so the same
// files give the same bytes), hashed, and uploaded only when it changed since this server last
// saved it. One save per project at a time; a save asked for while one runs runs once after it.
// restore(id): when a project is opened on a server that has no volume for it, before the first
// message or preview. Returns 'present' (nothing to do), 'restored', or 'none' (nothing saved).
import { createGzip, createGunzip } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { ConflictError } from './objects.mjs';

export const PARTS = ['work', 'claude'];
export const tarKey = (id, part) => `projects/${id}/${part}.tar.gz`;

/** Resolves when a driver child process exits. tar's exit 1 ("a file changed while it was read") is fine. */
function exited(child, what) {
  return new Promise((resolve, reject) => {
    let err = '';
    child.stderr?.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 || code === 1 ? resolve(code) : reject(new Error(`${what}: exit ${code} ${err.slice(-300)}`.trim()))));
  });
}

export function createProjectFiles({ objects, driver, image, tmpDir, log = console.log }) {
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const lastHash = new Map();   // `${id}/${part}` -> sha256 of the last upload from this server
  const running = new Map();    // id -> promise of the save in progress
  const again = new Set();      // ids whose save was asked for while one ran

  /** Export one volume to a gzip temp file. Returns { file, size, sha256 }. */
  async function exportPart(id, part) {
    const file = join(tmpDir, `${id}-${part}-${randomBytes(4).toString('hex')}.tar.gz`);
    const hash = createHash('sha256');
    const child = driver.exportVolume(id, part, image);
    const done = exited(child, `export ${part}`);
    const tap = new Transform({ transform(c, _e, cb) { hash.update(c); cb(null, c); } });
    try {
      await pipeline(child.stdout, createGzip({ level: 6 }), tap, createWriteStream(file, { mode: 0o600 }));
      await done;
    } catch (err) { try { unlinkSync(file); } catch {} throw err; }
    return { file, size: statSync(file).size, sha256: hash.digest('hex') };
  }

  /**
   * @param onlyIfMissing  migration: upload only when there is no saved copy, and never replace one
   */
  async function saveNow(id, { onlyIfMissing = false } = {}) {
    let uploaded = 0;
    for (const part of PARTS) {
      if (onlyIfMissing && (await objects.head(tarKey(id, part)))) continue;
      const t = await exportPart(id, part);
      try {
        if (lastHash.get(`${id}/${part}`) === t.sha256) continue;
        try {
          await objects.putFile(tarKey(id, part), t.file, { size: t.size, sha256: t.sha256, ...(onlyIfMissing ? { ifNoneMatch: '*' } : {}) });
        } catch (err) {
          if (onlyIfMissing && err instanceof ConflictError) continue;   // another server saved it first
          throw err;
        }
        lastHash.set(`${id}/${part}`, t.sha256);
        uploaded += t.size;
      } finally { try { unlinkSync(t.file); } catch {} }
    }
    return uploaded;
  }

  function save(id, opts) {
    if (running.has(id)) { again.add(id); return running.get(id); }
    const p = (async () => {
      try {
        do {
          again.delete(id);
          const n = await saveNow(id, opts);
          if (n) log(`project ${id}: saved files (${Math.round(n / 1024)} KB)`);
        } while (again.has(id));
      } finally { running.delete(id); }
    })();
    running.set(id, p);
    return p;
  }

  async function restore(id) {
    if (await driver.hasVolume(id)) return 'present';
    if (!(await objects.head(tarKey(id, 'work')))) return 'none';
    try {
      for (const part of PARTS) {
        const body = await objects.getStream(tarKey(id, part));
        if (!body) continue;   // files saved, but no session yet: the assistant starts a new conversation
        const child = driver.importVolume(id, part, image);
        const done = exited(child, `restore ${part}`);
        await pipeline(body, createGunzip(), child.stdin);
        await done;
      }
    } catch (err) {
      // Half a restore would look like a complete project next time. Take it away and try again then.
      await driver.remove(id).catch(() => {});
      throw err;
    }
    log(`project ${id}: restored files from storage`);
    return 'restored';
  }

  async function remove(id) {
    for (const part of PARTS) { await objects.delete(tarKey(id, part)); lastHash.delete(`${id}/${part}`); }
  }

  return { save, saveNow, restore, remove, idle: () => Promise.all(running.values()) };
}
