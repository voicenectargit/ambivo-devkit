// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Deploy: install a built app's custom objects into a client's Ambivo company.
//
// The partner makes a one-time link (POST /api/projects/<id>/deploy) and sends it to the client's
// company admin. The admin opens it, signs in to Ambivo with their own account and emailed code, sees
// the custom objects the app will create or update, and clicks Install. Dev Studio runs the app's
// install step (install.mjs) once in the app's container with that admin's session, then ends the
// session at Ambivo and keeps nothing of it. The partner never sees the password or the session.
//
// Before installing, three things are checked about the company the admin signed in to:
//   - the person is an admin of that company (only an admin may create custom objects);
//   - the company counts as Pro (GET /user/tenant/plan is_pro: Pro or Enterprise, billed outside
//     Ambivo, or comped), the same rule Ambivo enforces on partner apps;
//   - it is not a partner sandbox (a sandbox is where the partner builds, not a client).
//
// The link installs the version Ambivo reviewed and certified: the frozen copy the review kept
// (reviews/code/<code fingerprint>.tar), whose fingerprint the certificate signs. Install runs it in a NEW
// container from Ambivo's image, never the partner's own container, so nothing the partner left running can
// read the admin's session or change the step. Later edits cannot change what the admin approved. Links last
// 7 days and install once. Only a hash of the link's secret is stored.
//
// An app with scheduled jobs (src/install/app-jobs.json) shows them too, with the secrets its jobs
// send (an outside service's API key, say). The admin types each value on the page; Install sends it to
// Ambivo with their session (PUT /app_job/secret) before the install step runs. Dev Studio never stores it.
//
// Partner access: a development partner may open the link too. They sign in to their OWN company (with its
// emailed code), pick a client company that gave them partner access, and enter the code for the switch
// (partner-access.mjs). The install then runs with the 1-hour partner session. Core lets a partner session
// change custom objects only, so the jobs' secrets and the jobs themselves are skipped with a note: the
// client's own admin adds them. A view-only partner, or one without admin rights, is refused. The
// deployment record names the partner who acted and their partner access id, beside the company.
//
// State (stateObjects):
//   deploylinks/<sha256 of secret>.json   { projectId, ownerId, ownerLogin, appName, appVersion,
//                                           objects:[{id,name}], codeSha256, created, exp, status, ... }
//   ratelimit/deploy-sign-in/<hash>.json  sign-in tries for one link
// Keystores (encrypted): the admin's session between sign-in and install, and the emailed-code step,
// both keyed by the link hash and removed after the install or on cancel.
import { createHash, randomBytes } from 'node:crypto';
import { startSignIn, finishSignIn, signOut as ambivoSignOut } from './ambivo-signin.mjs';
import { jobsFromFile, secretProblem, coreCall } from './appjobs.mjs';
import { listClients, acceptAccess, startSwitch, finishSwitch, isPartnerAdmin, viewerMessage, endedMessage,
  ACCESS_ENDED, ROUTE_NOT_ALLOWED } from './partner-access.mjs';

export const DEPLOY_LINK_MS = 7 * 24 * 3600 * 1000;
export const DEPLOY_SESSION_MS = 30 * 60 * 1000;   // how long a signed-in admin has to click Install
const CODE_MS = 10 * 60 * 1000;
const TRY_LIMIT = 5;
const TRY_WINDOW_MS = 10 * 60 * 1000;
const INSTALL_DIR = '/work/app/src/install';
/** The longest an install step may run (app.mjs RUN_IN_TIMEOUT_MS). A partner token must outlast it. */
export const INSTALL_STEP_MS = 15 * 60 * 1000;
const JOBS_SKIPPED = (company) => `The scheduled jobs and their keys were not added. Partner access cannot add them. Ask an admin of ${company} to install the app from a deploy link to add them.`;
const TOO_LATE = 'Your partner session is close to its 1-hour limit, so the install did not start. Sign in again to start a new session.';

export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
export const hashOf = (secret) => createHash('sha256').update(String(secret)).digest('hex');
const linkKey = (hash) => `deploylinks/${hash}.json`;
const triesKey = (hash) => `ratelimit/deploy-sign-in/${hash}.json`;

/** The object list and version from an app-objects.json text, for the admin's preview. */
export function objectsFromInstallFile(text) {
  let cfg;
  try { cfg = JSON.parse(text); } catch { return null; }
  const objs = Array.isArray(cfg?.objects) ? cfg.objects : null;
  if (!objs?.length) return null;
  return {
    appVersion: typeof cfg.app_version === 'string' ? cfg.app_version : '',
    objects: objs.filter((o) => o && typeof o.collection_id === 'string')
      .map((o) => ({ id: o.collection_id, name: typeof o.name === 'string' && o.name ? o.name : o.collection_id })),
  };
}

/** True when install.mjs reaches outside its own folder, so a copy of the folder would not run. */
export const reachesOutside = (source) => /(['"`])\.\.\//.test(String(source));

/**
 * @param deps.app  what Dev Studio lends: getProject(id), runIn(id, argv, env), prepare(id), sh(id, cmd),
 *                  isBusy(id), setBusy(id, on), update(id, fn), emit(id, event), publicUrl,
 *                  aboutRefusal(id), certificateRefusal(id, {appKey, appVersion}): [status, body] or null
 */
export function createDeploy({ stateObjects, sessions, pending, config, fetchImpl = fetch, log = console.log, app }) {
  const readJson = async (key) => {
    const o = await stateObjects.get(key);
    if (!o) return null;
    try { return { rec: JSON.parse(o.body.toString('utf8')), etag: o.etag }; } catch { return null; }
  };
  const putJson = (key, rec, opts = {}) => stateObjects.put(key, JSON.stringify(rec), { contentType: 'application/json', ...opts });

  // ---- the partner's side ---------------------------------------------------------------------

  /** Make a link for this project. Answers [status, body]. */
  async function mint(project, user) {
    const id = project.id;
    if (app.isBusy(id)) return [409, { error: 'The assistant is working. Make the link when it finishes, so it installs the finished app.' }];
    await app.prepare(id);
    let cfgText, installSrc;
    try {
      cfgText = (await app.sh(id, `cat ${INSTALL_DIR}/app-objects.json`)).stdout;
      installSrc = (await app.sh(id, `cat ${INSTALL_DIR}/install.mjs`)).stdout;
    } catch {
      return [409, { error: 'This app has no install step yet (src/install/install.mjs and app-objects.json). Ask the assistant to add it, then make the link.' }];
    }
    const parsed = objectsFromInstallFile(cfgText);
    if (!parsed) return [409, { error: 'The app\'s src/install/app-objects.json lists no custom objects. Ask the assistant to fix it, then make the link.' }];
    // Scheduled jobs are optional; a jobs file that cannot be read stops the link.
    let jobsText = null;
    try { jobsText = (await app.sh(id, `cat ${INSTALL_DIR}/app-jobs.json`)).stdout; } catch { /* no jobs */ }
    const jobs = jobsText === null ? null : jobsFromFile(jobsText);
    if (jobsText !== null && (!jobs || !/^[a-z][a-z0-9]{1,23}$/.test(jobs.appKey))) {
      return [409, { error: 'The app\'s src/install/app-jobs.json cannot be read. Ask the assistant to fix it, then make the link.' }];
    }
    // The fixed About page, and a current Ambivo certificate for this app_key and version (about.mjs).
    // Ambivo refuses to install the app's custom objects in a client's company without the certificate.
    const aboutRefused = await app.aboutRefusal(id);
    if (aboutRefused) return aboutRefused;
    let appKey = '';
    try { appKey = String(JSON.parse(cfgText).app_key || ''); } catch { /* checked above */ }
    const cert = await app.certificateRefusal(id, { appKey, appVersion: parsed.appVersion });
    if (!cert?.ok) return cert;
    // Everything the link shows and installs comes from the reviewed copy, the bytes the certificate signs.
    const files = await app.reviewedFiles(cert.codeSha256);
    if (!files) return [409, { error: 'The reviewed copy of this version is missing on Dev Studio. Submit the app for review again.' }];
    const at = (rel) => files.find((f) => f.path === rel)?.content.toString('utf8') ?? null;
    const frozenCfg = at('src/install/app-objects.json'), frozenSrc = at('src/install/install.mjs'), frozenJobs = at('src/install/app-jobs.json');
    const frozen = frozenCfg && frozenSrc && objectsFromInstallFile(frozenCfg);
    if (!frozen) return [409, { error: 'The reviewed version has no install step. Ask the assistant to add it, then submit a new version.' }];
    const frozenJobsParsed = frozenJobs === null ? null : jobsFromFile(frozenJobs);
    if (reachesOutside(frozenSrc)) {
      return [409, { error: 'The install step uses files outside src/install, so it cannot be sent as a link. Ask the assistant to keep everything it needs in src/install.' }];
    }
    const secret = randomBytes(32).toString('base64url');
    const hash = hashOf(secret);
    const short = hash.slice(0, 16);
    const now = Date.now();
    const rec = {
      projectId: id, ownerId: String(user.id), ownerLogin: user.login || '', appName: project.name,
      appVersion: frozen.appVersion, objects: frozen.objects, codeSha256: cert.codeSha256, created: now, exp: now + DEPLOY_LINK_MS, status: 'open',
      ...(frozenJobsParsed ? { appKey: frozenJobsParsed.appKey, jobs: frozenJobsParsed.jobs, secrets: frozenJobsParsed.secrets } : {}),
    };
    await putJson(linkKey(hash), rec, { ifNoneMatch: '*' });
    await app.update(id, (p) => {
      const links = (p.deployLinks ?? []).filter((l) => l.hash !== hash);
      links.push({ hash, short, created: now, exp: rec.exp, appVersion: rec.appVersion, status: 'open', by: user.login || '' });
      p.deployLinks = links.slice(-20);
    });
    log(`project ${id}: deploy link ${short} made by ${user.login} (app ${rec.appVersion || 'no version'}, ${rec.objects.length} objects)`);
    app.emit(id, { kind: 'note', text: `Deploy link made for version ${rec.appVersion || '(no version)'}. It works once, for 7 days.` });
    return [201, { url: `${app.publicUrl}/deploy/${secret}`, exp: rec.exp, appVersion: rec.appVersion, objects: rec.objects,
      jobs: rec.jobs ?? [], secrets: rec.secrets ?? [] }];
  }

  /** Stop a link that has not been used. */
  async function revoke(project, short) {
    const l = (project.deployLinks ?? []).find((x) => x.short === short);
    if (!l) return [404, { error: 'No such link.' }];
    const got = await readJson(linkKey(l.hash));
    if (got && got.rec.status === 'open') {
      try { await putJson(linkKey(l.hash), { ...got.rec, status: 'revoked' }, { ifMatch: got.etag }); }
      catch { return [409, { error: 'The link is being used right now. Try again in a minute.' }]; }
      await forgetSession(l.hash);
    }
    await app.update(project.id, (p) => {
      for (const x of p.deployLinks ?? []) if (x.short === short && x.status === 'open') x.status = 'revoked';
    });
    return [200, { revoked: short }];
  }

  /** What the Deploy dialog shows: open links (no secrets) and past deployments. */
  function status(project) {
    const now = Date.now();
    return {
      links: (project.deployLinks ?? []).map((l) => ({ short: l.short, created: l.created, exp: l.exp, appVersion: l.appVersion,
        status: l.status === 'open' && l.exp <= now ? 'expired' : l.status, by: l.by })).reverse(),
      deployments: [...(project.deployments ?? [])].reverse(),
    };
  }

  // ---- the admin's side (no Dev Studio sign-in; the link is the key) --------------------------

  async function openLink(secret) {
    if (!SECRET_RE.test(String(secret))) return { error: [404, { error: 'This link does not work. Ask for a new one.' }] };
    const hash = hashOf(secret);
    const got = await readJson(linkKey(hash));
    if (!got) return { error: [404, { error: 'This link does not work. Ask for a new one.' }] };
    const { rec } = got;
    if (rec.status === 'done') return { error: [410, { error: 'This link was used. The app is installed.', used: true }] };
    if (rec.status === 'revoked') return { error: [410, { error: 'This link was stopped. Ask for a new one.' }] };
    if (rec.exp <= Date.now()) return { error: [410, { error: 'This link has ended. Ask for a new one.' }] };
    return { hash, ...got };
  }

  async function info(secret) {
    const l = await openLink(secret);
    if (l.error) return l.error;
    const s = await sessionInfo(l.hash);
    return [200, { appName: l.rec.appName, appVersion: l.rec.appVersion, objects: l.rec.objects, partner: l.rec.ownerLogin,
      jobs: l.rec.jobs ?? [], secrets: l.rec.secrets ?? [],
      exp: l.rec.exp, status: l.rec.status, ...(s ? { signedIn: s } : {}) }];
  }

  async function tryOnce(hash) {
    const now = Date.now();
    const got = await readJson(triesKey(hash));
    const recent = (Array.isArray(got?.rec?.tries) ? got.rec.tries : []).filter((t) => typeof t === 'number' && now - t < TRY_WINDOW_MS);
    if (recent.length >= TRY_LIMIT) return Math.ceil((recent[0] + TRY_WINDOW_MS - now) / 60000);
    recent.push(now);
    await putJson(triesKey(hash), { tries: recent });
    return 0;
  }

  async function signIn(secret, body) {
    const l = await openLink(secret);
    if (l.error) return l.error;
    const email = String(body.email ?? '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    const asPartner = body.asPartner === true;
    const tenantId = /^[A-Za-z0-9_-]{1,64}$/.test(String(body.tenantId ?? '')) ? String(body.tenantId) : undefined;
    if (!email || !password) return [400, { error: 'Enter your Ambivo email and password.' }];
    if (email.length > 100 || password.length > 128 || !/^[^@\s]+@[^@\s]+$/.test(email)) return [400, { error: 'Check the email and password.' }];
    const wait = await tryOnce(l.hash);
    if (wait) return [429, { error: `Too many sign-in tries. Wait ${wait} minutes, then try again.` }];
    // A partner who was still choosing a company: end that session before a new sign-in.
    try { const old = await pendingPartner(l.hash); if (old?.home?.token) await end(old.home); } catch { /* gone */ }
    await pending.remove(l.hash);
    let step;
    try {
      step = await startSignIn({ apiUrl: config.ambivoApi, email, password, tenantId, deviceId: `devstudio-deploy-${l.hash.slice(0, 16)}`, os: 'web', fetchImpl });
    } catch (err) { return failure(err); }
    // The email has an account in more than one company: the page shows them, then signs in again with one.
    if (step.pickCompany) return [200, { pickCompany: true, companies: step.pickCompany.companies }];
    if (step.challenge) {
      await pending.save(l.hash, JSON.stringify({ stage: 'sign-in', challenge: step.challenge, email, asPartner }), { exp: Date.now() + CODE_MS });
      return [200, { needCode: true, destination: step.challenge.destination }];
    }
    return asPartner ? partnerHome(l, step.session) : keep(l, step.session);
  }

  async function verify(secret, body) {
    const l = await openLink(secret);
    if (l.error) return l.error;
    const meta = await pending.info(l.hash);
    if (!meta || !(meta.exp > Date.now())) { await pending.remove(l.hash); return [400, { error: 'Sign in again to get a new code.', restart: true }]; }
    let p;
    try { p = JSON.parse(await pending.get(l.hash)); } catch { await pending.remove(l.hash); return [400, { error: 'Sign in again to get a new code.', restart: true }]; }
    const code = String(body.code ?? '').replace(/\s+/g, '');
    if (!/^\d{4,8}$/.test(code)) return [400, { error: 'Enter the code from the email. It has 6 digits.' }];
    if (p.stage === 'switch') return switchVerify(l, p, code);
    if (p.stage === 'pick') return [400, { error: 'Choose the company first.' }];
    let step;
    try {
      step = await finishSignIn({ apiUrl: config.ambivoApi, challenge: p.challenge, code, email: p.email, fetchImpl });
    } catch (err) {
      if (err.code !== 'INVALID_MFA_CODE') await pending.remove(l.hash);
      const [st, out] = failure(err);
      return [st, err.code === 'INVALID_MFA_CODE' ? out : { ...out, restart: true }];
    }
    await pending.remove(l.hash);
    return p.asPartner ? partnerHome(l, step.session) : keep(l, step.session);
  }

  // ---- partner access: the partner's own session, a client, the switch --------------------------

  const homeOf = (session) => ({ token: session.token, apiUrl: session.apiUrl, connectionId: session.connectionId,
    email: session.email, userid: session.userid, tenantName: session.tenantName });

  /** Signed in to their own company: list the clients that gave them partner access. */
  async function partnerHome(l, session) {
    const home = homeOf(session);
    let clients;
    try { clients = await listClients(home, fetchImpl); }
    catch (err) { await end(home); return failure(err); }
    const usable = clients.filter((c) => c.status === 'active' || c.status === 'invited');
    if (!usable.length) {
      await end(home);
      return [403, { error: 'No company has given you partner access yet. Ask the client\'s admin to give you partner access.' }];
    }
    await pending.save(l.hash, JSON.stringify({ stage: 'pick', home }), { exp: Date.now() + DEPLOY_SESSION_MS });
    log(`deploy ${l.hash.slice(0, 16)}: partner ${home.email} signed in, ${usable.length} client companies`);
    return [200, { pickClient: true, email: home.email,
      clients: usable.map((c) => ({ grantId: c.grantId, name: c.name, role: c.role, status: c.status, endsAt: c.endsAt })) }];
  }

  async function pendingPartner(hash) {
    const meta = await pending.info(hash);
    if (!meta || !(meta.exp > Date.now())) return null;
    try {
      const p = JSON.parse(await pending.get(hash));
      return p?.home ? p : null;
    } catch { return null; }
  }

  /** The partner picked a client company: accept it when invited, then start the switch. */
  async function chooseClient(secret, body) {
    const l = await openLink(secret);
    if (l.error) return l.error;
    const p = await pendingPartner(l.hash);
    if (!p) { await forgetSession(l.hash); return [400, { error: 'Sign in again to choose a company.', restart: true }]; }
    const grantId = String(body.grantId ?? '');
    let client;
    try { client = (await listClients(p.home, fetchImpl)).find((c) => c.grantId === grantId); }
    catch (err) { return partnerFailure(l, p, err); }
    if (!client) return [404, { error: 'That company is not in your partner access list. Choose another one.' }];
    if (client.role !== 'admin') return [403, { error: viewerMessage(client.name), viewOnly: true }];
    if (client.status !== 'active' && client.status !== 'invited') return [403, { error: endedMessage(client.name) }];
    let step;
    try {
      if (client.status === 'invited') await acceptAccess(p.home, client.grantId, fetchImpl);
      step = await startSwitch(p.home, client, fetchImpl);
    } catch (err) { return partnerFailure(l, p, err, client.name); }
    if (step.challenge) {
      await pending.save(l.hash, JSON.stringify({ stage: 'switch', home: p.home, client, challenge: step.challenge }), { exp: Date.now() + CODE_MS });
      return [200, { needCode: true, partnerSwitch: true, company: client.name, destination: step.challenge.destination }];
    }
    return keepPartner(l, p.home, step.session);
  }

  async function switchVerify(l, p, code) {
    let step;
    try { step = await finishSwitch(p.home, p.client, p.challenge, code, fetchImpl); }
    catch (err) {
      if (err.code === 'INVALID_MFA_CODE') return [400, { error: err.message }];
      // Back to the list: the partner can choose the company again for a new code.
      await pending.save(l.hash, JSON.stringify({ stage: 'pick', home: p.home }), { exp: Date.now() + DEPLOY_SESSION_MS });
      const [st, out] = failure(err);
      return [st, { ...out, chooseAgain: true }];
    }
    return keepPartner(l, p.home, step.session);
  }

  /** A refusal while the partner is choosing. Access that has ended keeps them on the list. */
  async function partnerFailure(l, p, err, company) {
    if (err.code === ACCESS_ENDED) return [403, { error: endedMessage(company), accessEnded: true }];
    if (err.status === 401) { await pending.remove(l.hash); await end(p.home); return [401, { error: err.message, restart: true }]; }
    return failure(err);
  }

  /** The checks for a partner session. One that fails is ended at once, with the partner's own session. */
  async function keepPartner(l, home, ps) {
    const company = ps.tenantName || 'This company';
    const stop = async (status, body) => { await pending.remove(l.hash); await end(ps); await end(home); return [status, body]; };
    if (ps.role !== 'admin') return stop(403, { error: viewerMessage(company), viewOnly: true });
    let admin = false;
    try { admin = await isPartnerAdmin(ps, fetchImpl); }
    catch (err) {
      if (err.code === ACCESS_ENDED) return stop(403, { error: endedMessage(company), accessEnded: true });
      log(`deploy ${l.hash.slice(0, 16)}: partner admin check failed: ${err.code || err.message}`);
      return stop(502, { error: 'Ambivo could not be reached to check your access. Try again in a few minutes.' });
    }
    if (!admin) return stop(403, { error: `Your partner access to ${company} does not include admin rights. Ask its admin to change it.` });
    const plan = await planRefusal(l, ps, company);
    if (plan) return stop(...plan);
    // Install checks again that the token outlasts the longest install step (tooLate).
    const until = Math.min(Date.now() + DEPLOY_SESSION_MS, ps.safeUntil, l.rec.exp);
    await sessions.save(l.hash, JSON.stringify({
      token: ps.token, apiUrl: ps.apiUrl, tenantId: ps.tenantId,
      partner: { grantId: ps.grantId, role: ps.role, userid: ps.userid, startedAt: ps.startedAt, safeUntil: ps.safeUntil, home },
    }), { email: home.email, tenantName: company, until, partner: true, grantId: ps.grantId });
    await pending.remove(l.hash);
    log(`deploy ${l.hash.slice(0, 16)}: partner ${home.email} switched into ${company} (${ps.tenantId}) with partner access ${ps.grantId} and passed the checks`);
    return [200, { ready: true, asPartner: true, company, email: home.email, until }];
  }

  function failure(err) {
    if (err.code === ACCESS_ENDED) return [403, { error: err.message, accessEnded: true }];
    if (err.code === 'UNREACHABLE') return [502, { error: err.message }];
    if (err.status === 429 || err.code === 'RATE_LIMIT_EXCEEDED') return [429, { error: err.message }];
    return [400, { error: err.message || 'Sign-in did not finish. Try again.' }];
  }

  const end = (s) => ambivoSignOut({ apiUrl: s.apiUrl, token: s.token, connectionId: s.connectionId, fetchImpl }).catch(() => {});

  /** The three checks. A session that fails one is ended at Ambivo at once and never stored. */
  async function keep(l, session) {
    const company = session.tenantName || 'This company';
    if (session.sandbox) {
      await end(session);
      return [403, { error: `${company} is a partner sandbox. Sign in to the client's own company to install the app there.` }];
    }
    if (!session.isTenantAdmin) {
      await end(session);
      return [403, { error: `Only an admin of ${company} can install the app. Ask your company's admin to open this link.` }];
    }
    const plan = await planRefusal(l, session, company);
    if (plan) { await end(session); return plan; }
    const until = Math.min(Date.now() + DEPLOY_SESSION_MS, session.expiresAt * 1000, l.rec.exp);
    await sessions.save(l.hash,
      JSON.stringify({ token: session.token, apiUrl: session.apiUrl, connectionId: session.connectionId, tenantId: session.tenantId }),
      { email: session.email, tenantName: session.tenantName, until });
    log(`deploy ${l.hash.slice(0, 16)}: ${session.email} of ${session.tenantName} signed in and passed the checks`);
    return [200, { ready: true, company: session.tenantName, email: session.email, until }];
  }

  /** null when the company counts as Pro, or the [status, body] refusal. */
  async function planRefusal(l, session, company) {
    let isPro = false;
    try {
      const r = await fetchImpl(new URL('user/tenant/plan', session.apiUrl), { headers: { Authorization: `Bearer ${session.token}` } });
      const body = await r.json().catch(() => ({}));
      if (r.status === 403 && String(body?.error_code || body?.error?.error_code || '') === ACCESS_ENDED) {
        return [403, { error: endedMessage(company), accessEnded: true }];
      }
      isPro = r.ok && body?.result === 1 && body.is_pro === true;
    } catch (err) {
      log(`deploy ${l.hash.slice(0, 16)}: plan check failed: ${err.message}`);
      return [502, { error: 'Ambivo could not be reached to check the plan. Try again in a few minutes.' }];
    }
    if (!isPro) return [403, { error: `${company} is not on the Pro plan. Apps from development partners can be installed only in a company on Pro.`, notPro: true }];
    return null;
  }

  async function sessionInfo(hash) {
    const meta = await sessions.info(hash);
    if (!meta) return null;
    if (!(meta.until > Date.now())) { await forgetSession(hash); return null; }
    return { email: meta.email, company: meta.tenantName, until: meta.until, ...(meta.partner ? { asPartner: true } : {}) };
  }

  async function forgetSession(hash) {
    // A partner still choosing a company holds only their own session.
    try { const p = await pendingPartner(hash); if (p?.home?.token) await end(p.home); } catch { /* gone */ }
    await pending.remove(hash).catch(() => {});
    if (!(await sessions.info(hash))) return;
    try {
      const s = JSON.parse(await sessions.get(hash));
      if (s?.token) await end(s);
      if (s?.partner?.home?.token) await end(s.partner.home);
    } catch { /* gone */ }
    await sessions.remove(hash);
  }

  async function cancel(secret) {
    if (!SECRET_RE.test(String(secret))) return [404, { error: 'This link does not work.' }];
    await forgetSession(hashOf(secret));
    return [200, { signedOut: true }];
  }

  /** Run the frozen install step once with the admin's session, then end the session. */
  async function install(secret, body = {}) {
    const l = await openLink(secret);
    if (l.error) return l.error;
    if (l.rec.status !== 'open') return [409, { error: 'The app is being installed right now. Wait for it to finish.' }];
    const meta = await sessions.info(l.hash);
    if (!meta || !(meta.until > Date.now())) return [401, { error: 'Sign in again to install.', restart: true }];
    let s;
    try { s = JSON.parse(await sessions.get(l.hash)); } catch { return [401, { error: 'Sign in again to install.', restart: true }]; }
    const partner = s.partner ?? null;
    const company = meta.tenantName || 'the company';
    const notes = [];
    // Each secret the jobs need, typed by the admin. Checked before anything runs; held only for this request.
    // A partner session cannot save them (Core refuses /app_job/* there), so it skips them with a note.
    const needed = partner ? [] : Array.isArray(l.rec.secrets) ? l.rec.secrets : [];
    const given = body?.secrets && typeof body.secrets === 'object' ? body.secrets : {};
    for (const sec of needed) {
      const problem = secretProblem(sec.name, given[sec.name], sec.host);
      if (problem) return [400, { error: problem === `Enter the value for ${sec.name}.` ? `Enter the ${sec.label || sec.name}.` : problem }];
    }
    const hasJobs = (l.rec.jobs ?? []).length > 0 || (l.rec.secrets ?? []).length > 0;
    if (partner && hasJobs) notes.push(JOBS_SKIPPED(company));
    // A partner token lasts 1 hour and is never renewed: stop before a step that could outlast it.
    const tooLate = () => partner && Date.now() + INSTALL_STEP_MS > partner.safeUntil;
    if (tooLate()) { await forgetSession(l.hash); return [401, { error: TOO_LATE, restart: true }]; }
    const id = l.rec.projectId;
    if (!(await app.getProject(id))) return [410, { error: 'This app was deleted in Dev Studio. Ask the partner for a new link.' }];
    if (app.isBusy(id)) return [409, { error: 'The partner is changing the app right now. Try again in a few minutes.' }];
    // Claim the link, so a second click or a second tab cannot install twice.
    try { await putJson(linkKey(l.hash), { ...l.rec, status: 'installing', started: Date.now() }, { ifMatch: l.etag }); }
    catch { return [409, { error: 'The app is being installed right now. Wait for it to finish.' }]; }
    app.setBusy(id, true);
    let r;
    try {
      await app.prepare(id);
      const env = { AMBIVO_TOKEN: s.token, ...(s.apiUrl && s.apiUrl !== config.ambivoApi ? { AMBIVO_API_URL: s.apiUrl } : {}),
        // The install step skips PUT /app_job/app in a partner session (the ambivo-app-jobs skill).
        ...(partner ? { AMBIVO_PARTNER_SESSION: '1' } : {}) };
      // The secrets first, so the jobs the install step adds can run at once. A refusal stops the install.
      let refused = null;
      for (const sec of needed) {
        const c = await coreCall({ fetchImpl, apiUrl: s.apiUrl || config.ambivoApi, token: s.token }, 'PUT',
          `app_job/secret/${encodeURIComponent(l.rec.appKey)}/${encodeURIComponent(sec.name)}`, { value: given[sec.name], host: sec.host });
        if (!c.ok) { refused = `Error: The ${sec.label || sec.name} was not saved: ${c.error}`; break; }
      }
      r = refused ? { code: 1, out: '', err: refused }
        : tooLate() ? { code: 1, out: '', err: `Error: ${TOO_LATE}`, late: true }
        : !l.rec.codeSha256
          ? { code: 1, out: '', err: 'Error: This link was made before installs ran from the reviewed copy. Ask the partner for a new link.' }
          : await app.runReviewed(l.rec.codeSha256, l.hash.slice(0, 16), ['node', '/work/app/src/install/install.mjs', '--tenant', String(s.tenantId || '')], env);
    } finally {
      app.setBusy(id, false);
      await forgetSession(l.hash);
    }
    const said = `${r.out || ''}\n${r.err || ''}`;
    // An install step written before partner sessions sends the jobs anyway, after every object exists.
    // Core refuses that one call in a partner session. The objects are in; the jobs are the admin's to add.
    const jobsRefused = partner && hasJobs && r.code !== 0 && said.includes(ROUTE_NOT_ALLOWED);
    if (jobsRefused) log(`deploy ${l.hash.slice(0, 16)}: the install step's jobs call was refused in a partner session; objects kept`);
    const ok = r.code === 0 || jobsRefused;
    let line = (String(r.err || '').split('\n').map((x) => x.trim()).find((x) => /error/i.test(x)) || '').replace(/^Error:\s*/, '');
    if (partner && said.includes(ACCESS_ENDED)) line = endedMessage(meta.tenantName);
    const now = Date.now();
    // Who acted: the client admin, or the partner (their own email and user id) and their partner access.
    const entry = { at: now, company: meta.tenantName || '', tenantId: String(s.tenantId || ''), by: meta.email || '',
      ...(partner ? { asPartner: true, byUserid: partner.home?.userid || '', grantId: partner.grantId || '', partnerUserid: partner.userid || '',
        ...(notes.length ? { skipped: ['app_job secrets', 'app_job registration'] } : {}) } : {}),
      appVersion: l.rec.appVersion, ok, link: l.hash.slice(0, 16), ...(ok ? {} : { error: line.slice(0, 300) }) };
    // A failed run leaves the link open, so the admin can fix the cause and try again.
    const latest = await readJson(linkKey(l.hash));
    await putJson(linkKey(l.hash), { ...(latest?.rec ?? l.rec), status: ok ? 'done' : 'open', last: entry });
    await app.update(id, (p) => {
      p.deployments = [...(p.deployments ?? []), entry].slice(-50);
      for (const x of p.deployLinks ?? []) if (x.hash === l.hash) { x.status = ok ? 'done' : 'open'; x.company = entry.company; }
    });
    log(`project ${id}: deploy ${l.hash.slice(0, 16)} to ${entry.company} (${entry.tenantId}) by ${entry.by}${partner ? ` (partner access ${entry.grantId})` : ''}: ${ok ? 'installed' : `failed: ${line}`}`);
    app.emit(id, { kind: 'note', text: ok
      ? `Installed version ${entry.appVersion || '(no version)'} in ${entry.company}, by ${partner ? `partner ${entry.by}` : `its admin ${entry.by}`}.${notes.length ? ` ${notes.join(' ')}` : ''}`
      : `The install in ${entry.company} did not finish: ${line || 'the install step stopped with an error.'}` });
    if (!ok) {
      if (r.late) return [401, { error: TOO_LATE, restart: true }];
      return [500, { error: line ? `The install did not finish: ${line}` : 'The install did not finish. The partner can see what happened in Dev Studio.' }];
    }
    return [200, { installed: true, company: entry.company, appVersion: entry.appVersion, output: String(r.out || '').slice(-4000),
      ...(partner ? { asPartner: true } : {}), ...(notes.length ? { notes } : {}) }];
  }

  return { mint, revoke, status, info, signIn, verify, chooseClient, install, cancel };
}
