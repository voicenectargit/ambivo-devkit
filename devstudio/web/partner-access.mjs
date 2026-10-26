// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Partner access: a development partner, signed in to their OWN Ambivo company, installs an app in a
// client company whose admin gave them partner access. Used by Deploy (deploy.mjs).
//
// Core's contract (ambivo_api, bearer token, result 1 ok, result 2 refusal with error_code):
//   GET  user/partner_access/clients          {clients:[{grant_id, client_tenant_id, client_name, role, status, ends_at}]}
//   POST user/partner_access/accept {grant_id}  an invited partner accepts
//   POST user/partner_access/switch {grant_id}  {mfa_required, type, provider_challenge_id, challenge_destination}
//   POST user/partner_access/switch {grant_id, provider_challenge_id, code}
//                                             {user:{id, token}, partner_context:{grant_id, role, client_tenant_id,
//                                              client_name, access_ends_at}}
// The partner token lasts 1 hour, and renewing it needs the browser's own session cookie, so Dev Studio
// never renews it. In a partner session Core allows only a short list of routes (custom objects, the plan,
// user data, certificates, a few settings). Everything else answers 403 PARTNER_ROUTE_NOT_ALLOWED,
// including /app_job/*. A "viewer" partner cannot write at all.
//
// Node built-ins only. No logging here: the caller decides what to keep.

export const PARTNER_TOKEN_MS = 60 * 60 * 1000;
/** Dev Studio stops using a partner token this long after the switch, before Core's 1-hour end. */
export const PARTNER_SAFE_MS = 55 * 60 * 1000;

export const ACCESS_ENDED = 'PARTNER_ACCESS_ENDED';
export const ROUTE_NOT_ALLOWED = 'PARTNER_ROUTE_NOT_ALLOWED';

export class PartnerError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const textOf = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const withSlash = (u) => (String(u).endsWith('/') ? String(u) : `${u}/`);
const codeOf = (body) => textOf(body?.error_code) || textOf(body?.error?.error_code) || textOf(body?.error?.code) || '';

export const endedMessage = (company) => `Your partner access to ${company || 'this company'} has ended. Ask its admin to give you access again.`;
export const viewerMessage = (company) => `You have view-only partner access to ${company || 'this company'}. Ask its admin for admin access to install the app.`;

function refusal(body, status, company) {
  const code = codeOf(body);
  let message;
  if (code === ACCESS_ENDED) message = endedMessage(company);
  else if (code === ROUTE_NOT_ALLOWED) message = 'Partner access cannot do this step. Ask an admin of the company to do it.';
  else if (code === 'INVALID_MFA_CODE') message = 'That code is wrong. Check the email and try again.';
  else if (['MFA_CHALLENGE_NOT_FOUND', 'EMAIL_MFA_EXPIRED', 'MFA_CHALLENGE_EXHAUSTED', 'EMAIL_MFA_NOT_PENDING'].includes(code)) {
    message = 'That code can no longer be used. Choose the company again to get a new code.';
  } else if (status === 401 || /^(INVALID_TOKEN|TOKEN_EXPIRED|SESSION_EXPIRED)$/.test(code)) {
    message = 'Your Ambivo sign-in has ended. Sign in again.';
  } else if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
    message = 'Ambivo has had too many tries. Wait a few minutes, then try again.';
  } else {
    message = textOf(body?.error?.message) || textOf(body?.error_message) || textOf(body?.message)
      || (typeof body?.error === 'string' ? body.error : null) || `Ambivo refused the request (HTTP ${status}).`;
  }
  return new PartnerError(message, code || `HTTP_${status}`, status);
}

/** One call to Core with a bearer token. Answers the JSON body, or throws a PartnerError. */
export async function partnerCall({ apiUrl, token, fetchImpl = fetch, company }, method, path, body) {
  let res;
  try {
    res = await fetchImpl(new URL(path, withSlash(apiUrl)).toString(), {
      method,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new PartnerError('Ambivo could not be reached. Try again in a minute.', 'UNREACHABLE');
  }
  const out = await res.json().catch(() => null);
  if (!res.ok || !out || out.result === 2 || (out.error && out.result !== 1)) throw refusal(out, res.status, company);
  return out;
}

/** The companies that gave this person partner access, from their own session. */
export async function listClients(home, fetchImpl = fetch) {
  const out = await partnerCall({ apiUrl: home.apiUrl, token: home.token, fetchImpl }, 'GET', 'user/partner_access/clients');
  const list = Array.isArray(out?.clients) ? out.clients : Array.isArray(out?.data?.clients) ? out.data.clients : [];
  return list.filter((c) => c && textOf(c.grant_id)).map((c) => ({
    grantId: textOf(c.grant_id),
    tenantId: textOf(c.client_tenant_id) || '',
    name: textOf(c.client_name) || 'A client company',
    role: c.role === 'admin' ? 'admin' : 'viewer',
    status: c.status === 'active' ? 'active' : c.status === 'invited' ? 'invited' : String(c.status || ''),
    endsAt: c.ends_at ?? null,
  }));
}

export async function acceptAccess(home, grantId, fetchImpl = fetch) {
  await partnerCall({ apiUrl: home.apiUrl, token: home.token, fetchImpl }, 'POST', 'user/partner_access/accept', { grant_id: grantId });
}

function toPartnerSession(out, { apiUrl, client }) {
  const token = textOf(out?.user?.token);
  if (!token) throw new PartnerError('The switch to the client company did not finish. Try again.', 'UNEXPECTED_SWITCH_RESPONSE');
  const ctx = out.partner_context ?? {};
  const startedAt = Date.now();
  return {
    token,
    apiUrl: withSlash(apiUrl),
    userid: textOf(out.user.id) || '',
    grantId: textOf(ctx.grant_id) || client.grantId,
    role: ctx.role === 'admin' ? 'admin' : ctx.role ? 'viewer' : client.role,
    tenantId: textOf(ctx.client_tenant_id) || client.tenantId,
    tenantName: textOf(ctx.client_name) || client.name,
    accessEndsAt: ctx.access_ends_at ?? client.endsAt ?? null,
    startedAt,
    // Core's own end for the token is 1 hour; Dev Studio stops 5 minutes before it.
    safeUntil: startedAt + PARTNER_SAFE_MS,
  };
}

/** Step 1 of the switch. Answers {challenge} when Core sends a code, or {session} when it does not ask. */
export async function startSwitch(home, client, fetchImpl = fetch) {
  const out = await partnerCall({ apiUrl: home.apiUrl, token: home.token, fetchImpl, company: client.name },
    'POST', 'user/partner_access/switch', { grant_id: client.grantId });
  if (out?.mfa_required) {
    return { challenge: { providerChallengeId: textOf(out.provider_challenge_id) || '', type: textOf(out.type) || '',
      destination: textOf(out.challenge_destination) || '' } };
  }
  return { session: toPartnerSession(out, { apiUrl: home.apiUrl, client }) };
}

/** Step 2 of the switch: the code. Answers {session}, the partner session in the client company. */
export async function finishSwitch(home, client, challenge, code, fetchImpl = fetch) {
  const out = await partnerCall({ apiUrl: home.apiUrl, token: home.token, fetchImpl, company: client.name },
    'POST', 'user/partner_access/switch', { grant_id: client.grantId, provider_challenge_id: challenge.providerChallengeId, code: String(code).trim() });
  return { session: toPartnerSession(out, { apiUrl: home.apiUrl, client }) };
}

/** True when the partner session is an admin of the client company (GET user/data is_tenant_admin). */
export async function isPartnerAdmin(ps, fetchImpl = fetch) {
  const out = await partnerCall({ apiUrl: ps.apiUrl, token: ps.token, fetchImpl, company: ps.tenantName }, 'GET', 'user/data');
  const u = out?.user_data ?? out?.user ?? out?.data ?? out;
  return u?.is_tenant_admin === true || out?.is_tenant_admin === true;
}
