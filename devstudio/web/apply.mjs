// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Asking for Dev Studio access: for a GitHub account that signed in and is not on the list.
// On with DEVSTUDIO_PARTNER_APPLY=on and the Partner Program source (config.partnerProg.apply).
//
//   GET  /apply           the step the person is on (or where their last application stands)
//   POST /apply/email     name and work email: emails a 6-digit code
//   POST /apply/code      the code: the email is checked. Its domain is matched against the partners:
//                         a match files a "join" application at once; no match asks for the company
//   POST /apply/details   company, website, country, apps or websites, what they build: files a
//                         "new_partner" application. A website a partner uses is told to staff only
//                         ("Website matches partner ..."); the applicant is never shown a partner's name
//   POST /apply/restart   use another email
//
// Who is asking comes from the __Host-ds_apply cookie (ds_apply on plain http; scope 'apply'), set by the
// GitHub callback when it refuses someone who is not paused. It carries the GitHub id and login; while a code
// waits, the code's request id (cid); once the code is right, the email, and 2 more hours. A code is kept
// with the GitHub id and cid that asked for it, and only that cookie can use it.
// Codes live in memory only: a restart means asking for a new one. Applications are Partner Program
// records (partnerprog_application), added with Dev Studio's key; staff approve them on devpartner, and the
// person then gets the usual access email (notify.mjs). Ambivo staff are emailed each new application; a
// free-mail work email is marked "(personal email)" there. Every page sends X-Frame-Options: DENY and a CSP.
//
// Limits: one pending application per GitHub account, and no code while one is pending. Codes: 5 per
// account an hour; 3 per address an hour and 10 a day; 20 per address domain an hour; 200 an hour in all
// (then the form says Dev Studio is busy). A send that fails counts too. 5 tries per code, and 15 wrong
// codes per address a day across codes. A code is kept as a SHA-256 only.
// Every counter is in this process's memory. Dev Studio runs on one host, so that is the whole count;
// a restart clears them.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sign, verify, parseCookies, cookie } from './session.mjs';
import { createSes } from './notify.mjs';
import { emailDomain, websiteDomain, isFreeMail } from './partnersource.mjs';

export const APPLY_COOKIE = 'ds_apply';
// __Host-: the browser takes it only from this exact host, over HTTPS, with no Domain. Partner code on
// p-<id> and s-<id> can set cookies for the parent domain; a planted ds_apply filed requests as the planter.
export const applyCookieName = (secure) => (secure ? `__Host-${APPLY_COOKIE}` : APPLY_COOKIE);
const COOKIE_HOURS = 2;
const CODE_MS = 15 * 60_000;
const CODE_TRIES = 5;
const CODES_PER_PERSON_HOUR = 5;
const CODES_PER_ADDRESS_HOUR = 3;
const CODES_PER_ADDRESS_DAY = 10;
const CODES_PER_DOMAIN_HOUR = 20;
const WRONG_PER_ADDRESS_DAY = 15;
const CODES_ALL_HOUR = 200;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
// SES refusing the address itself (a malformed or impossible address). Anything else is our side.
const ADDRESS_REFUSED = /illegal address|invalid (email )?address|address (is )?(invalid|not valid|malformed)|invalid recipient|recipient.*(invalid|not valid|refused)/i;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const BUILDS = { apps: 'Apps', websites: 'Websites', both: 'Apps and websites' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

/** Times per key, kept for a day, in memory. Old times are dropped once an hour. */
function counter(now) {
  const m = new Map();
  let swept = now();
  return {
    count(key, windowMs) { const t = now(); return (m.get(key) || []).filter((x) => t - x < windowMs).length; },
    add(key) {
      const t = now();
      if (t - swept > HOUR) {
        swept = t;
        for (const [k, a] of m) { const kept = a.filter((x) => t - x < DAY); if (kept.length) m.set(k, kept); else m.delete(k); }
      }
      m.set(key, [...(m.get(key) || []).filter((x) => t - x < DAY), t]);
    },
  };
}

/** ISO 3166 two-letter codes with their English names, sorted by name. */
export const COUNTRIES = (() => {
  const dn = new Intl.DisplayNames(['en'], { type: 'region' });
  const skip = new Set(['EU', 'EZ', 'UN', 'ZZ', 'QO', 'XA', 'XB', 'XK', 'AA', 'QM', 'QN', 'QP', 'QQ', 'QR', 'QS', 'QT', 'QU', 'QV', 'QW', 'QX', 'QY', 'QZ']);
  const out = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    if (skip.has(code) || code.startsWith('X')) continue;
    let name;
    try { name = dn.of(code); } catch { continue; }
    if (name && name !== code && !/^Unknown/.test(name)) out.push([code, name]);
  }
  return out.sort((x, y) => x[1].localeCompare(y[1]));
})();
const COUNTRY = new Map(COUNTRIES);

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;margin:32px 16px;max-width:640px;color:#1d1b20}
label{display:block;font-weight:600;margin:16px 0 4px}.hint{color:#555;font-size:14px;margin:2px 0 6px}
input,select,textarea{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid #aaa;border-radius:8px}
textarea{min-height:120px}button{margin-top:20px;font:inherit;font-weight:600;padding:10px 22px;border:0;border-radius:20px;background:#6750a4;color:#fff;cursor:pointer}
button.link{background:none;color:#6750a4;padding:0;margin-top:8px;text-decoration:underline;font-weight:400}
.error{color:#b3261e;font-weight:600}.box{background:#f3edf7;border-radius:12px;padding:12px 16px;margin:16px 0}
fieldset{border:0;padding:0;margin:0}fieldset label{display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0}fieldset input{width:auto}`;

// The pages have no script and one inline style. Nothing may frame them, and forms post only to Dev Studio.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

function html(res, code, title, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': CSP, ...headers });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style><body><h1 style="font-size:24px">${esc(title)}</h1>${body}</body>`);
}

async function readForm(req, max = 20_000) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > max) throw Object.assign(new Error('too large'), { status: 413 }); }
  return Object.fromEntries(new URLSearchParams(raw));
}

/**
 * @param source     partnersource.mjs: partnerForEmail, applications, addApplication
 * @param send       optional: ({ to, subject, text }) => Promise. Default: SES with config.partnerProg.notify
 */
export function createApply({ config, source, send: sendIn = null, fetchImpl = fetch, credentials = null, log = console.log, now = () => Date.now() }) {
  const nc = config.partnerProg.notify;
  const ap = config.partnerProg.apply;
  const ses = sendIn ? null : createSes({ region: nc.region, endpoint: nc.sesEndpoint, fetchImpl, ...(credentials ? { credentials } : {}) });
  const send = sendIn ?? (({ to, subject, text }) => ses.send({ from: nc.from, replyTo: nc.replyTo, to, subject, text, configurationSet: nc.configurationSet }));
  const cookieBase = { secure: !!config.secureCookies };
  const COOKIE = applyCookieName(cookieBase.secure);
  const codes = new Map();     // GitHub id -> { uid, cid, email, name, hash, exp, tries }
  // Codes asked for (sent or not: a failed send counts too), and wrong codes entered.
  const byAccount = counter(now), byAddress = counter(now), byDomain = counter(now), all = counter(now), wrong = counter(now);

  const who = (req) => verify(parseCookies(req.headers.cookie)[COOKIE], config.sessionSecret, { scope: 'apply', now: now() });
  const setWho = (w) => cookie(COOKIE, sign({ ...w, scope: 'apply' }, config.sessionSecret), { ...cookieBase, maxAge: Math.max(1, Math.round((w.exp - now()) / 1000)) });

  /** The cookie for a refused GitHub account. app.mjs sets it in the sign-in callback. */
  function startCookie(gh) {
    return setWho({ uid: String(gh.id), login: String(gh.login), exp: now() + COOKIE_HOURS * 3600_000 });
  }

  /** The live code this cookie asked for: the same GitHub id and the same request (cid), or null. */
  function codeFor(w) {
    const c = codes.get(w.uid);
    if (!c || c.exp <= now() || c.uid !== w.uid || !w.cid || c.cid !== w.cid) return null;
    return c;
  }

  const sameOrigin = (req) => String(req.headers.origin || '') === config.publicUrl;

  // ---- pages --------------------------------------------------------------------------------

  const signInLink = '<p><a href="/auth/login">Sign in with GitHub</a></p>';

  function emailForm(res, w, { error = '', name = '', email = '', declined = null } = {}) {
    return html(res, error ? 400 : 200, 'Ask for access to Dev Studio', `
      <p>You signed in to GitHub as <b>${esc(w.login)}</b>. This account cannot use Dev Studio yet.</p>
      ${declined ? `<div class="box">Ambivo said no to your last request. The reason: ${esc(declined)}</div><p>You can ask again.</p>` : ''}
      <p>Tell us who you are. We send a code to your work email to check it.</p>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <form method="post" action="/apply/email">
        <label for="name">Your full name</label><input id="name" name="name" required maxlength="100" autocomplete="name" value="${esc(name)}">
        <label for="email">Work email</label><p class="hint">Use your company email. We use its domain to find your company.</p>
        <input id="email" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(email)}">
        <button>Send me a code</button>
      </form>`);
  }

  function codeForm(res, w, c, error = '', headers = {}) {
    return html(res, error ? 400 : 200, 'Enter your code', `
      <p>We sent a 6-digit code to <b>${esc(c.email)}</b>. It works for 15 minutes.</p>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <form method="post" action="/apply/code">
        <label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required>
        <button>Check the code</button>
      </form>
      <form method="post" action="/apply/restart"><button class="link">Use another email</button></form>`, headers);
  }

  function detailsForm(res, w, { error = '', f = {} } = {}) {
    const opts = COUNTRIES.map(([c, n]) => `<option value="${c}"${f.country === c ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const radio = (v) => `<label><input type="radio" name="builds" value="${v}" required${f.builds === v ? ' checked' : ''}> ${BUILDS[v]}</label>`;
    return html(res, error ? 400 : 200, 'Ask to become a partner', `
      <p>Your email <b>${esc(w.email)}</b> is checked. No Ambivo partner uses its domain yet.</p>
      <p>Tell us about your company. Ambivo reviews each request.</p>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <form method="post" action="/apply/details">
        <label for="company">Company name</label><input id="company" name="company" required maxlength="120" autocomplete="organization" value="${esc(f.company)}">
        <label for="website">Company website</label><input id="website" name="website" maxlength="200" placeholder="https://example.com" value="${esc(f.website)}">
        <label for="country">Country</label><select id="country" name="country" required><option value="">Choose a country</option>${opts}</select>
        <fieldset><legend><label style="margin-bottom:0">What will you build in Dev Studio?</label></legend>${radio('apps')}${radio('websites')}${radio('both')}</fieldset>
        <label for="about">What do you build, and for whom?</label><p class="hint">For example: stock apps for small warehouses. Or: websites for local shops.</p>
        <textarea id="about" name="about" required minlength="10" maxlength="2000">${esc(f.about)}</textarea>
        <button>Send my request</button>
      </form>
      <form method="post" action="/apply/restart"><button class="link">Use another email</button></form>`);
  }

  function waitingPage(res, a) {
    const join = a.kind === 'join';
    return html(res, 200, 'Your request is with Ambivo', `
      <p>${join
        ? `You asked to join <b>${esc(a.company_name)}</b> in Dev Studio. Ask your company admin to tell Ambivo it is OK.`
        : `You asked for <b>${esc(a.company_name)}</b> to become an Ambivo partner.`}</p>
      <p>We email <b>${esc(a.work_email)}</b> when you can sign in. Questions: <a href="mailto:dev-partner@ambivo.com">dev-partner@ambivo.com</a>.</p>`);
  }

  function problemPage(res, text, status = 503) {
    return html(res, status, 'Dev Studio', `<p class="error">${esc(text)}</p><p><a href="/apply">Try again</a></p>`);
  }

  // ---- steps --------------------------------------------------------------------------------

  /** The person's applications, or a page already sent when Ambivo did not answer. */
  async function mine(res, w) {
    try { return await source.applications(w.uid); }
    catch (err) {
      log(`apply: reading applications for ${w.login}: ${err.code || ''} ${err.message}`);
      problemPage(res, 'Dev Studio cannot reach Ambivo right now. Try again in a few minutes.');
      return null;
    }
  }

  async function show(res, w) {
    const apps = await mine(res, w);
    if (!apps) return;
    const pending = apps.find((a) => a.status === 'pending');
    if (pending) return waitingPage(res, pending);
    const last = apps[0];
    if (last?.status === 'approved') {
      return html(res, 200, 'Your request was approved', `<p>You can sign in within 5 minutes. We also sent an email to <b>${esc(last.work_email)}</b>.</p>${signInLink}`);
    }
    if (w.email) return detailsForm(res, w);
    const c = codeFor(w);
    if (c) return codeForm(res, w, c);
    return emailForm(res, w, { declined: last?.status === 'declined' ? (last.decision_note || 'none given') : null });
  }

  /** `siteMatch`: the partner whose domain the website is, for staff only. The applicant never sees it. */
  async function notifyStaff(a, id, { siteMatch = null } = {}) {
    const join = a.kind === 'join';
    const subject = join ? `Dev Studio: ${a.full_name} asks to join ${a.company_name}` : `Dev Studio: ${a.company_name} asks to become a partner`;
    const text = [
      join ? `${a.full_name} asks to join ${a.company_name}, which is already a partner.` : `${a.company_name} asks to become an Ambivo partner.`,
      '',
      `Name: ${a.full_name}`,
      `Email (checked with a code): ${a.work_email}${isFreeMail(emailDomain(a.work_email)) ? ' (personal email)' : ''}`,
      `GitHub: ${a.github_login} (https://github.com/${a.github_login})`,
      ...(join ? [] : [`Website: ${a.website || '(none)'}`, ...(siteMatch ? [`Website matches partner ${siteMatch.company}`] : []), `Country: ${COUNTRY.get(a.country) || a.country}`, `Builds: ${BUILDS[a.builds] || a.builds}`, '', a.about]),
      '',
      `Approve or decline: ${ap.reviewUrl}/applications/${id}`,
    ].join('\n');
    try { await send({ to: ap.staffTo, subject, text }); }
    catch (err) { log(`apply: emailing staff about application ${id}: ${err.message}`); }
  }

  async function file(res, w, data, staff = {}) {
    const apps = await mine(res, w);
    if (!apps) return null;
    const pending = apps.find((a) => a.status === 'pending');
    if (pending) { waitingPage(res, pending); return null; }
    const a = {
      status: 'pending', github_login: w.login.toLowerCase(), github_id: w.uid, full_name: w.name, work_email: w.email,
      email_verified_date: new Date(w.verifiedAt).toISOString(), submitted_date: new Date(now()).toISOString(), ...data,
    };
    let id;
    try { id = await source.addApplication(a); }
    catch (err) {
      log(`apply: saving the application of ${w.login}: ${err.code || ''} ${err.message}`);
      problemPage(res, 'Dev Studio could not send your request to Ambivo. Try again in a few minutes.');
      return null;
    }
    log(`apply: ${a.kind} application ${id} from ${w.login} (${emailDomain(w.email)})`);
    await notifyStaff(a, id, staff);
    return a;
  }

  async function postEmail(req, res, w) {
    const f = await readForm(req);
    const name = clean(f.name, 100);
    const email = clean(f.email, 200).toLowerCase();
    if (name.length < 2) return emailForm(res, w, { error: 'Enter your full name.', name, email });
    if (!EMAIL.test(email) || !emailDomain(email)) return emailForm(res, w, { error: 'Enter an email address like name@company.com.', name, email });
    // A request already waiting needs no code: show where it stands.
    const apps = await mine(res, w);
    if (!apps) return;
    const pending = apps.find((a) => a.status === 'pending');
    if (pending) return waitingPage(res, pending);
    const domain = emailDomain(email);
    const limit = all.count('*', HOUR) >= CODES_ALL_HOUR ? 'Dev Studio is busy. Try again in an hour.'
      : byAccount.count(w.uid, HOUR) >= CODES_PER_PERSON_HOUR ? 'Too many codes were sent. Try again in an hour.'
        : wrong.count(email, DAY) >= WRONG_PER_ADDRESS_DAY ? 'Too many wrong codes were entered for this email today. Try again tomorrow.'
          : byAddress.count(email, DAY) >= CODES_PER_ADDRESS_DAY ? 'Too many codes were sent to this email today. Try again tomorrow.'
            : byAddress.count(email, HOUR) >= CODES_PER_ADDRESS_HOUR ? 'Too many codes were sent to this email. Try again in an hour.'
              : byDomain.count(domain, HOUR) >= CODES_PER_DOMAIN_HOUR ? `Too many codes were sent to ${domain} addresses. Try again in an hour.`
                : '';
    if (limit) {
      log(`apply: code refused for ${w.login} (${domain}): ${limit}`);
      return emailForm(res, w, { error: limit, name, email });
    }
    // Counted before sending, so a send that fails still counts.
    byAccount.add(w.uid); byAddress.add(email); byDomain.add(domain); all.add('*');
    const t = now();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await send({ to: email, subject: `Your Dev Studio code: ${code}`,
        text: `Your Dev Studio code is ${code}.\n\nEnter it in Dev Studio within 15 minutes.\n\nIf you did not ask for this code, you can ignore this email.\n` });
    } catch (err) {
      log(`apply: sending a code for ${w.login}: ${err.message}`);
      const error = ADDRESS_REFUSED.test(err.message) && !/not verified/i.test(err.message)
        ? 'We could not send email to this address. Check it, or use another email.'
        : 'We could not send the code right now. Try again in a few minutes.';
      return emailForm(res, w, { error, name, email });
    }
    // The code belongs to this account and this cookie: cid is kept with the code and in the cookie.
    const cid = randomBytes(12).toString('base64url');
    const c = { uid: w.uid, cid, email, name, hash: sha(`${w.uid}:${code}`), exp: t + CODE_MS, tries: 0 };
    codes.set(w.uid, c);
    return codeForm(res, w, c, '', { 'Set-Cookie': setWho({ ...w, cid }) });
  }

  async function postCode(req, res, w) {
    const f = await readForm(req);
    const c = codeFor(w);
    if (!c) {
      const held = codes.get(w.uid);
      if (held && held.exp > now()) log(`apply: a code for ${w.login} was sent with another sign-in; refused`);
      else codes.delete(w.uid);
      return emailForm(res, w, { error: 'Your code has run out. Ask for a new one.' });
    }
    const entered = String(f.code || '').replace(/\s+/g, '');
    const ok = /^\d{6}$/.test(entered) && timingSafeEqual(Buffer.from(sha(`${w.uid}:${entered}`)), Buffer.from(c.hash));
    if (!ok) {
      c.tries++;
      wrong.add(c.email);
      if (wrong.count(c.email, DAY) >= WRONG_PER_ADDRESS_DAY) {
        codes.delete(w.uid);
        return emailForm(res, w, { error: 'Too many wrong codes were entered for this email today. Try again tomorrow.', name: c.name, email: c.email });
      }
      if (c.tries >= CODE_TRIES) { codes.delete(w.uid); return emailForm(res, w, { error: 'That code was wrong 5 times. Ask for a new one.', name: c.name, email: c.email }); }
      return codeForm(res, w, c, `That code is wrong. You have ${CODE_TRIES - c.tries} tries left.`);
    }
    codes.delete(w.uid);
    // A checked email renews the cookie: 2 hours from now to fill in the details.
    const { cid, ...base } = w;
    const v = { ...base, email: c.email, name: c.name, verifiedAt: now(), exp: now() + COOKIE_HOURS * 3600_000 };
    const headers = { 'Set-Cookie': setWho(v) };
    const match = source.partnerForEmail(c.email);
    if (!match) { res.writeHead(303, { Location: '/apply', ...headers }); return res.end(); }
    // The company is already a partner: its people are added by Ambivo, with the company's say-so.
    const a = await file(res, v, { kind: 'join', partner_id: match.partner_id, company_name: match.company });
    if (!a) return;
    return html(res, 200, 'Your company is already a partner', `
      <p><b>${esc(match.company)}</b> already works with Ambivo. Ask your company admin to add you.</p>
      <p>We sent Ambivo your request to join, with your GitHub name <b>${esc(v.login)}</b>. Ambivo checks with your company first.</p>
      <p>We email <b>${esc(v.email)}</b> when you can sign in.</p>`, headers);
  }

  async function postDetails(req, res, w) {
    if (!w.email) { res.writeHead(303, { Location: '/apply' }); return res.end(); }
    const f = await readForm(req);
    const form = { company: clean(f.company, 120), website: clean(f.website, 200), country: clean(f.country, 2).toUpperCase(), builds: clean(f.builds, 10), about: String(f.about ?? '').trim().slice(0, 2000) };
    const fail = (error) => detailsForm(res, w, { error, f: form });
    if (form.company.length < 2) return fail('Enter your company name.');
    const site = form.website ? websiteDomain(form.website) : '';
    if (form.website && !site.includes('.')) return fail('Enter the website like https://example.com, or leave it empty.');
    if (!COUNTRY.has(form.country)) return fail('Choose your country.');
    if (!BUILDS[form.builds]) return fail('Choose apps, websites, or both.');
    if (form.about.length < 10) return fail('Say in a sentence or two what you build, and for whom.');
    // A website a partner uses is told to staff only: telling the applicant would name the partner.
    const siteMatch = site ? source.partnerForEmail(`x@${site}`) : null;
    const a = await file(res, w, {
      kind: 'new_partner', company_name: form.company, website: site ? `https://${site}` : '', country: form.country,
      builds: form.builds, about: form.about,
    }, { siteMatch });
    if (!a) return;
    return html(res, 200, 'Thank you. Your request is with Ambivo', `
      <p>Ambivo reviews each request. We email <b>${esc(w.email)}</b> when you can sign in.</p>
      <p>Questions: <a href="mailto:dev-partner@ambivo.com">dev-partner@ambivo.com</a>.</p>`);
  }

  // ---- routing ------------------------------------------------------------------------------

  /** Answers /apply and /apply/*. Returns false for any other path. */
  async function handle(req, res, url) {
    if (url.pathname !== '/apply' && !url.pathname.startsWith('/apply/')) return false;
    if (!ap.on) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return true; }
    const w = who(req);
    if (!w?.uid) {
      if (req.method === 'GET') return html(res, 200, 'Ask for access to Dev Studio', `<p>Sign in with GitHub first. Then you can ask for access.</p>${signInLink}`), true;
      return problemPage(res, 'Your session has ended. Sign in with GitHub again.', 401), true;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/apply') await show(res, w);
      else if (req.method !== 'POST') { res.writeHead(405); res.end(); }
      else if (!sameOrigin(req)) problemPage(res, 'This form must be sent from Dev Studio.', 403);
      else if (url.pathname === '/apply/email') await postEmail(req, res, w);
      else if (url.pathname === '/apply/code') await postCode(req, res, w);
      else if (url.pathname === '/apply/details') await postDetails(req, res, w);
      else if (url.pathname === '/apply/restart') {
        codes.delete(w.uid);
        const { email, name, verifiedAt, cid, ...rest } = w;
        res.writeHead(303, { Location: '/apply', 'Set-Cookie': setWho(rest) }); res.end();
      } else { res.writeHead(404); res.end(); }
    } catch (err) {
      if (res.headersSent) return true;
      if (err.status === 413) return problemPage(res, 'The form is too long. Shorten what you wrote.', 413), true;
      log(`apply: ${err.stack || err.message}`);
      problemPage(res, 'Something went wrong. Try again.', 500);
    }
    return true;
  }

  return { handle, startCookie, cookieName: COOKIE, on: !!ap.on };
}
