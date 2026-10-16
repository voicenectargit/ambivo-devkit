// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Sign in to the Ambivo API with an email and password, and the emailed code when Ambivo asks for one.
//
// One copy of this logic, used by two programs:
//   - the MCP CLI (`ambivo-mcp.mjs login`, mcp/src/login.mjs), which asks in a terminal;
//   - Dev Studio (devstudio/web/ambivo-signin.mjs), which asks in a web page. Its Docker build
//     context is devstudio/web alone, so it keeps a byte-for-byte copy of this file. Both test
//     suites fail when the copies differ: edit this file, then copy it over.
//
// Node built-ins only. No files, no terminal, no logging: the caller decides what to keep, and the
// password is never returned, stored or logged here.
//
// Contract (crm spec): POST /user/login {email, password, device_id, os, is_mobile, tenant_id?}
// answers one of: a session (token + user), a code challenge (is_mfa_response + provider_challenge_id
// + userid), a factor menu (requires_factor_selection + pre_mfa_token + factor_list, then
// POST /user/mfa/initiate), or requires_mfa_enrollment. POST /user/mfa/verify
// {provider_challenge_id, userid, challenge_code} answers a session.

export const DEFAULT_API = 'https://ingress.ambivo.com/';

export class SignInError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const textOf = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const withSlash = (u) => (String(u).endsWith('/') ? String(u) : `${u}/`);

/** exp from a JWT, without verifying it (only to know when to ask for a new sign-in). */
/** The company the token was issued for (its tenant_id claim), or undefined. Read only
 *  after the API has accepted the token, so the claim is the API's own. */
export function jwtTenant(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return payload.tenant_id ? String(payload.tenant_id) : undefined;
  } catch {
    return undefined;
  }
}

export function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

function errorCode(body) {
  return textOf(body?.error_code) || textOf(body?.error?.error_code) || textOf(body?.error?.code) || '';
}

/** A refusal from Ambivo, in words a partner can act on. */
function refusal(body, status) {
  const code = errorCode(body);
  const left = Number.isInteger(body?.attempts_remaining) ? ` You have ${body.attempts_remaining} tries left.` : '';
  let message;
  if (status === 429 || code === 'RATE_LIMIT_EXCEEDED' || code === 'ACCOUNT_LOCKED') {
    message = 'Ambivo has had too many sign-in tries for this account. Wait a few minutes, then try again.';
  } else if (/INVALID.?CREDENTIALS|INVALID.?USER/i.test(code)) {
    message = 'The email or password is wrong.';
  } else if (code === 'EMAIL_IS_NOT_CONFIRMED') {
    message = 'Confirm your email address first. Ambivo has sent you the confirmation email again.';
  } else if (code === 'INVALID_MFA_CODE') {
    message = `That code is wrong. Check the email and try again.${left}`;
  } else if (['EMAIL_MFA_EXPIRED', 'MFA_CHALLENGE_EXHAUSTED', 'EMAIL_MFA_NOT_PENDING', 'MFA_CHALLENGE_NOT_FOUND',
    'INVALID_PRE_MFA_TOKEN', 'PRE_MFA_TOKEN_ALREADY_USED'].includes(code)) {
    message = 'That code can no longer be used. Sign in again to get a new code.';
  } else if (status === 403 && !body) {
    message = 'The Ambivo firewall blocked the sign-in (HTTP 403).';
  } else {
    message = textOf(body?.error_message) || textOf(body?.error?.message) || textOf(body?.error) || textOf(body?.message)
      || `Ambivo refused the sign-in (HTTP ${status}).`;
  }
  return new SignInError(message, code || `HTTP_${status}`, status);
}

async function signInPost(apiUrl, path, body, { fetchImpl = fetch, token } = {}) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetchImpl(new URL(path, withSlash(apiUrl || DEFAULT_API)).toString(), {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new SignInError('Ambivo could not be reached. Try again in a minute.', 'UNREACHABLE');
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  if (!res.ok || !json || json.result === 2 || (json.error && json.result !== 1)) throw refusal(json, res.status);
  return json;
}

/**
 * The partner sandbox marker, read from the login response.
 * The API marks a sandbox tenant with tenant.meta.partner_sandbox (set only by POST /test/partner_sandbox),
 * and the login response carries the whole tenant as user.tenant_dict, meta included.
 * Returns {partnerKey, domain} for a sandbox, or null for any other company.
 */
export function sandboxOf(user) {
  const t = user?.tenant_dict;
  const m = t?.meta?.partner_sandbox;
  if (!m || typeof m !== 'object' || !textOf(m.partner_key)) return null;
  return { partnerKey: m.partner_key, domain: textOf(t.domain) || '' };
}

function toSession(res, { apiUrl, email }) {
  const token = res?.user?.token ?? res?.token;
  if (!token) throw new SignInError('Sign-in did not finish. Try again.', 'UNEXPECTED_LOGIN_RESPONSE');
  const user = res.user ?? {};
  const t = user.tenant_dict ?? {};
  return {
    token,
    apiUrl: withSlash(apiUrl || DEFAULT_API),
    email: textOf(user.email) || email,
    userid: textOf(user.id) || '',
    tenantId: textOf(user.tenant_id) || textOf(res.tenant_id) || '',
    tenantName: textOf(t.company_name) || textOf(t.name) || '',
    connectionId: textOf(user.client_connection_id) || '',
    expiresAt: jwtExpiry(token) ?? Math.floor(Date.now() / 1000) + 24 * 3600,
    sandbox: sandboxOf(user),
    // An admin of this company: listed in its admin_ids, or flagged by the API. Only an admin may
    // install an app's custom objects there (Dev Studio's Deploy checks this before installing).
    isTenantAdmin: user.is_tenant_admin === true
      || (Array.isArray(t.admin_ids) && t.admin_ids.map(String).includes(textOf(user.id) || '')),
  };
}

function toChallenge(res) {
  return {
    providerChallengeId: res.provider_challenge_id,
    userid: res.userid,
    type: textOf(res.type) || '',
    destination: textOf(res.challenge_destination) || '',
  };
}

/**
 * Step 1. Returns {session} when signed in, or {challenge} when Ambivo emailed (or texted) a code.
 * The password goes to Ambivo in this one request and nowhere else.
 */
export async function startSignIn({ apiUrl = DEFAULT_API, email, password, deviceId, os, tenantId, fetchImpl = fetch }) {
  let res = await signInPost(apiUrl, 'user/login', {
    email, password,
    // is_mobile is trusted as sent, and true buys a 180-day token: always false.
    is_mobile: false, device_id: deviceId, os,
    ...(tenantId ? { tenant_id: tenantId } : {}),
  }, { fetchImpl });

  if (res?.requires_mfa_enrollment) {
    throw new SignInError(
      'This account needs a sign-in code, and none is set up yet. Sign in to Ambivo in a browser once to set one up. Then sign in here again.',
      'MFA_SETUP_NEEDED');
  }
  if (res?.requires_factor_selection && res?.pre_mfa_token) {
    const factors = res.factor_list ?? [];
    const factor = factors.find((f) => f.type === 'email') ?? factors[0];
    if (!factor) throw new SignInError('This account has no way to receive a sign-in code.', 'NO_MFA_FACTOR');
    res = await signInPost(apiUrl, 'user/mfa/initiate', { pre_mfa_token: res.pre_mfa_token, factor_id: factor.factor_id }, { fetchImpl });
  }
  if (!(res?.user?.token ?? res?.token) && res?.provider_challenge_id && res?.userid) {
    return { challenge: toChallenge(res) };
  }
  return { session: toSession(res, { apiUrl, email }) };
}

/** Step 2, after a challenge: the code the partner received. Returns {session}. */
export async function finishSignIn({ apiUrl = DEFAULT_API, challenge, code, email, fetchImpl = fetch }) {
  const res = await signInPost(apiUrl, 'user/mfa/verify', {
    provider_challenge_id: challenge.providerChallengeId, userid: challenge.userid, challenge_code: String(code).trim(),
  }, { fetchImpl });
  return { session: toSession(res, { apiUrl, email }) };
}

/** Ends the session at Ambivo. Best effort: errors are swallowed, as the API's own clients do. */
export async function signOut({ apiUrl = DEFAULT_API, token, connectionId, fetchImpl = fetch }) {
  if (!token) return false;
  try {
    await signInPost(apiUrl, 'user/logout', connectionId ? { connection_id: connectionId } : {}, { fetchImpl, token });
    return true;
  } catch {
    return false;
  }
}
