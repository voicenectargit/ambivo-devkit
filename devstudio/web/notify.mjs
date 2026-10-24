// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// The email a person gets when their Dev Studio access turns active (DEVSTUDIO_PARTNERPROG_NOTIFY=on).
// partnersource.mjs calls run() after each read of the Partner Program that worked.
//
//   createSes(...)       one call, SESv2 SendEmail, signed with SigV4 like s3.mjs and kms.mjs
//   accessEmail(...)     the subject and text
//   createNotifier(...)  run(entries, activePeople), status()
//
// Who is emailed: a person entry that decide() lets in now (kind user, status active, GitHub id known)
// with a work email and no record in NOTIFIED_KEY. Org entries are never emailed (no address), nor paused
// people. Records live in one object, written with If-Match / If-None-Match, so two servers never send
// twice: a server claims a person ('sending') before it sends, then marks them 'sent'. A claim older than
// CLAIM_MS (the server stopped mid-send) may be taken again. A failed send releases the claim and is tried
// at the next read, up to MAX_TRIES times for one activation.
//
// A record is removed when the person's Partner Program record no longer says active (activePeople), and
// the id is kept in `ended`, so a later re-activation sends the "your access is back" email. The removal
// looks at the record, not at the entry, so a GitHub lookup that fails for one read does not count as
// losing access.
//
// The first run with no records at all (the setting just turned on) records everyone who is active as
// already told and sends nothing.
import { randomBytes } from 'node:crypto';
import { signV4, credentialSource } from './kms.mjs';
import { ConflictError } from './objects.mjs';

export const NOTIFIED_KEY = 'config/partnerprog-notified.json';
export const CLAIM_MS = 15 * 60_000;
export const MAX_TRIES = 5;
export const SIGN_IN_URL = 'https://devstudio.ambivo.com';
export const GUIDE_URL = 'https://content.ambivo.com/p/dev-studio-quick-start';
const WRITE_TRIES = 6;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** SESv2 SendEmail. `endpoint` is for tests (a fake SES). Throws on any failure. */
export function createSes({ region, endpoint = '', credentials = credentialSource(), fetchImpl = fetch, timeoutMs = 15_000 }) {
  const url = `${(endpoint || `https://email.${region}.amazonaws.com`).replace(/\/+$/, '')}/v2/email/outbound-emails`;
  return {
    async send({ from, replyTo, to, subject, text, configurationSet }) {
      const payload = {
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
        Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' } } } },
        ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
      };
      const body = JSON.stringify(payload);
      const { headers } = signV4({ method: 'POST', url, body, service: 'ses', region, credentials: await credentials(), headers: { 'content-type': 'application/json' } });
      let r;
      try {
        r = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        throw new Error(`SES did not answer (${err.name === 'TimeoutError' ? 'timed out' : err.message})`);
      }
      const t = await r.text();
      if (!r.ok) {
        let type = r.headers.get('x-amzn-errortype') || '';
        let msg = '';
        try { const j = JSON.parse(t); msg = j.message || j.Message || ''; type ||= j.__type || ''; } catch {}
        throw new Error(`SES SendEmail failed: HTTP ${r.status} ${String(type).split(':')[0]} ${msg}`.replace(/\s+/g, ' ').trim());
      }
      try { return { messageId: JSON.parse(t).MessageId || null }; } catch { return { messageId: null }; }
    },
  };
}

/** The email. `back`: the person had access before, lost it, and has it again. Nothing secret goes in. */
export function accessEmail({ name, company, github, back = false }) {
  const first = clean(name).split(' ')[0] || 'there';
  const co = clean(company);
  const line = back
    ? `Your access to Ambivo Dev Studio${co ? ` for ${co}` : ''} is back.`
    : `You can now use Ambivo Dev Studio${co ? ` for ${co}` : ''}.`;
  return {
    subject: back ? 'Your Ambivo Dev Studio access is back' : 'Your Ambivo Dev Studio access is ready',
    text: [
      `Hello ${first},`,
      '',
      line,
      `Sign in at ${SIGN_IN_URL} with your GitHub account ${clean(github)}.`,
      '',
      `The quick start guide: ${GUIDE_URL}`,
      '',
      'Your Ambivo sandbox company comes in a separate email.',
      '',
      'Questions? Reply to this email.',
      '',
      'Ambivo',
      '',
    ].join('\n'),
  };
}

const empty = () => ({ version: 1, people: {}, ended: {}, lastSendError: null });

/**
 * @param notify   config.partnerProg.notify: { from, replyTo, configurationSet }
 * @param objects  the object store (objects.mjs or s3.mjs)
 * @param send     async ({ from, replyTo, to, subject, text, configurationSet }) => any; throws on failure
 */
export function createNotifier({ notify, objects, send, log = console.log, now = () => Date.now() }) {
  let problems = [];
  let lastSendError = null;
  let lastRunAt = null, lastRunError = null;
  let lastProblemsLogged = '';

  async function load() {
    const o = await objects.get(NOTIFIED_KEY);
    if (!o) return { doc: null, etag: null };
    const d = JSON.parse(o.body.toString('utf8'));
    return { doc: { ...empty(), ...d, people: d.people || {}, ended: d.ended || {} }, etag: o.etag };
  }

  const put = (doc, etag) => objects.put(NOTIFIED_KEY, JSON.stringify(doc, null, 2), { ...(etag ? { ifMatch: etag } : { ifNoneMatch: '*' }), contentType: 'application/json' });

  /**
   * Read, change, write with If-Match; on a conflict read again and apply the change again. `fn` changes
   * the doc in place and returns { changed, out }. Returns { doc, out } of the version written (or read).
   */
  async function change(fn) {
    for (let i = 0; ; i++) {
      const { doc: read, etag } = await load();
      const doc = read ?? empty();
      const { changed, out } = fn(doc);
      if (!changed) return { doc, out };
      try { await put(doc, etag); return { doc, out }; }
      catch (err) { if (!(err instanceof ConflictError) || i >= WRITE_TRIES - 1) throw err; }
    }
  }

  /** The first run ever: everyone active is recorded as told. False when another server got there first. */
  async function baseline(active, ready) {
    const doc = empty();
    const t = now();
    for (const p of [...active, ...ready]) {
      if (doc.people[p.id]) continue;
      doc.people[p.id] = { state: 'sent', sentAt: t, github: p.github, email: p.email || '', baselined: true };
    }
    doc.baselinedAt = t;
    try { await put(doc, null); }
    catch (err) { if (err instanceof ConflictError) return null; throw err; }
    log(`partner program notify: first run, ${Object.keys(doc.people).length} people who can sign in now recorded as already told; no emails sent`);
    return doc;
  }

  function findProblems(doc, ready) {
    const out = [];
    for (const e of ready) {
      const who = `${e.name || e.github} (${e.github})`;
      const rec = doc.people[e.id];
      if (rec?.state === 'sent') continue;
      if (!e.email) out.push(`${who} can sign in but has no work email in the Partner Program. Dev Studio sent no access email.`);
      else if (!EMAIL.test(e.email)) out.push(`${who} has a work email Dev Studio cannot use: ${e.email}. Dev Studio sent no access email.`);
      else if (rec?.state === 'gave-up') out.push(`Dev Studio could not send the access email to ${who} after ${MAX_TRIES} tries. Last error: ${rec.lastError || 'unknown'}.`);
    }
    return out;
  }

  /**
   * After a read that worked. `entries`: the access entries. `active`: [{ id, github, email }] for every
   * person whose Partner Program record says active (resolved on GitHub or not). Never throws.
   */
  async function run(entries, active = []) {
    try {
      const ready = entries.filter((e) => e.kind === 'user' && e.status === 'active' && e.github_id && String(e.id).startsWith('pp-person-'));
      const activeIds = new Set([...active.map((p) => p.id), ...ready.map((e) => e.id)]);
      let { doc } = await load();
      if (!doc) {
        const b = await baseline(active, ready);
        if (b) { problems = findProblems(b, ready); lastRunAt = now(); lastRunError = null; lastSendError = b.lastSendError; return; }
      }

      // 1. Remove people who can no longer sign in, and claim the people to email.
      const claim = randomBytes(6).toString('hex');
      const removed = [];
      const r1 = await change((d) => {
        let changed = false;
        removed.length = 0;
        const t = now();
        for (const id of Object.keys(d.people)) {
          if (activeIds.has(id)) continue;
          removed.push(d.people[id].github);
          delete d.people[id];
          d.ended[id] = t;
          changed = true;
        }
        const out = [];
        for (const e of ready) {
          if (!e.email || !EMAIL.test(e.email)) continue;
          const rec = d.people[e.id];
          let tries = 0;
          if (rec) {
            if (rec.state === 'sent') continue;
            if (rec.state === 'sending' && t - (rec.claimedAt || 0) < CLAIM_MS) continue;
            // Gave up: tried again only when the address or the account changed.
            if (rec.state === 'gave-up' && rec.email === e.email && rec.github === e.github) continue;
            if (rec.state === 'failed' || rec.state === 'sending') tries = rec.tries || 0;
          }
          const back = !!(d.ended[e.id] || rec?.back);
          d.people[e.id] = { state: 'sending', claim, claimedAt: t, github: e.github, email: e.email, tries, back, ...(rec?.lastError ? { lastError: rec.lastError } : {}) };
          out.push({ e, back, tries });
          changed = true;
        }
        return { changed, out };
      });
      for (const g of removed) log(`partner program notify: ${g} can no longer sign in; their record is removed`);

      // 2. Send.
      const results = [];
      for (const { e, back, tries } of r1.out) {
        const m = accessEmail({ name: e.name, company: e.partner, github: e.github, back });
        try {
          await send({ from: notify.from, replyTo: notify.replyTo, to: e.email, subject: m.subject, text: m.text, configurationSet: notify.configurationSet });
          results.push({ e, ok: true, back });
          log(`partner program notify: sent the access ${back ? '"back" ' : ''}email to ${e.github} (${e.id})`);
        } catch (err) {
          const n = tries + 1;
          results.push({ e, ok: false, back, tries: n, error: String(err.message || err).slice(0, 300) });
          log(`partner program notify: sending to ${e.github} (${e.id}) failed, try ${n} of ${MAX_TRIES}${n >= MAX_TRIES ? ', giving up' : ', tried again at the next read'}: ${err.message}`);
        }
      }

      // 3. Record what happened, for this server's claims only.
      const r3 = results.length ? await change((d) => {
        let changed = false;
        const t = now();
        for (const x of results) {
          const rec = d.people[x.e.id];
          if (!rec || rec.claim !== claim) continue;
          changed = true;
          if (x.ok) {
            d.people[x.e.id] = { state: 'sent', sentAt: t, github: x.e.github, email: x.e.email, ...(x.back ? { back: true } : {}) };
          } else {
            d.people[x.e.id] = { state: x.tries >= MAX_TRIES ? 'gave-up' : 'failed', github: x.e.github, email: x.e.email, tries: x.tries, back: x.back, lastError: x.error, lastTriedAt: t };
            d.lastSendError = { at: t, github: x.e.github, message: x.error };
          }
        }
        if (results.some((x) => x.ok) && !results.some((x) => !x.ok) && d.lastSendError) { d.lastSendError = null; changed = true; }
        return { changed, out: null };
      }) : r1;

      problems = findProblems(r3.doc, ready);
      lastSendError = r3.doc.lastSendError ?? null;
      lastRunAt = now(); lastRunError = null;
      const p = problems.join('\n');
      if (p !== lastProblemsLogged) {
        if (problems.length) log(`partner program notify: ${problems.length} people can sign in but get no access email (listed in config/partnerprog-notified.json)`);
        lastProblemsLogged = p;
      }
    } catch (err) {
      lastRunError = `The access emails could not be checked (${err.message}).`;
      log(`partner program notify: failed, tried again at the next read: ${err.message}`);
    }
  }

  return {
    run,
    status() { return { on: true, problems, lastSendError, lastRunAt, lastRunError }; },
  };
}
