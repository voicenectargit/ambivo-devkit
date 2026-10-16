// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// A minimal S3 client for Dev Studio's state: GetObject, HeadObject, PutObject (with If-Match and
// If-None-Match), DeleteObject, ListObjectsV2. Signed by hand with Signature Version 4, like kms.mjs,
// so the server keeps no npm dependencies. Credentials come from the same source as KMS
// (environment, else the instance role through IMDSv2).
//
// The bucket encrypts with SSE-KMS by default (infra/aws/state.tf), so requests send no encryption
// headers. Records that hold secrets (Claude keys, Ambivo sessions) are also KMS-envelope encrypted
// by keystore.mjs before they get here.
import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { signV4 } from './kms.mjs';
import { ConflictError, checkKey } from './objects.mjs';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
// RFC 3986, as SigV4 wants it for S3 (encodeURIComponent leaves !'()* alone).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xmlValue = (xml, tag) => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * @param bucket       the bucket name
 * @param region       its region
 * @param endpoint     optional, tests only: a fake S3 (path-style: <endpoint>/<bucket>/<key>)
 * @param credentials  async () => { accessKeyId, secretAccessKey, sessionToken }
 */
export function createS3Objects({ bucket, region, endpoint = '', credentials, timeoutMs = 30000 }) {
  if (!bucket) throw new Error('S3 bucket name is missing');
  const base = endpoint
    ? `${endpoint.replace(/\/+$/, '')}/${bucket}`
    : `https://${bucket}.s3.${region}.amazonaws.com`;

  /** One signed request. `body` is a Buffer, or { file, size, sha256 } to stream a file. */
  async function request(method, key, { query = '', headers = {}, body, stream = false } = {}) {
    const url = `${base}/${key ? checkKey(key) : ''}${query ? `?${query}` : ''}`;
    let payloadHash = EMPTY_SHA256;
    let length = 0;
    if (Buffer.isBuffer(body)) { payloadHash = createHash('sha256').update(body).digest('hex'); length = body.length; }
    else if (body?.file) { payloadHash = body.sha256; length = body.size; }
    const h = { ...headers, 'x-amz-content-sha256': payloadHash };
    if (method === 'PUT') h['content-length'] = String(length);
    const signed = signV4({ method, url, headers: h, payloadHash, service: 's3', region, credentials: await credentials() });
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(u, { method, headers: signed.headers, timeout: timeoutMs }, (res) => {
        if (stream && res.statusCode === 200) return resolve({ status: 200, headers: res.headers, stream: res });
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error(`S3 ${method} ${key || ''}: timed out`)));
      req.on('error', reject);
      if (Buffer.isBuffer(body)) req.end(body);
      else if (body?.file) createReadStream(body.file).on('error', reject).pipe(req);
      else req.end();
    });
  }

  function fail(op, key, r) {
    const text = r.body ? r.body.toString('utf8') : '';
    const code = xmlValue(text, 'Code') || '';
    const err = new Error(`S3 ${op} ${key || ''} failed: HTTP ${r.status} ${code}`.trim());
    err.status = r.status;
    err.code = code;
    return err;
  }

  /** 412 (precondition) and 409 (a conditional write raced another) both mean: read again. */
  const conflict = (r) => r.status === 412 || (r.status === 409 && /ConditionalRequestConflict/.test(r.body?.toString() || ''));

  function writeHeaders({ ifMatch, ifNoneMatch, tags, contentType } = {}) {
    const h = { 'content-type': contentType || 'application/octet-stream' };
    if (ifMatch) h['if-match'] = ifMatch;
    if (ifNoneMatch) h['if-none-match'] = ifNoneMatch;
    if (tags) h['x-amz-tagging'] = Object.entries(tags).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
    return h;
  }

  return {
    kind: 's3',
    bucket,
    async get(key, { ifNoneMatch } = {}) {
      const r = await request('GET', key, { headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {} });
      if (r.status === 404) return null;
      if (r.status === 304) return { notModified: true, etag: ifNoneMatch };
      if (r.status !== 200) throw fail('GetObject', key, r);
      return { body: r.body, etag: r.headers.etag };
    },
    async head(key) {
      const r = await request('HEAD', key);
      if (r.status === 404) return null;
      if (r.status !== 200) throw fail('HeadObject', key, r);
      return { etag: r.headers.etag, size: Number(r.headers['content-length'] || 0) };
    },
    async put(key, body, opts = {}) {
      const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const r = await request('PUT', key, { headers: writeHeaders(opts), body: b });
      if (conflict(r)) throw new ConflictError(key);
      if (r.status !== 200) throw fail('PutObject', key, r);
      return { etag: r.headers.etag };
    },
    async putFile(key, file, { size, sha256, ...opts } = {}) {
      const r = await request('PUT', key, { headers: writeHeaders({ contentType: 'application/gzip', ...opts }), body: { file, size, sha256 } });
      if (conflict(r)) throw new ConflictError(key);
      if (r.status !== 200) throw fail('PutObject', key, r);
      return { etag: r.headers.etag };
    },
    async getStream(key) {
      const r = await request('GET', key, { stream: true });
      if (r.status === 404) return null;
      if (r.status !== 200) throw fail('GetObject', key, r);
      return r.stream;
    },
    async delete(key) {
      const r = await request('DELETE', key);
      if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw fail('DeleteObject', key, r);
    },
    async list(prefix) {
      const keys = [];
      let token = '';
      for (let page = 0; page < 1000; page++) {
        const q = [['continuation-token', token], ['list-type', '2'], ['prefix', prefix]]
          .filter(([k, v]) => k !== 'continuation-token' || v).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
        const r = await request('GET', '', { query: q });
        if (r.status !== 200) throw fail('ListObjectsV2', prefix, r);
        const xml = r.body.toString('utf8');
        for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(unxml(m[1]));
        if (xmlValue(xml, 'IsTruncated') !== 'true') break;
        token = unxml(xmlValue(xml, 'NextContinuationToken') || '');
        if (!token) break;
      }
      return keys;
    },
  };
}
