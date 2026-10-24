// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Who may sign in to Dev Studio, beyond the floor list set at deploy time (DEVSTUDIO_ALLOWED_GITHUB).
// Staff add and pause partners in the Partner Program app (partnersource.mjs). Without it, the list lives in
// the state bucket (or, on a laptop, a file under DEVSTUDIO_DATA); Dev Studio has no page that edits it.
//
//   list()               -> entries (cached for CACHE_MS)
//   add(entry, by)       -> the new entry           an entry: { id, github, kind, partner, status, note, ... }
//   update(id, patch, by)-> the entry
//   remove(id)           -> true
//   decide(who, floor)   -> { ok, via, gid, gname }  who = { id, login, orgs: [{ id, login }] } from GitHub;
//                                                      via = the entry id or 'floor', gid/gname = the account matched
//   stillAllowed(session, floor) -> boolean           for a session already signed in
//
// Matching is on GitHub's numeric account id wherever one is known. A login can be renamed, and the
// old name then registered by someone else; the id stays with the account. Entries get their id from
// GitHub when they are saved (`lookup`), and the floor and admin lists take `name:id`.
//
// With `source` (partnersource.mjs, the Partner Program app), the entries come from there instead:
// list() is the source's last good read, and add, update and remove are refused (409).
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ConflictError } from './objects.mjs';

export const ACCESS_KEY = 'config/access.json';
export const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const CACHE_MS = 60_000;
const STATUSES = new Set(['active', 'paused']);
const KINDS = new Set(['user', 'org']);

export class AccessError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const lower = (s) => String(s ?? '').trim().toLowerCase();

/** A floor or admin list: "name" or "name:id". With an id, only that GitHub account matches, whatever its name now. */
export function parseNames(list = []) {
  return list.map((x) => {
    const [name, id] = lower(x).replace(/^@/, '').split(':');
    return { name: name.trim(), id: id && id.trim() ? id.trim() : null };
  }).filter((x) => x.name);
}

/** Does a list item name this account ({ id, login })? */
export const names = (item, acct) => (item.id ? item.id === String(acct.id) : item.name === lower(acct.login));

/** Does an entry name this account? By id once it has one; entries saved before ids by name. */
const entryNames = (e, acct) => (e.github_id ? String(e.github_id) === String(acct.id) : e.github === lower(acct.login));

export const MANAGED_MESSAGE = 'Access is managed in the Partner Program app. Change it there.';

export function createAccess({ objects = null, dataDir, now = () => Date.now(), lookup = null, source = null }) {
  const file = join(dataDir, 'access.json');
  let cache = null, cachedAt = 0;

  async function load() {
    if (objects) {
      const o = await objects.get(ACCESS_KEY);
      return { entries: o ? JSON.parse(o.body.toString('utf8')).entries ?? [] : [], etag: o?.etag ?? null };
    }
    return { entries: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).entries ?? [] : [], etag: null };
  }

  async function store(entries, etag) {
    const body = JSON.stringify({ version: 1, entries }, null, 2);
    if (objects) {
      // Conditional on the version this change read: two staff saving at once cannot overwrite each other.
      await objects.put(ACCESS_KEY, body, { ...(etag ? { ifMatch: etag } : { ifNoneMatch: '*' }), contentType: 'application/json' });
    } else {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${file}.tmp`, body); renameSync(`${file}.tmp`, file);
    }
    cache = entries; cachedAt = now();
  }

  async function list({ fresh = false } = {}) {
    // The source keeps its own copy and refreshes it on a timer.
    if (source) { await source.ready(); return source.entries(); }
    if (!fresh && cache && now() - cachedAt < CACHE_MS) return cache;
    cache = (await load()).entries; cachedAt = now();
    return cache;
  }

  // Read, change, write; on a conflict read again once and redo the change. The ETag travels with
  // this change's own read, so a list() by another request in between cannot stand in for it.
  async function change(fn) {
    for (let i = 0; ; i++) {
      const { entries: read, etag } = await load();
      const entries = [...read];
      const out = fn(entries);
      try { await store(entries, etag); return out; }
      catch (err) { if (!(err instanceof ConflictError) || i) throw err; }
    }
  }

  /** The GitHub account's numeric id, checked against the kind chosen. */
  async function resolve(c, token = null) {
    if (!lookup) return c;
    let a;
    try { a = await lookup(c.github, token); }
    catch (err) { throw new AccessError(err.status === 404 ? `There is no GitHub account named ${c.github}.` : 'GitHub did not answer. Try again.', err.status === 404 ? 400 : 502); }
    const kind = a.type === 'Organization' ? 'org' : 'user';
    if (kind !== c.kind) throw new AccessError(kind === 'org' ? `${c.github} is an organisation. Choose organisation.` : `${c.github} is a user. Choose GitHub user.`);
    return { ...c, github: lower(a.login), github_id: String(a.id) };
  }

  function clean(e, partial = false) {
    const out = {};
    if (!partial || e.github !== undefined) {
      const g = String(e.github ?? '').trim().replace(/^@/, '');
      if (!GITHUB_NAME.test(g)) throw new AccessError('Enter a GitHub user or organisation name: letters, numbers and hyphens.');
      out.github = g.toLowerCase();
    }
    if (!partial || e.kind !== undefined) {
      const k = String(e.kind ?? 'user');
      if (!KINDS.has(k)) throw new AccessError('Choose a GitHub user or an organisation.');
      out.kind = k;
    }
    if (!partial || e.status !== undefined) {
      const s = String(e.status ?? 'active');
      if (!STATUSES.has(s)) throw new AccessError('Choose active or paused.');
      out.status = s;
    }
    if (!partial || e.partner !== undefined) {
      const p = String(e.partner ?? '').trim().slice(0, 120);
      if (!p) throw new AccessError('Enter the partner company.');
      out.partner = p;
    }
    if (e.note !== undefined) out.note = String(e.note).trim().slice(0, 500);
    return out;
  }

  const refuseWhenManaged = () => { if (source) throw new AccessError(MANAGED_MESSAGE, 409); };

  return {
    list,
    managed: !!source,
    /** opts.token: the admin's GitHub token, so the lookup uses their rate limit (5000 an hour), not 60. */
    async add(e, by, { token = null } = {}) {
      refuseWhenManaged();
      const c = await resolve(clean(e), token);
      return change((entries) => {
        if (entries.some((x) => x.github === c.github || (c.github_id && x.github_id === c.github_id))) throw new AccessError(`${c.github} is on the list already.`, 409);
        const entry = { id: randomBytes(6).toString('hex'), ...c, note: c.note ?? '', added_by: by, added_at: now(), updated_at: now() };
        entries.push(entry);
        return entry;
      });
    },
    async update(id, patch, by, { token = null } = {}) {
      refuseWhenManaged();
      let c = clean(patch, true);
      if (c.github !== undefined || c.kind !== undefined) {
        // A new name or kind is a different account: look it up again. Sessions it let in end,
        // because they matched the old account's id.
        const cur = (await list({ fresh: true })).find((x) => x.id === id);
        if (!cur) throw new AccessError('That entry is not on the list.', 404);
        const r = await resolve({ github: c.github ?? cur.github, kind: c.kind ?? cur.kind }, token);
        c = { ...c, github: r.github, kind: r.kind ?? c.kind ?? cur.kind, ...(r.github_id ? { github_id: r.github_id } : {}) };
      }
      return change((entries) => {
        const i = entries.findIndex((x) => x.id === id);
        if (i < 0) throw new AccessError('That entry is not on the list.', 404);
        if (c.github && entries.some((x, j) => j !== i && (x.github === c.github || (c.github_id && x.github_id === c.github_id)))) throw new AccessError(`${c.github} is on the list already.`, 409);
        entries[i] = { ...entries[i], ...c, updated_by: by, updated_at: now() };
        return entries[i];
      });
    },
    async remove(id) {
      refuseWhenManaged();
      return change((entries) => {
        const i = entries.findIndex((x) => x.id === id);
        if (i < 0) throw new AccessError('That entry is not on the list.', 404);
        entries.splice(i, 1);
        return true;
      });
    },
    /** May this GitHub account sign in? The floor's named people always; then a paused user entry wins. */
    async decide(who, floor = []) {
      const me = { id: String(who?.id ?? ''), login: lower(who?.login) };
      if (!me.login || !me.id) return { ok: false };
      // An org without an id cannot be checked again later (a session needs gid), so it never lets anyone in.
      const orgs = (who.orgs || []).map((o) => ({ id: String(o.id ?? ''), login: lower(o.login) })).filter((o) => o.login && o.id);
      const fl = parseNames(floor);
      const as = (via, a) => ({ ok: true, via, gid: a.id, gname: a.login });
      // The list unreadable (S3 down, a bad file): the floor still signs in, a person or an org on it,
      // as sessions already signed in keep working (stillAllowed). Nobody else does.
      const entries = await list().catch(() => null);
      if (!entries) {
        if (fl.some((f) => names(f, me))) return as('floor', me);
        const fo = orgs.find((o) => fl.some((f) => names(f, o)));
        return fo ? as('floor', fo) : { ok: false };
      }
      // A person named on the floor list is set at deploy and cannot be paused from the page.
      if (fl.some((f) => names(f, me))) return as('floor', me);
      // A paused entry for the user wins over everything else, a floor organisation included.
      const own = entries.find((x) => x.kind === 'user' && entryNames(x, me));
      if (own?.status === 'paused') return { ok: false, paused: true };
      if (own?.status === 'active') return as(own.id, me);
      const fo = orgs.find((o) => fl.some((f) => names(f, o)));
      if (fo) return as('floor', fo);
      for (const o of orgs) {
        const e = entries.find((x) => x.kind === 'org' && x.status === 'active' && entryNames(x, o));
        if (e) return as(e.id, o);
      }
      return { ok: false };
    },
    /**
     * For a session already signed in: is the account that let it in still listed and active, and is
     * the user not paused? A session from before accounts were recorded (no gid) signs in again.
     * Org membership is checked at sign-in only; sessions end at sessionMaxDays at the latest.
     */
    async stillAllowed(s, floor = []) {
      if (!s?.via || !s.gid) return false;
      const me = { id: String(s.uid), login: lower(s.login) };
      const entries = await list().catch(() => null);
      if (!entries) return s.via === 'floor' && parseNames(floor).some((f) => names(f, { id: String(s.gid), login: lower(s.gname) }));
      const acct = { id: String(s.gid), login: lower(s.gname) };
      if (s.via === 'floor' && acct.id === me.id) return parseNames(floor).some((f) => names(f, acct));
      if (entries.some((x) => x.kind === 'user' && x.status === 'paused' && entryNames(x, me))) return false;
      if (s.via === 'floor') return parseNames(floor).some((f) => names(f, acct));
      const e = entries.find((x) => x.id === s.via);
      return !!e && e.status === 'active' && entryNames(e, acct);
    },
    /** Entries saved before ids were kept get theirs from GitHub. Returns how many were filled in. */
    async backfill() {
      if (!lookup || source) return 0;
      const missing = (await list({ fresh: true })).filter((x) => !x.github_id);
      const found = new Map();
      for (const x of missing) {
        try { const a = await lookup(x.github); found.set(x.id, String(a.id)); } catch { /* left as is; it matches by name */ }
      }
      if (!found.size) return 0;
      await change((entries) => { for (const x of entries) if (found.has(x.id) && !x.github_id) x.github_id = found.get(x.id); });
      return found.size;
    },
  };
}
