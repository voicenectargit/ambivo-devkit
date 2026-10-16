// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Signed cookies: base64url(JSON payload) + "." + base64url(HMAC-SHA256). The payload carries its own
// expiry (exp, ms since epoch) and a scope, so a preview cookie can never be used as an API session.
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const mac = (data, secret) => createHmac('sha256', secret).update(data).digest();

export function sign(payload, secret) {
  if (!secret) throw new Error('no session secret');
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(mac(body, secret))}`;
}

/** The payload if the signature is good, the scope matches and it has not expired; otherwise null. */
export function verify(token, secret, { scope, now = Date.now() } = {}) {
  if (!token || !secret || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  let given;
  try { given = Buffer.from(token.slice(dot + 1), 'base64url'); } catch { return null; }
  const want = mac(body, secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.exp !== 'number' || p.exp <= now) return null;
  if (scope && p.scope !== scope) return null;
  return p;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, domain, secure = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', `SameSite=${sameSite}`];
  if (secure) parts.push('Secure');
  if (domain) parts.push(`Domain=${domain}`);
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
    parts.push(`Expires=${new Date(Date.now() + Math.max(0, maxAge) * 1000).toUTCString()}`);
  }
  return parts.join('; ');
}
