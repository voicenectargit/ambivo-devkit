// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Claude keys, saved per user (GitHub user id, or "local" in laptop mode), encrypted.
//
//   KMS backend   (DEVSTUDIO_KMS_KEY_ID set): envelope encryption. KMS GenerateDataKey gives a fresh
//                 AES-256 key per save; the key is encrypted locally with AES-256-GCM and the data key's
//                 KMS ciphertext is stored next to it. The KMS encryption context and the GCM additional
//                 data both name the user, so one user's record cannot be decrypted as another's.
//   Local backend (development): one AES-256 key in DEVSTUDIO_DATA/local.key, created 0600.
//
// Records are objects "keys/<user>.json" in an object store (objects.mjs): by default files under
// DEVSTUDIO_DATA (0600), or the S3 bucket when DEVSTUDIO_S3_BUCKET is set. The record is the same in
// both: the KMS envelope stays, and S3 adds its own encryption on top. Nothing here ever logs a key.
//
// Two servers saving the same user's record is the same partner saving twice; the later save is the
// one they meant, so writes are plain (last one wins) and never conditional.
//
// The same store holds other secrets in their own folder, under their own purpose: the Ambivo
// sandbox session lives in DEVSTUDIO_DATA/ambivo/<user>.json with purpose "ambivo-session". The
// purpose is in the GCM additional data and the KMS encryption context, so a record of one kind
// never opens as the other. A record may carry plain `meta` for display (never a secret), so a page
// load can show it without decrypting anything.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, chmodSync, openSync, closeSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalObjects } from './objects.mjs';

function seal(key, plaintext, aad) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function open(key, rec, aad) {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(rec.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(rec.ct, 'base64')), d.final()]).toString('utf8');
}

const safeUser = (u) => {
  const s = String(u);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new Error('bad user id');
  return s;
};

/** The development key, created once with mode 0600. */
export function localKey(dataDir) {
  const f = join(dataDir, 'local.key');
  if (!existsSync(f)) {
    mkdirSync(dataDir, { recursive: true });
    try {
      const fd = openSync(f, 'wx', 0o600);
      writeSync(fd, randomBytes(32).toString('base64'));
      closeSync(fd);
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  chmodSync(f, 0o600);
  const key = Buffer.from(readFileSync(f, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error(`${f} is not a 32-byte key`);
  return key;
}

/**
 * @param dataDir  where the local key file is kept, and the records when `objects` is not given
 * @param kms      null for the local backend, or { client, keyId } (client from kms.mjs or a fake)
 * @param objects  where records are kept (objects.mjs or s3.mjs). Default: files under dataDir.
 */
export function createKeyStore({ dataDir, kms = null, folder = 'keys', purpose = 'claude-key', objects = null }) {
  const store = objects || createLocalObjects(dataDir);
  if (store.kind === 'local') mkdirSync(join(store.dir, folder), { recursive: true, mode: 0o700 });
  const keyOf = (user) => `${folder}/${safeUser(user)}.json`;
  const read = async (user) => {
    const o = await store.get(keyOf(user));
    return o ? JSON.parse(o.body.toString('utf8')) : null;
  };
  const aad = (user) => `devstudio-${purpose}:${user}`;
  // Claude keys keep the context they were first saved with, so existing records still open.
  const context = (user) => (purpose === 'claude-key'
    ? { devstudio_user: String(user) }
    : { devstudio_user: String(user), devstudio_purpose: purpose });
  let local = null;
  const getLocal = () => (local ??= localKey(dataDir));

  return {
    backend: kms ? 'kms' : 'local',

    store,

    async has(user) { return !!(await store.head(keyOf(user))); },

    /** `meta`: plain, non-secret details shown without decrypting (for example an email and an expiry). */
    async save(user, secret, meta) {
      let rec;
      if (kms) {
        const dk = await kms.client.generateDataKey(kms.keyId, context(user));
        try { rec = { v: 1, backend: 'kms', edk: dk.ciphertext, ...seal(dk.plaintext, secret, aad(user)) }; }
        finally { dk.plaintext.fill(0); }
      } else {
        rec = { v: 1, backend: 'local', ...seal(getLocal(), secret, aad(user)) };
      }
      rec.saved = Date.now();
      if (meta) rec.meta = meta;
      await store.put(keyOf(user), JSON.stringify(rec), { contentType: 'application/json' });
    },

    /** The record's plain `meta`, or null. Decrypts nothing. */
    async info(user) {
      let rec;
      try { rec = await read(user); } catch { return null; }
      return rec ? (rec.meta ?? {}) : null;
    },

    /** The key in plain text, or null when the user has none. */
    async get(user) {
      const rec = await read(user);
      if (!rec) return null;
      if (rec.backend === 'kms') {
        if (!kms) throw new Error('This key was saved with KMS, and KMS is not set up here.');
        const dk = await kms.client.decrypt(kms.keyId, rec.edk, context(user));
        try { return open(dk, rec, aad(user)); } finally { dk.fill(0); }
      }
      return open(getLocal(), rec, aad(user));
    },

    /** true when there was a record to remove. */
    async remove(user) {
      if (!(await store.head(keyOf(user)))) return false;
      await store.delete(keyOf(user));
      return true;
    },
  };
}
