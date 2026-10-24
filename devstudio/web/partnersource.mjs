// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Who may sign in to Dev Studio beyond the floor list, read from the Partner Program app in Ambivo.
// On when DEVSTUDIO_PARTNERPROG_TENANT is set with _KEY, or with _EMAIL and _PASSWORD
// (config.partnerProg.on); access.mjs then takes its entries from here and refuses writes.
//
// With DEVSTUDIO_PARTNERPROG_KEY (an Ambivo service key, amb_sk_…) every read sends the key and Dev
// Studio never signs in. The key reads only the two collections, as the person it names. Without a
// key, Dev Studio signs in as the service user with the password.
//
//   start()     loads the last stored snapshot, refreshes once, then every refreshMs (5 minutes)
//   refresh()   reads every partner and person (with the key, or signed in), builds the entries
//   entries()   the entries of the last good read, in access.mjs's shape
//   status()    { configured, lastSuccessAt, lastError, lastErrorAt, problems, count, nextTryAt, notify? }
//
// A sign-in refusal that trying again cannot fix (expired temporary password, wrong password, blocked,
// verification on, wrong account), or a refused key, pauses the reads for 60 minutes; a restart tries at once.
//
// With DEVSTUDIO_PARTNERPROG_NOTIFY=on, each read that works is followed by notify.mjs: a person whose
// access turns active gets one email. Person entries carry `name` and `email` (the work email) for it.
//
// A person may sign in when their dev_studio_access is 'active' and their partner's status is 'active'.
// A partner's github_org lets its members in while the partner is active. Entries match by GitHub's
// numeric id (see access.mjs). Each name's id is looked up once and kept in IDS_KEY; the first id seen
// for a name wins, so a login that is renamed and then taken by someone else does not inherit access.
//
// Any failure keeps the last good snapshot (memory, else the stored one). With none, the list is empty
// and only the floor gets in. The key, the password and the token are never logged.

import { createNotifier, createSes } from './notify.mjs';

export const IDS_KEY = 'config/partnerprog-ids.json';
export const SNAPSHOT_KEY = 'config/partnerprog-snapshot.json';
export const PARTNERPROG_NAME = 'Partner Program';
export const SOURCE = 'partner-program';
const REFRESH_MS = 5 * 60_000;
const RENEW_BEFORE_MS = 60 * 60_000;   // sign in again this long before the token's exp
const TIMEOUT_MS = 20_000;
const DEVICE_ID = 'devstudio';
// A refused sign-in that trying again cannot fix waits this long before the next try. Each try with
// an expired temporary password makes Ambivo mail the service user a reset link (one per 15 minutes),
// and wrong passwords count toward Ambivo's 5-try block.
const SIGN_IN_PAUSE_MS = 60 * 60_000;
const SIGN_IN_STOPS = /TEMP_PASSWORD_EXPIRED|CREDENTIAL|PASSWORD|BLOCKED|MFA|WRONG_TENANT|NOT_FOUND|INACTIVE|DISABLED/i;
// Ambivo's refusals of a service key: INVALID_SERVICE_KEY, SERVICE_KEY_NOT_ALLOWED, SERVICE_KEY_USER_INACTIVE.
const KEY_REFUSED = /SERVICE_KEY/;
// Ambivo error codes that mean the session is over: sign in again once and retry.
const SESSION_ENDED = /SESSION|TOKEN|NOT_AUTHENTICATED|UNAUTHORI[SZ]ED|LOGIN_REQUIRED|AUTH/i;

export class PartnerSourceError extends Error {
  constructor(message, code = null, { signIn = false } = {}) { super(message); this.code = code; this.signIn = signIn; }
}

const lower = (s) => String(s ?? '').trim().toLowerCase().replace(/^@/, '');
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;

/** The payload (middle part) of a JWT, or null. */
export function jwtPayload(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

/**
 * @param notifier     optional: { run(entries, active), status() }. Default: built from config.partnerProg.notify
 *                     when it is on, sending through SES with `credentials` (default: environment, else the
 *                     instance role).
 */
export function createPartnerSource({ config, fetchImpl = fetch, objects, lookup = null, log = console.log, now = () => Date.now(), refreshMs = REFRESH_MS, pageSize = 200, maxPages = 50, notifier: notifierIn = null, credentials = null }) {
  const pp = config.partnerProg;
  const nc = pp.notify;
  const notifier = notifierIn ?? (nc?.on && objects
    ? createNotifier({ notify: nc, objects, log, now,
      send: createSes({ region: nc.region, endpoint: nc.sesEndpoint, fetchImpl, ...(credentials ? { credentials } : {}) }).send })
    : null);
  let token = null, tokenUntil = 0;
  let snapshot = null;            // { at, entries, problems } of the last good read
  let lastError = null, lastErrorAt = null;
  let queue = Promise.resolve();  // refreshes run one after another
  let loaded = null;              // the stored snapshot, read once
  let timer = null;
  let lastLogged = '';
  let pausedUntil = 0;            // after a sign-in refusal that trying again cannot fix

  // ---- Ambivo ---------------------------------------------------------------------------------

  async function call(method, path, body, auth, key = null) {
    let r;
    try {
      r = await fetchImpl(`${pp.api}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(key ? { 'x-ambivo-service-key': key } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new PartnerSourceError(`Ambivo did not answer (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`, 'NETWORK');
    }
    const j = await r.json().catch(() => null);
    return { status: r.status, j };
  }

  async function signIn() {
    const { status, j } = await call('POST', 'user/login', { email: pp.email, password: pp.password, device_id: DEVICE_ID });
    if (j?.is_mfa_response) throw new PartnerSourceError('The service user has sign-in verification on. Turn it off for that user.', 'MFA', { signIn: true });
    const t = j?.user?.token;
    if (status !== 200 || j?.result !== 1 || !t) {
      const code = j?.error_code || j?.error?.error_code || `HTTP_${status}`;
      const message = code === 'TEMP_PASSWORD_EXPIRED'
        ? 'The service user\'s temporary password has expired. Set a new password for it in Ambivo, then update DEVSTUDIO_PARTNERPROG_PASSWORD.'
        : `Ambivo refused the service user's sign-in (${code}).`;
      throw new PartnerSourceError(message, code, { signIn: SIGN_IN_STOPS.test(code) });
    }
    const payload = jwtPayload(t);
    if (!payload || String(payload.tenant_id ?? '') !== pp.tenant) {
      // Nothing from this session is used: the service user must be in the Partner Program's account.
      throw new PartnerSourceError('The service user belongs to another Ambivo account. Nothing was read.', 'WRONG_TENANT', { signIn: true });
    }
    token = t;
    // Without an exp, keep it until Ambivo says the session is over.
    // A short-lived token is renewed at half its life.
    const life = payload.exp ? payload.exp * 1000 - now() : Infinity;
    tokenUntil = now() + life - Math.min(RENEW_BEFORE_MS, life / 2);
  }

  /** GET with the service key. A refused key pauses the reads, like a refused sign-in. */
  async function getWithKey(path) {
    const { status, j } = await call('GET', path, null, null, pp.key);
    if (status === 200 && j?.result === 1) return j;
    const code = j?.error_code || j?.error?.error_code || '';
    if (KEY_REFUSED.test(code)) {
      throw new PartnerSourceError(code === 'SERVICE_KEY_USER_INACTIVE'
        ? 'The person Dev Studio\'s key acts as can no longer sign in to Ambivo. Make a new key, then update DEVSTUDIO_PARTNERPROG_KEY.'
        : `Ambivo refused Dev Studio's key (${code}). Make a new key in Ambivo, then update DEVSTUDIO_PARTNERPROG_KEY.`, code, { signIn: true });
    }
    throw new PartnerSourceError(`Ambivo could not give the Partner Program records (${code || `HTTP ${status}`}).`, code || `HTTP_${status}`);
  }

  /** GET with the service token; on 401 or a session-ended error, sign in again once and retry. */
  async function get(path) {
    if (pp.key) return getWithKey(path);
    for (let i = 0; ; i++) {
      if (!token || now() >= tokenUntil) await signIn();
      const { status, j } = await call('GET', path, null, token);
      const code = j?.error_code || j?.error?.error_code || '';
      const ended = status === 401 || (j?.result === 2 && SESSION_ENDED.test(code));
      if (ended && i === 0) { token = null; continue; }
      if (status !== 200 || j?.result !== 1) {
        throw new PartnerSourceError(`Ambivo could not give the Partner Program records (${code || `HTTP ${status}`}).`, code || `HTTP_${status}`);
      }
      return j;
    }
  }

  async function readAll(collection, problems) {
    const out = [];
    for (let page = 1; ; page++) {
      if (page > maxPages) {
        // A partial list could leave out a paused person, who would then get in through their org.
        // So this read fails and the last good list stays in use.
        throw new Error(`${collection} has more than ${maxPages * pageSize} records, more than Dev Studio reads. Ask an engineer to raise the limit.`);
      }
      const j = await get(`custom/object/data?collection_id=${encodeURIComponent(collection)}&page_size=${pageSize}&page_num=${page}`);
      const list = Array.isArray(j.data_list) ? j.data_list : [];
      out.push(...list);
      if (list.length < pageSize) break;
    }
    return out;
  }

  // ---- GitHub ids -----------------------------------------------------------------------------

  async function loadIds() {
    const o = await objects.get(IDS_KEY);
    return { ids: o ? JSON.parse(o.body.toString('utf8')).names ?? {} : {}, etag: o?.etag ?? null };
  }

  /** Save new names. On a conflict (another server), read again: names already stored keep their id. */
  async function saveIds(added) {
    for (let i = 0; ; i++) {
      const { ids, etag } = await loadIds();
      const merged = { ...added, ...ids };
      try {
        await objects.put(IDS_KEY, JSON.stringify({ version: 1, names: merged }, null, 2), { ...(etag ? { ifMatch: etag } : { ifNoneMatch: '*' }), contentType: 'application/json' });
        return merged;
      } catch (err) {
        if (err?.code !== 'PreconditionFailed' || i) throw err;
      }
    }
  }

  /**
   * GitHub ids for these names: name -> { id, type } | { missing: true } | { failed: true }.
   * Cached names are never looked up again.
   */
  async function resolveIds(wanted) {
    let { ids } = await loadIds();
    const added = {};
    const out = {};
    for (const name of wanted) {
      if (ids[name]) { out[name] = ids[name]; continue; }
      if (!lookup) { out[name] = { failed: true }; continue; }
      try {
        const a = await lookup(name);
        added[name] = { id: String(a.id), type: a.type, at: now() };
        out[name] = added[name];
      } catch (err) {
        out[name] = err?.status === 404 ? { missing: true } : { failed: true };
      }
    }
    if (Object.keys(added).length) {
      ids = await saveIds(added);
      // Another server may have stored a name first: its id wins.
      for (const name of Object.keys(added)) out[name] = ids[name];
    }
    return out;
  }

  // ---- Entries --------------------------------------------------------------------------------

  async function build() {
    const problems = [];
    const partners = await readAll(pp.partnerCollection, problems);
    const people = await readAll(pp.personCollection, problems);
    const byId = new Map(partners.map((p) => [String(p.id), p]));

    const cands = [];
    for (const p of partners) {
      const g = lower(p.github_org);
      if (!g) continue;
      const company = String(p.company_name || '').trim();
      if (!NAME.test(g)) { problems.push(`${company || 'A partner'} has a GitHub organisation name that is not valid: ${g}.`); continue; }
      cands.push({ id: `pp-org-${p.id}`, kind: 'org', github: g, status: p.status === 'active' ? 'active' : 'paused', partner: company, note: '', source: SOURCE, label: company });
    }
    for (const x of people) {
      const g = lower(x.github_username);
      if (!g) continue;
      const partner = byId.get(String(x.partner_id ?? ''));
      const company = String(partner?.company_name || '').trim();
      const who = String(x.full_name || '').trim();
      if (!NAME.test(g)) { problems.push(`${who || 'A person'} has a GitHub user name that is not valid: ${g}.`); continue; }
      const ok = x.dev_studio_access === 'active' && partner?.status === 'active';
      const email = String(x.work_email || '').trim();
      cands.push({ id: `pp-person-${x.id}`, kind: 'user', github: g, status: ok ? 'active' : 'paused', partner: company, note: who, source: SOURCE, label: who || g, name: who, email });
    }

    // One entry per GitHub account and kind. An active record wins: one active record is enough.
    const seen = new Map();
    for (const c of cands.sort((a, b) => (a.status === b.status ? a.id.localeCompare(b.id) : a.status === 'active' ? -1 : 1))) {
      const k = `${c.kind}:${c.github}`;
      if (seen.has(k)) { problems.push(`${c.github} is on more than one ${c.kind === 'org' ? 'partner' : 'person'} record. The ${seen.get(k).status} one is used.`); continue; }
      seen.set(k, c);
    }

    // Everyone whose record says active, whether or not GitHub answered for them this time (notify.mjs).
    const active = cands.filter((c) => c.kind === 'user' && c.status === 'active').map((c) => ({ id: c.id, github: c.github, email: c.email }));
    const ids = await resolveIds([...new Set([...seen.values()].map((c) => c.github))]);
    const entries = [];
    for (const c of seen.values()) {
      const r = ids[c.github];
      const want = c.kind === 'org' ? 'Organization' : 'User';
      if (r?.missing) { problems.push(`GitHub has no account named ${c.github} (${c.label}).`); continue; }
      if (!r?.id) { problems.push(`GitHub did not answer for ${c.github} (${c.label}). Dev Studio tries again in 5 minutes.`); continue; }
      if (r.type !== want) {
        problems.push(c.kind === 'org'
          ? `${c.github} is a GitHub user. ${c.label} needs a GitHub organisation name.`
          : `${c.github} is a GitHub organisation. ${c.label} needs a GitHub user name.`);
        continue;
      }
      const { label, ...e } = c;
      entries.push({ ...e, github_id: String(r.id) });
    }
    return { entries, problems, active, people: people.length, partners: partners.length };
  }

  async function loadStored() {
    try {
      const o = await objects.get(SNAPSHOT_KEY);
      if (o && !snapshot) snapshot = JSON.parse(o.body.toString('utf8'));
    } catch (err) { log(`partner program: reading the stored list: ${err.message}`); }
  }

  async function run() {
    await (loaded ??= loadStored());
    if (now() < pausedUntil) return;   // keeps the last error and the last good list
    try {
      const b = await build();
      snapshot = { at: now(), entries: b.entries, problems: b.problems };
      lastError = null; lastErrorAt = null;
      try { await objects.put(SNAPSHOT_KEY, JSON.stringify(snapshot, null, 2), { contentType: 'application/json' }); }
      catch (err) { log(`partner program: storing the list: ${err.message}`); }
      const line = `partner program: ${b.partners} partners, ${b.people} people, ${b.entries.length} entries, ${b.problems.length} problems`;
      if (line !== lastLogged) { log(line); lastLogged = line; }
      if (notifier) await notifier.run(b.entries, b.active);
    } catch (err) {
      lastError = err instanceof PartnerSourceError ? err.message : `Reading the Partner Program failed (${err.message}).`;
      lastErrorAt = now();
      lastLogged = '';
      if (err.signIn) pausedUntil = now() + SIGN_IN_PAUSE_MS;
      log(`partner program: read failed, ${snapshot ? 'keeping the last good list' : 'no good list yet, only the floor signs in'}: ${err.code || ''} ${lastError}${err.signIn ? ' Next try in 60 minutes.' : ''}`);
    }
  }

  return {
    /** Read the Partner Program now. Waits for a read in progress, then reads again. Never throws. */
    refresh() { queue = queue.then(run, run); return queue; },
    /** Resolves once the stored snapshot has been read (or found missing). */
    ready() { return (loaded ??= loadStored()); },
    entries() { return snapshot?.entries ?? []; },
    status() {
      return { configured: true, lastSuccessAt: snapshot?.at ?? null, lastError, lastErrorAt, problems: snapshot?.problems ?? [], count: snapshot?.entries?.length ?? 0,
        nextTryAt: now() < pausedUntil ? pausedUntil : null,
        ...(notifier ? { notify: notifier.status() } : {}) };
    },
    start() {
      if (timer) return queue;
      timer = setInterval(() => this.refresh(), refreshMs);
      timer.unref?.();
      return this.refresh();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
