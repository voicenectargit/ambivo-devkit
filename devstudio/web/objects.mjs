// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Object storage for Dev Studio's state: one object per record, addressed by a key like
// "keys/1001.json" or "projects/<id>.json". Two backends offer the same operations:
//
//   local  files under a folder (laptop mode, a single server without S3, tests). The key is the
//          path under the folder, so "keys/1001.json" is DEVSTUDIO_DATA/keys/1001.json, as before.
//   s3     an S3 bucket (s3.mjs), when DEVSTUDIO_S3_BUCKET is set. Two servers can share it.
//
// Operations (all async):
//   get(key, { ifNoneMatch })  -> { body: Buffer, etag } | { notModified: true, etag } | null
//   head(key)                  -> { etag, size } | null
//   put(key, body, { ifMatch, ifNoneMatch: '*', tags }) -> { etag }   throws ConflictError
//   putFile(key, file, { size, sha256, ifNoneMatch })   -> { etag }   (a large file, streamed)
//   getStream(key)             -> Readable | null
//   delete(key)                -> nothing; a missing key is not an error
//   list(prefix)               -> [key, ...]
//
// Conditional writes: `ifNoneMatch: '*'` creates only when the key is missing; `ifMatch: etag`
// replaces only the version that was read. Either one failing throws a ConflictError, and the
// caller reads again and retries. In the local backend these checks hold within one process only.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export class ConflictError extends Error {
  constructor(key) { super(`${key} was changed by someone else`); this.code = 'PreconditionFailed'; this.key = key; }
}

/** Keys are plain paths: letters, digits, dot, dash, underscore, slash. No "..", no leading slash. */
export function checkKey(key) {
  const k = String(key);
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(k) || k.split('/').some((p) => p === '.' || p === '..')) {
    throw new Error(`bad object key: ${k.slice(0, 80)}`);
  }
  return k;
}

const md5 = (b) => `"${createHash('md5').update(b).digest('hex')}"`;

/** Files under `dir`, written 0600 in folders made 0700 (the records include encrypted secrets). */
export function createLocalObjects(dir) {
  mkdirSync(dir, { recursive: true });
  const path = (key) => join(dir, ...checkKey(key).split('/'));
  const read = (key) => { try { return readFileSync(path(key)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

  function check(key, { ifMatch, ifNoneMatch } = {}) {
    if (!ifMatch && !ifNoneMatch) return;
    const cur = read(key);
    if (ifNoneMatch === '*' && cur) throw new ConflictError(key);
    if (ifMatch && (!cur || md5(cur) !== ifMatch)) throw new ConflictError(key);
  }

  function write(key, body) {
    const f = path(key);
    mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
    const tmp = `${f}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, f);
  }

  return {
    kind: 'local',
    dir,
    async get(key, { ifNoneMatch } = {}) {
      const b = read(key);
      if (!b) return null;
      const etag = md5(b);
      if (ifNoneMatch && ifNoneMatch === etag) return { notModified: true, etag };
      return { body: b, etag };
    },
    async head(key) {
      const b = read(key);
      return b ? { etag: md5(b), size: b.length } : null;
    },
    async put(key, body, opts = {}) {
      check(key, opts);
      const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      write(key, b);
      return { etag: md5(b) };
    },
    async putFile(key, file, opts = {}) {
      check(key, opts);
      const f = path(key);
      mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
      copyFileSync(file, f);
      chmodSync(f, 0o600);
      return { etag: md5(readFileSync(f)) };
    },
    async getStream(key) {
      return existsSync(path(key)) ? createReadStream(path(key)) : null;
    },
    async delete(key) {
      try { unlinkSync(path(key)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    },
    async list(prefix) {
      const out = [];
      const walk = (d) => {
        let names;
        try { names = readdirSync(d); } catch { return; }
        for (const n of names) {
          const f = join(d, n);
          if (statSync(f).isDirectory()) walk(f);
          else if (!n.endsWith('.tmp')) {
            const key = relative(dir, f).split(sep).join('/');
            if (key.startsWith(prefix)) out.push(key);
          }
        }
      };
      walk(dir);
      return out.sort();
    },
  };
}
