// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// A minimal AWS KMS client: two calls (GenerateDataKey, Decrypt), signed with Signature Version 4.
//
// Why not @aws-sdk/client-kms: the server has no npm dependencies today, and the SDK adds about
// 80 packages for two JSON calls. SigV4 is short and is tested here against AWS's published example.
// Credentials: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN, else the EC2 instance
// role through IMDSv2. A container on EC2 reaches IMDSv2 only when the instance's metadata
// hop limit is 2 or more.
import { createHash, createHmac } from 'node:crypto';

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s).digest();

/** Sign a request in place (adds x-amz-date, x-amz-security-token, authorization). */
export function signV4({ method, url, headers, body = '', payloadHash, service, region, credentials, now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const h = { ...headers, host: u.host, 'x-amz-date': amzDate };
  if (credentials.sessionToken) h['x-amz-security-token'] = credentials.sessionToken;
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&');
  // payloadHash: the body's SHA-256 when the body is a stream (S3 uploads hash the file first).
  const canonical = [method, u.pathname || '/', query, canonicalHeaders, signedHeaders, payloadHash || sha256hex(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  let k = hmac(`AWS4${credentials.secretAccessKey}`, day);
  k = hmac(k, region); k = hmac(k, service); k = hmac(k, 'aws4_request');
  const signature = createHmac('sha256', k).update(toSign).digest('hex');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: h, signature };
}

/** Credentials from the environment, else the instance role (IMDSv2), cached until near expiry. */
export function credentialSource({ env = process.env, fetchImpl = fetch, imds = 'http://169.254.169.254' } = {}) {
  let cached = null;
  return async function credentials() {
    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN };
    }
    if (cached && cached.expires - Date.now() > 5 * 60 * 1000) return cached;
    const t = await fetchImpl(`${imds}/latest/api/token`, {
      method: 'PUT', headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '300' }, signal: AbortSignal.timeout(3000),
    });
    if (!t.ok) throw new Error(`instance metadata token: HTTP ${t.status}`);
    const token = await t.text();
    const h = { 'x-aws-ec2-metadata-token': token };
    const base = `${imds}/latest/meta-data/iam/security-credentials/`;
    const role = (await (await fetchImpl(base, { headers: h, signal: AbortSignal.timeout(3000) })).text()).split('\n')[0].trim();
    if (!role) throw new Error('the instance has no role');
    const c = await (await fetchImpl(base + role, { headers: h, signal: AbortSignal.timeout(3000) })).json();
    cached = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.Token, expires: Date.parse(c.Expiration) };
    return cached;
  };
}

export function createKms({ region, endpoint, credentials, fetchImpl = fetch }) {
  const url = endpoint || `https://kms.${region}.amazonaws.com/`;
  async function call(action, payload) {
    const body = JSON.stringify(payload);
    const { headers } = signV4({
      method: 'POST', url, body, service: 'kms', region, credentials: await credentials(),
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `TrentService.${action}` },
    });
    const r = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    if (!r.ok) {
      let type = '';
      try { type = JSON.parse(text).__type || ''; } catch {}
      throw new Error(`KMS ${action} failed: HTTP ${r.status} ${type}`.trim());
    }
    return JSON.parse(text);
  }
  return {
    async generateDataKey(keyId, context) {
      const r = await call('GenerateDataKey', { KeyId: keyId, KeySpec: 'AES_256', EncryptionContext: context });
      return { plaintext: Buffer.from(r.Plaintext, 'base64'), ciphertext: r.CiphertextBlob };
    },
    async decrypt(keyId, ciphertext, context) {
      const r = await call('Decrypt', { KeyId: keyId, CiphertextBlob: ciphertext, EncryptionContext: context });
      return Buffer.from(r.Plaintext, 'base64');
    },
  };
}
