// Deploy with partner access: a development partner signs in to their own company, picks a client that
// gave them partner access, enters the switch code, and installs with the partner session. The
// client-credentials path (the client's admin signs in) must work exactly as before.
// Ambivo is faked (fakes.mjs): no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeploy, INSTALL_STEP_MS } from '../deploy.mjs';
import { startSignIn } from '../ambivo-signin.mjs';
import { memObjects, memKeys, fakeApp, fakeAmbivo, putLink, SECRET, hashOfSecret, CLIENT_TENANT } from './fakes.mjs';

const API = 'https://ambivo.test/';
const LINK = `deploylinks/${hashOfSecret(SECRET)}.json`;

async function setup({ ambivo = {}, app = {}, jobs = true } = {}) {
  const objects = memObjects(), sessions = memKeys(), pending = memKeys();
  const am = fakeAmbivo(ambivo);
  const a = fakeApp(app);
  await putLink(objects, { jobs });
  const logs = [];
  const d = createDeploy({ stateObjects: objects, sessions, pending, config: { ambivoApi: API }, fetchImpl: am.fetchImpl,
    log: (x) => logs.push(x), app: a });
  const link = async () => JSON.parse((await objects.get(LINK)).body.toString('utf8'));
  return { d, am, app: a, objects, sessions, pending, logs, link };
}

/** Sign in as the partner and get to the list of client companies. */
async function toClients(t) {
  let [st, out] = await t.d.signIn(SECRET, { email: 'dev@partner.test', password: 'pw-Partner-1', asPartner: true });
  assert.equal(st, 200, JSON.stringify(out));
  assert.equal(out.needCode, true);
  [st, out] = await t.d.verify(SECRET, { code: '123456' });
  assert.equal(st, 200, JSON.stringify(out));
  assert.equal(out.pickClient, true);
  return out;
}

/** All the way to Ready with one client. */
async function toReady(t, grantId = 'g-admin') {
  await toClients(t);
  let [st, out] = await t.d.chooseClient(SECRET, { grantId });
  assert.equal(st, 200, JSON.stringify(out));
  assert.equal(out.needCode, true);
  assert.equal(out.partnerSwitch, true);
  [st, out] = await t.d.verify(SECRET, { code: '654321' });
  return [st, out];
}

const banned = /—|\btenant\b|\bgrant\b/i;
const plain = (msg) => {
  assert.doesNotMatch(msg, banned, `plain words: ${msg}`);
  for (const sentence of msg.split(/(?<=\.)\s+/)) assert.ok(sentence.split(/\s+/).length < 20, `short sentence: ${sentence}`);
};

test('client credentials, unchanged: the admin signs in, the secrets are saved, the step runs with their session', async () => {
  const t = await setup();
  let [st, out] = await t.d.signIn(SECRET, { email: 'admin@client.test', password: 'pw-Client-1' });
  assert.equal(st, 200, JSON.stringify(out));
  assert.equal(out.ready, true);
  assert.equal(out.asPartner, undefined);
  assert.ok(!t.am.calls.some((c) => c.path.startsWith('user/partner_access')), 'no partner calls');
  [st, out] = await t.d.install(SECRET, { secrets: { LAB_API_KEY: 'key-1' } });
  assert.equal(st, 200, JSON.stringify(out));
  const put = t.am.calls.find((c) => c.method === 'PUT' && c.path === 'app_job/secret/labapp/LAB_API_KEY');
  assert.ok(put, 'the secret is saved with the admin session');
  assert.equal(put.auth, 'tok-admin');
  assert.equal(t.app.runs.length, 1);
  assert.equal(t.app.runs[0].env.AMBIVO_TOKEN, 'tok-admin');
  assert.equal(t.app.runs[0].env.AMBIVO_PARTNER_SESSION, undefined);
  assert.deepEqual(t.app.runs[0].argv.slice(-2), ['--tenant', CLIENT_TENANT]);
  const entry = t.app.project.deployments.at(-1);
  assert.equal(entry.by, 'admin@client.test');
  assert.equal(entry.asPartner, undefined);
  assert.equal(entry.grantId, undefined);
  assert.equal(out.notes, undefined);
  assert.equal((await t.link()).status, 'done');
});

test('client credentials, unchanged: an admin must still type every key the jobs need', async () => {
  const t = await setup();
  await t.d.signIn(SECRET, { email: 'admin@client.test', password: 'pw-Client-1' });
  const [st, out] = await t.d.install(SECRET, {});
  assert.equal(st, 400);
  assert.match(out.error, /Enter the Lab API key/);
  assert.equal(t.app.runs.length, 0);
});

test('client credentials, unchanged: a person who is not an admin is refused', async () => {
  const t = await setup();
  const [st, out] = await t.d.signIn(SECRET, { email: 'staff@client.test', password: 'pw-Client-2' });
  assert.equal(st, 403);
  assert.match(out.error, /Only an admin of Client Co/);
});

test('partner: own sign-in with its code, then the list of client companies from that session', async () => {
  const t = await setup();
  const list = await toClients(t);
  assert.equal(list.email, 'dev@partner.test');
  assert.deepEqual(list.clients.map((c) => c.grantId), ['g-admin', 'g-view', 'g-inv', 'g-ended']);
  assert.equal(t.am.calls.find((c) => c.path === 'user/partner_access/clients').auth, 'tok-home');
  // Viewers are listed (the page marks them) and refused when chosen.
  assert.equal(list.clients.find((c) => c.grantId === 'g-view').role, 'viewer');
});

test('partner happy path end to end', async () => {
  const t = await setup();
  const [st, out] = await toReady(t);
  assert.equal(st, 200, JSON.stringify(out));
  assert.equal(out.ready, true);
  assert.equal(out.asPartner, true);
  assert.equal(out.company, 'Client Co');
  assert.equal(out.email, 'dev@partner.test');
  // The admin check asks user/data with the partner token, never the login's admin_ids.
  const data = t.am.calls.find((c) => c.path === 'user/data');
  assert.equal(data.auth, 'tok-partner-g-admin');
  assert.equal(t.am.calls.find((c) => c.path === 'user/tenant/plan').auth, 'tok-partner-g-admin');

  const before = t.am.calls.length;
  const [ist, iout] = await t.d.install(SECRET, {});
  assert.equal(ist, 200, JSON.stringify(iout));
  assert.equal(iout.asPartner, true);
  // Nothing on /app_job was sent: the negative first, so the skip cannot pass by accident.
  assert.ok(!t.am.calls.some((c) => c.path.startsWith('app_job/')), 'no app_job call in a partner session');
  assert.equal(t.app.runs.length, 1);
  assert.equal(t.app.runs[0].env.AMBIVO_TOKEN, 'tok-partner-g-admin');
  assert.equal(t.app.runs[0].env.AMBIVO_PARTNER_SESSION, '1');
  assert.deepEqual(t.app.runs[0].argv.slice(-2), ['--tenant', CLIENT_TENANT]);
  assert.equal(iout.notes.length, 1);
  assert.match(iout.notes[0], /scheduled jobs and their keys were not added/);
  assert.match(iout.notes[0], /Ask an admin of Client Co/);
  for (const n of iout.notes) plain(n);
  // The log names the partner who acted and their partner access, beside the company.
  const entry = t.app.project.deployments.at(-1);
  assert.equal(entry.by, 'dev@partner.test');
  assert.equal(entry.byUserid, 'dev');
  assert.equal(entry.grantId, 'g-admin');
  assert.equal(entry.asPartner, true);
  assert.equal(entry.tenantId, CLIENT_TENANT);
  assert.equal(entry.company, 'Client Co');
  // Both sessions are ended at Ambivo afterwards, and nothing is kept.
  const outs = t.am.calls.slice(before).filter((c) => c.path === 'user/logout').map((c) => c.auth).sort();
  assert.deepEqual(outs, ['tok-home', 'tok-partner-g-admin']);
  assert.equal(await t.sessions.info(hashOfSecret(SECRET)), null);
  assert.equal((await t.link()).status, 'done');
});

test('partner: an invited company is accepted before the switch', async () => {
  const t = await setup();
  const [st, out] = await toReady(t, 'g-inv');
  assert.equal(st, 200, JSON.stringify(out));
  const paths = t.am.calls.map((c) => `${c.method} ${c.path}`);
  const accept = paths.indexOf('POST user/partner_access/accept');
  assert.ok(accept > -1, 'accepted');
  assert.ok(accept < paths.indexOf('POST user/partner_access/switch'), 'accepted before the switch');
});

test('partner: view-only access is refused in the list, and when the switch says viewer', async () => {
  let t = await setup();
  await toClients(t);
  let [st, out] = await t.d.chooseClient(SECRET, { grantId: 'g-view' });
  assert.equal(st, 403);
  assert.match(out.error, /view-only partner access to Viewer Co/);
  plain(out.error);
  assert.ok(!t.am.calls.some((c) => c.path === 'user/partner_access/switch'), 'no switch for a viewer');

  t = await setup({ ambivo: { contextRole: 'viewer' } });
  [st, out] = await toReady(t);
  assert.equal(st, 403);
  assert.match(out.error, /view-only/);
  assert.equal(await t.sessions.info(hashOfSecret(SECRET)), null, 'nothing kept');
  assert.equal((await t.d.install(SECRET, {}))[0], 401);
  assert.equal(t.app.runs.length, 0);
});

test('partner: user/data says not an admin, so the install is refused', async () => {
  const t = await setup({ ambivo: { partnerAdmin: false } });
  const [st, out] = await toReady(t);
  assert.equal(st, 403);
  assert.match(out.error, /does not include admin rights/);
  plain(out.error);
});

test('partner: PARTNER_ACCESS_ENDED at the switch says access has ended and keeps the list', async () => {
  const t = await setup();
  await toClients(t);
  const [st, out] = await t.d.chooseClient(SECRET, { grantId: 'g-ended' });
  assert.equal(st, 403);
  assert.equal(out.accessEnded, true);
  assert.equal(out.error, 'Your partner access to Ended Co has ended. Ask its admin to give you access again.');
  plain(out.error);
  // Still signed in to their own company: another client can be chosen.
  const [st2, out2] = await t.d.chooseClient(SECRET, { grantId: 'g-admin' });
  assert.equal(st2, 200, JSON.stringify(out2));
});

test('partner: PARTNER_ACCESS_ENDED on the checks after the switch is said plainly', async () => {
  const t = await setup({ ambivo: { endedOn: 'user/data' } });
  const [st, out] = await toReady(t);
  assert.equal(st, 403);
  assert.match(out.error, /partner access to Client Co has ended/);
});

test('partner: an install step from before partner sessions has its jobs call refused; the objects count as installed', async () => {
  const t = await setup();
  await toReady(t);
  t.app.result = { code: 1, out: 'objects: 1 installed', err: 'Error: PUT /app_job/app/labapp: PARTNER_ROUTE_NOT_ALLOWED' };
  const [st, out] = await t.d.install(SECRET, {});
  assert.equal(st, 200, JSON.stringify(out));
  assert.match(out.notes[0], /not added/);
  assert.equal(t.app.project.deployments.at(-1).ok, true);
});

test('partner: the same refusal on an app with no jobs is a real failure', async () => {
  const t = await setup({ jobs: false });
  await toReady(t);
  t.app.result = { code: 1, out: '', err: 'Error: PARTNER_ROUTE_NOT_ALLOWED' };
  const [st] = await t.d.install(SECRET, {});
  assert.equal(st, 500);
  assert.equal(t.app.project.deployments.at(-1).ok, false);
  assert.equal((await t.link()).status, 'open');
});

test('partner: the install stops between steps when the token would pass 55 minutes', async (ctx) => {
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  ctx.after(() => { Date.now = realNow; });
  // Preparing the app is slow: 25 minutes after the switch, the step could run past the 55-minute mark.
  const t = await setup({ app: { onPrepare: async () => { skew += 25 * 60 * 1000; } } });
  await toReady(t);
  skew += 20 * 60 * 1000;   // the partner clicks Install 20 minutes after the switch: still inside the window
  const [st, out] = await t.d.install(SECRET, {});
  assert.equal(st, 401);
  assert.equal(out.restart, true);
  assert.match(out.error, /close to its 1-hour limit/);
  plain(out.error);
  assert.equal(t.app.runs.length, 0, 'the install step never ran');
  assert.equal((await t.link()).status, 'open', 'the link can be used again');
  assert.ok(INSTALL_STEP_MS >= 15 * 60 * 1000);
});

test('result 3: the sign-in lists the companies, and a second sign-in with one finishes', async () => {
  const am = fakeAmbivo();
  const step = await startSignIn({ apiUrl: API, email: 'multi@both.test', password: 'pw', deviceId: 'd', os: 'web', fetchImpl: am.fetchImpl });
  assert.equal(step.session, undefined);
  assert.deepEqual(step.pickCompany.companies, [{ tenantId: CLIENT_TENANT, name: 'Client Co' }, { tenantId: 't-other', name: 'Other Co' }]);
  const again = await startSignIn({ apiUrl: API, email: 'multi@both.test', password: 'pw', tenantId: 't-other', deviceId: 'd', os: 'web', fetchImpl: am.fetchImpl });
  assert.equal(again.session.tenantId, 't-other');
  assert.equal(am.calls.at(-1).body.tenant_id, 't-other');
});

test('result 3 on the deploy page: the companies come back to choose from', async () => {
  const t = await setup();
  let [st, out] = await t.d.signIn(SECRET, { email: 'multi@both.test', password: 'pw-Multi-1' });
  assert.equal(st, 200);
  assert.equal(out.pickCompany, true);
  assert.equal(out.companies.length, 2);
  [st, out] = await t.d.signIn(SECRET, { email: 'multi@both.test', password: 'pw-Multi-1', tenantId: CLIENT_TENANT });
  assert.equal(st, 200, JSON.stringify(out));
  assert.equal(out.ready, true);
  assert.equal(out.company, 'Client Co');
});
