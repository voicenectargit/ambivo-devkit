// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// The fingerprint of an app's code: what a review covers and what a certificate signs.
//
// One SHA-256 over the lines "<sha256 of the file> <path>\n", sorted by path (byte order), each text file's
// bytes read with CRLF as LF so a Windows checkout counts the same (TEXT_FILE); binary files exactly. Left out: installed packages, build
// output and tool folders (EXCLUDED_DIRS anywhere in the path), .DS_Store, and the certificate file itself,
// which is written after the review. Only regular files count: parseTar drops links and devices.
//
// The same rule is in the dev kit's submit_app tool (mcp/src/fingerprint.mjs) and in Ambivo's
// service/app_review.py docstring. test/fingerprint.test.mjs pins it with a fixed example.
import { createHash } from 'node:crypto';

export const EXCLUDED_DIRS = ['node_modules', 'dist', '.angular', '.git', '.ambivo', 'coverage', '.claude', '.idea', '.vscode'];
export const CERTIFICATE_PATH = 'src/install/ambivo-certificate.json';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
// CRLF is read as LF in text files only. In an image or a binary the bytes count exactly.
export const TEXT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|html|htm|css|scss|sass|less|json|md|txt|yaml|yml|svg|xml|webmanifest|map|csv|ini|conf|sh|gitignore|editorconfig|npmrc|browserslistrc)$|(^|\/)(\.[a-z]+rc|LICENSE[^/]*|README[^/]*)$/i;
const lf = (buf, path) => (TEXT_FILE.test(path) ? Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : buf);

/** "./src/x.ts" -> "src/x.ts"; null for a path that climbs out or is empty. */
export function cleanPath(p) {
  const parts = String(p).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

/** True when the file counts toward the fingerprint. */
export function counts(path) {
  const parts = path.split('/');
  if (parts.some((s) => EXCLUDED_DIRS.includes(s))) return false;
  if (parts[parts.length - 1] === '.DS_Store') return false;
  return path !== CERTIFICATE_PATH;
}

/**
 * The files that count, with clean paths, sorted, each with its own sha256.
 * @param files [{path, content: Buffer}] (parseTar's output)
 */
export function codeFiles(files) {
  const seen = new Map();
  for (const f of files) {
    const path = cleanPath(f.path);
    if (!path || !counts(path)) continue;
    seen.set(path, { path, content: f.content, sha256: sha(lf(f.content, path)) });
  }
  return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The fingerprint of these files (see the top of this file). */
export function fingerprint(files) {
  return sha(Buffer.from(codeFiles(files).map((f) => `${f.sha256} ${f.path}\n`).join(''), 'utf8'));
}

// ---- a plain tar of regular files, so the review container gets exactly the fingerprinted bytes ----

function header(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write('0000644\0', 100); h.write('0001750\0', 108); h.write('0001750\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);

/** A tar of the counted files. Long paths get a pax "path" record. */
export function tarOf(files) {
  const out = [];
  for (const f of codeFiles(files)) {
    if (Buffer.byteLength(f.path) > 99) {
      const rec = (len) => `${len} path=${f.path}\n`;
      let len = Buffer.byteLength(rec(0));
      while (Buffer.byteLength(rec(len)) !== len) len = Buffer.byteLength(rec(len));
      const body = Buffer.from(rec(len), 'utf8');
      out.push(header('PaxHeader', body.length, 'x'), body, pad(body.length));
    }
    out.push(header(f.path, f.content.length), f.content, pad(f.content.length));
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}

/**
 * Entries of an uploaded tar the fingerprint would not see, but a build of the sender's project could use:
 * links, names with a backslash, and .env* files in src/. Read from the raw headers (parseTar drops them).
 */
export function tarSurprises(buf) {
  const out = [];
  let off = 0, paxPath = null, longName = null;
  const str = (b) => { const i = b.indexOf(0); return b.subarray(0, i < 0 ? b.length : i).toString('utf8'); };
  while (off + 512 <= buf.length && out.length < 20) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8')); paxPath = m ? m[1] : null; continue; }
    if (type === 'L') { longName = str(data); continue; }
    if (type === 'g') continue;
    const prefix = str(h.subarray(345, 500));
    const name = paxPath || longName || (prefix ? `${prefix}/${str(h.subarray(0, 100))}` : str(h.subarray(0, 100)));
    paxPath = null; longName = null;
    const path = String(name).replace(/^\.\//, '');
    const base = path.split('/').pop();
    if (type === '1' || type === '2') out.push(`${path} (link)`);
    else if (path.includes('\\')) out.push(path);
    else if (/^src\//.test(path) && base.startsWith('.env')) out.push(path);
  }
  return out;
}
