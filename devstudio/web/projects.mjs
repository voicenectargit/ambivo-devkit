// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// The project list and each project's conversation history (its events).
//
// Two stores with the same operations:
//
//   createFileProjects   DEVSTUDIO_DATA/projects.json, one file with every project and its events.
//                        Laptop mode and a single server without S3. This is how Dev Studio always
//                        saved projects, unchanged.
//   createObjectProjects one object per record in an object store (S3 when DEVSTUDIO_S3_BUCKET is set),
//                        so two servers never overwrite each other's lists:
//                          projects/<id>.json           the record: owner, name, created, session, cost
//                          projects/<id>/events.jsonl   the history, one event per line, newest last
//                          owners/<uid>/<id>            empty marker: lists a user's projects
//
// `cache` maps id -> entry, where an entry is the record plus `events` (an array). app.mjs reads entries
// from it; tests look at it.
//
// Operations (async unless marked):
//   list(ownerId)            entries the owner may see (laptop mode: also projects with no owner)
//   get(id, { refresh })     the entry, or null. refresh=false answers from memory when it can
//   create(record)           a new project
//   update(id, fn)           fn(record) changes fields; saved at once
//   append(id, event)  sync  adds an event to the history; saved soon (see createObjectProjects)
//   history(id)              the events, current
//   flush(id) / flushAll()   save pending events now
//   remove(id)               the record, its history and its marker
//   listAll()                every project's record (no events, every owner), for start-up work such as
//                            putting share links back. Not cached.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictError } from './objects.mjs';

export const MAX_EVENTS = 2000;
const trim = (events) => { if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS); return events; };
const recordOf = ({ events, ...rec }) => rec;

/** Today's single file. Every change rewrites it; fine for one server and a handful of projects. */
export function createFileProjects({ dataDir }) {
  const STATE = join(dataDir, 'projects.json');
  mkdirSync(dataDir, { recursive: true });
  const cache = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  for (const p of Object.values(cache)) p.events ??= [];

  function save() {
    const tmp = `${STATE}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache, null, 2));
    renameSync(tmp, STATE);
  }

  return {
    kind: 'file',
    cache,
    async list() { return Object.values(cache); },
    async listAll() { return Object.values(cache).map(recordOf); },
    async get(id) { return cache[id] ?? null; },
    async create(record) { cache[record.id] = { ...record, events: [] }; save(); return cache[record.id]; },
    async update(id, fn) { const p = cache[id]; if (!p) return null; fn(p); save(); return p; },
    append(id, event) { const p = cache[id]; if (!p) return; p.events.push(event); trim(p.events); save(); },
    async history(id) { return cache[id]?.events ?? []; },
    async flush() {},
    async flushAll() {},
    async remove(id) { delete cache[id]; save(); },
  };
}

/**
 * Projects in an object store, shared by every server that uses it.
 *
 * Events: a message's run emits many small events (every tool call). Each one is added in memory at
 * once (the page gets it live), and the history object is rewritten at most every `flushMs` while
 * events keep coming, and at once when a turn ends (app.mjs calls flush). A five-minute turn costs
 * about 60 PUTs at the default 5 s; a crash loses at most the last few seconds of the history.
 * One object (not one per chunk) keeps a history load to a single GET.
 *
 * Races. Two servers write the same object only when both run the same project, which needs the
 * routing described in docs/HOSTING_PLAN.md ("Running more than one server"). Until then:
 *   - a record is created with If-None-Match: * (a clash of random ids fails instead of overwriting);
 *   - a record update is If-Match on the ETag read; on a conflict it reads the record again and
 *     re-applies the change;
 *   - the history is written If-Match too; on a conflict it reads the other server's history and
 *     puts this server's unsaved events after it, so neither server's events are lost.
 *   - markers and deletes cannot conflict: a marker has no content, and a delete is final.
 * Reads revalidate with If-None-Match, so an unchanged record or history costs a 304, not a download.
 */
export function createObjectProjects({ objects, log = console.log, flushMs = 5000, tags = { kind: 'events' } }) {
  const cache = {};
  const meta = new Map();   // id -> { recEtag, evEtag, pending, timer, removed }
  const chains = new Map(); // id -> promise: writes to one project run one at a time
  const recKey = (id) => `projects/${id}.json`;
  const evKey = (id) => `projects/${id}/events.jsonl`;
  const ownerKey = (uid, id) => `owners/${uid}/${id}`;
  const m = (id) => { if (!meta.has(id)) meta.set(id, { recEtag: null, evEtag: null, pending: 0, timer: null, removed: false }); return meta.get(id); };

  function serial(id, fn) {
    const next = (chains.get(id) ?? Promise.resolve()).then(fn, fn);
    chains.set(id, next.catch(() => {}));
    return next;
  }

  const parseEvents = (body) => body.toString('utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const encodeEvents = (events) => events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');

  /** Read (or revalidate) the record into the cache. Returns the entry or null. */
  async function loadRecord(id) {
    const s = m(id);
    const o = await objects.get(recKey(id), { ifNoneMatch: cache[id] ? s.recEtag : undefined });
    if (!o) { delete cache[id]; meta.delete(id); return null; }
    if (o.notModified) return cache[id];
    const rec = JSON.parse(o.body.toString('utf8'));
    const entry = cache[id] ?? (cache[id] = { events: [] });
    for (const k of Object.keys(entry)) if (k !== 'events' && !(k in rec)) delete entry[k];
    Object.assign(entry, rec);
    s.recEtag = o.etag;
    return entry;
  }

  /** Read (or revalidate) the history. Unsaved events are saved first, so nothing is dropped. */
  async function loadEvents(id) {
    const s = m(id);
    if (s.pending) return flush(id);
    const o = await objects.get(evKey(id), { ifNoneMatch: s.evEtag || undefined });
    if (!o || o.notModified) return;
    const entry = cache[id];
    if (!entry) return;
    // Events added while the read was on its way stay, after the saved ones.
    const tail = s.pending ? entry.events.slice(entry.events.length - s.pending) : [];
    entry.events.splice(0, entry.events.length, ...trim([...parseEvents(o.body), ...tail]));
    s.evEtag = o.etag;
  }

  function flush(id) {
    const s = m(id);
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    return serial(id, async () => {
      const entry = cache[id];
      if (!entry || s.removed || !s.pending) return;
      for (let attempt = 0; attempt < 5; attempt++) {
        const n = s.pending;
        try {
          const { etag } = await objects.put(evKey(id), encodeEvents(entry.events),
            { ...(s.evEtag ? { ifMatch: s.evEtag } : { ifNoneMatch: '*' }), contentType: 'application/x-ndjson', tags });
          s.evEtag = etag;
          s.pending = Math.max(0, s.pending - n);
          return;
        } catch (err) {
          if (!(err instanceof ConflictError)) throw err;
          // Another server wrote the history: take theirs, then this server's unsaved events after it.
          const o = await objects.get(evKey(id));
          const theirs = o ? parseEvents(o.body) : [];
          const mine = entry.events.slice(entry.events.length - s.pending);
          entry.events.splice(0, entry.events.length, ...trim([...theirs, ...mine]));
          s.evEtag = o?.etag ?? null;
          log(`project ${id}: history changed on another server; merged ${mine.length} events after ${theirs.length}`);
        }
      }
      throw new Error(`project ${id}: the history kept changing; ${s.pending} events not saved yet`);
    });
  }

  function schedule(id) {
    const s = m(id);
    if (s.timer) return;
    s.timer = setTimeout(() => { s.timer = null; flush(id).catch((err) => log(`project ${id}: saving history: ${err.message}`)); }, flushMs);
    s.timer.unref?.();
  }

  return {
    kind: 'objects',
    cache,

    async list(ownerId) {
      const ids = (await objects.list(`owners/${ownerId}/`)).map((k) => k.split('/').pop());
      const out = [];
      for (const id of ids) {
        try {
          const e = await loadRecord(id);
          if (e) out.push(e);   // a marker without a record: a delete that stopped half way
        } catch (err) { log(`project ${id}: ${err.message}`); }
      }
      return out.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
    },

    async listAll() {
      const ids = [...new Set((await objects.list('owners/')).map((k) => k.split('/').pop()))];
      const out = [];
      for (const id of ids) {
        try {
          const o = await objects.get(recKey(id));
          if (o) out.push(JSON.parse(o.body.toString('utf8')));
        } catch (err) { log(`project ${id}: ${err.message}`); }
      }
      return out;
    },

    async get(id, { refresh = true } = {}) {
      if (!refresh && cache[id]) return cache[id];
      const e = await loadRecord(id);
      if (e) await loadEvents(id);
      return e;
    },

    async create(record) {
      const s = m(record.id);
      // Record first, marker second: a crash between them leaves an unlisted record, never a
      // listed project with no record.
      const { etag } = await objects.put(recKey(record.id), JSON.stringify(record), { ifNoneMatch: '*', contentType: 'application/json' });
      s.recEtag = etag;
      await objects.put(ownerKey(record.owner?.id ?? 'local', record.id), '', { contentType: 'text/plain' });
      cache[record.id] = { ...record, events: [] };
      return cache[record.id];
    },

    update(id, fn) {
      return serial(id, async () => {
        const s = m(id);
        for (let attempt = 0; attempt < 5; attempt++) {
          const entry = cache[id] ?? await loadRecord(id);
          if (!entry || s.removed) return null;
          const rec = structuredClone(recordOf(entry));
          fn(rec);
          try {
            const { etag } = await objects.put(recKey(id), JSON.stringify(rec), { ifMatch: s.recEtag, contentType: 'application/json' });
            Object.assign(entry, rec);
            s.recEtag = etag;
            return entry;
          } catch (err) {
            if (!(err instanceof ConflictError)) throw err;
            log(`project ${id}: record changed on another server; applying the change again`);
            if (!(await loadRecord(id))) return null;
          }
        }
        throw new Error(`project ${id}: the record kept changing`);
      });
    },

    append(id, event) {
      const entry = cache[id];
      if (!entry) return;
      entry.events.push(event);
      trim(entry.events);
      const s = m(id);
      s.pending = Math.min(s.pending + 1, entry.events.length);
      schedule(id);
    },

    async history(id) {
      if (!cache[id]) return [];
      await loadEvents(id);
      return cache[id]?.events ?? [];
    },

    flush,

    async flushAll() {
      await Promise.all([...meta.keys()].map((id) => flush(id).catch((err) => log(`project ${id}: saving history: ${err.message}`))));
    },

    async remove(id) {
      const entry = cache[id] ?? await loadRecord(id);
      const s = m(id);
      s.removed = true;
      if (s.timer) clearTimeout(s.timer);
      await serial(id, async () => {
        // Marker first: once it is gone no server lists the project, whatever happens next.
        if (entry) await objects.delete(ownerKey(entry.owner?.id ?? 'local', id));
        await objects.delete(recKey(id));
        await objects.delete(evKey(id));
      });
      delete cache[id];
      meta.delete(id);
      chains.delete(id);
    },
  };
}
