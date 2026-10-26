// In-memory stand-ins for what deploy.mjs is lent: the state store, the two keystores, the app, and Ambivo
// itself (a fetch that answers like Core and records every call). No network.
import { createHash } from 'node:crypto';

export function memObjects() {
  const m = new Map();
  let n = 0;
  return {
    m,
    async get(key) { const v = m.get(key); return v ? { body: Buffer.from(v.body), etag: v.etag } : null; },
    async head(key) { return m.has(key) ? { etag: m.get(key).etag } : null; },
    async put(key, body, opts = {}) {
      const cur = m.get(key);
      if (opts.ifNoneMatch === '*' && cur) throw new Error('exists');
      if (opts.ifMatch && cur?.etag !== opts.ifMatch) throw new Error('etag');
      m.set(key, { body: String(body), etag: `e${++n}` });
    },
    async delete(key) { m.delete(key); },
  };
}

export function memKeys() {
  const m = new Map();
  return {
    m,
    async save(k, secret, meta) { m.set(k, { secret, meta: meta ?? {} }); },
    async info(k) { return m.get(k)?.meta ?? null; },
    async get(k) { return m.get(k)?.secret ?? null; },
    async remove(k) { return m.delete(k); },
  };
}

export function fakeApp({ onPrepare } = {}) {
  const runs = [], notes = [], project = { id: 'p1', deployLinks: [], deployments: [] };
  const busy = new Set();
  return {
    runs, notes, project, result: { code: 0, out: 'objects: 2 installed', err: '' },
    getProject: async () => project,
    prepare: async () => { await onPrepare?.(); },
    isBusy: (id) => busy.has(id),
    setBusy: (id, on) => (on ? busy.add(id) : busy.delete(id)),
    update: async (_id, fn) => fn(project),
    emit: (_id, e) => notes.push(e.text),
    async runReviewed(sha, short, argv, env) { runs.push({ sha, short, argv, env }); return this.result; },
    publicUrl: 'https://devstudio.test',
  };
}

export const CLIENT_TENANT = 't-client';
export const ok = (x = {}) => ({ result: 1, ...x });
const refuse = (code, message) => ({ result: 2, error_code: code, error: { message } });

/**
 * A fake Core. Accounts:
 *   admin@client.test   a client admin, no code (client-credentials path)
 *   staff@client.test   not an admin
 *   dev@partner.test    a partner, emailed code 123456; home session tok-home
 *   multi@both.test     in two companies: result 3 without tenant_id
 * Partner access (from tok-home): g-admin, g-view (viewer), g-inv (invited), g-ended (switch refused).
 * The switch code is 654321. The partner token is tok-partner-<grant>.
 */
export function fakeAmbivo({ partnerAdmin = true, contextRole = null, endedOn = null } = {}) {
  const calls = [];
  const clients = [
    { grant_id: 'g-admin', client_tenant_id: CLIENT_TENANT, client_name: 'Client Co', role: 'admin', status: 'active', ends_at: null },
    { grant_id: 'g-view', client_tenant_id: 't-view', client_name: 'Viewer Co', role: 'viewer', status: 'active', ends_at: null },
    { grant_id: 'g-inv', client_tenant_id: 't-inv', client_name: 'Invited Co', role: 'admin', status: 'invited', ends_at: null },
    { grant_id: 'g-ended', client_tenant_id: 't-ended', client_name: 'Ended Co', role: 'admin', status: 'active', ends_at: null },
  ];
  const session = (id, email, tenantId, company, adminIds = [id]) => ok({
    user: { id, email, token: `tok-${id}`, tenant_id: tenantId, client_connection_id: `cc-${id}`,
      tenant_dict: { company_name: company, admin_ids: adminIds, meta: {} } },
  });
  const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); }, async json() { return body; } });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, '');
    const method = init.method || 'GET';
    const auth = (init.headers?.Authorization || '').replace(/^Bearer /, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, auth, body });
    const partnerTok = /^tok-partner-/.test(auth);
    if (partnerTok && endedOn === path) return answer(403, refuse('PARTNER_ACCESS_ENDED', 'Partner access has ended.'));

    if (path === 'user/login') {
      if (body.email === 'admin@client.test') return answer(200, session('admin', body.email, CLIENT_TENANT, 'Client Co'));
      if (body.email === 'staff@client.test') return answer(200, session('staff', body.email, CLIENT_TENANT, 'Client Co', ['someone-else']));
      if (body.email === 'dev@partner.test') {
        return answer(200, { is_mfa_response: true, provider_challenge_id: 'pc-home', userid: 'dev', challenge_destination: 'd***@partner.test' });
      }
      if (body.email === 'multi@both.test') {
        if (!body.tenant_id) {
          return answer(200, { result: 3, message: 'TENANT_SELECTION_REQUIRED',
            tenant_list: [{ tenant_id: CLIENT_TENANT, name: 'Client Co' }, { tenant_id: 't-other', name: 'Other Co' }] });
        }
        return answer(200, session('multi', body.email, body.tenant_id, body.tenant_id === CLIENT_TENANT ? 'Client Co' : 'Other Co'));
      }
      return answer(200, refuse('INVALID_CREDENTIALS', 'invalid credentials'));
    }
    if (path === 'user/mfa/verify') {
      if (body.challenge_code !== '123456') return answer(200, refuse('INVALID_MFA_CODE', 'wrong'));
      return answer(200, ok({ user: { id: 'dev', email: 'dev@partner.test', token: 'tok-home', tenant_id: 't-partner',
        client_connection_id: 'cc-home', tenant_dict: { company_name: 'Partner Co', admin_ids: ['dev'], meta: {} } } }));
    }
    if (path === 'user/logout') return answer(200, ok());
    if (path === 'user/partner_access/clients') {
      if (auth !== 'tok-home') return answer(401, refuse('INVALID_TOKEN', 'no'));
      return answer(200, ok({ clients }));
    }
    if (path === 'user/partner_access/accept') {
      const c = clients.find((x) => x.grant_id === body.grant_id);
      if (auth !== 'tok-home' || !c) return answer(400, refuse('NOT_FOUND', 'no'));
      c.status = 'active';
      return answer(200, ok());
    }
    if (path === 'user/partner_access/switch') {
      if (auth !== 'tok-home') return answer(401, refuse('INVALID_TOKEN', 'no'));
      const c = clients.find((x) => x.grant_id === body.grant_id);
      if (!c) return answer(400, refuse('NOT_FOUND', 'no'));
      if (c.grant_id === 'g-ended') return answer(403, refuse('PARTNER_ACCESS_ENDED', 'Partner access has ended.'));
      if (c.status !== 'active') return answer(400, refuse('PARTNER_ACCESS_NOT_ACCEPTED', 'not accepted'));
      if (!body.code) return answer(200, ok({ mfa_required: true, type: 'email', provider_challenge_id: `pc-${c.grant_id}`, challenge_destination: 'd***@partner.test' }));
      if (body.code !== '654321' || body.provider_challenge_id !== `pc-${c.grant_id}`) return answer(200, refuse('INVALID_MFA_CODE', 'wrong'));
      return answer(200, ok({ user: { id: `rec-${c.grant_id}`, token: `tok-partner-${c.grant_id}` },
        partner_context: { grant_id: c.grant_id, role: contextRole || c.role, client_tenant_id: c.client_tenant_id, client_name: c.client_name,
          access_ends_at: null } }));
    }
    if (path === 'user/data') {
      if (!partnerTok) return answer(200, ok({ user_data: { is_tenant_admin: true } }));
      return answer(200, ok({ user_data: { is_tenant_admin: partnerAdmin } }));
    }
    if (path === 'user/tenant/plan') return answer(200, ok({ is_pro: true }));
    if (path.startsWith('app_job/')) {
      if (partnerTok) return answer(403, refuse('PARTNER_ROUTE_NOT_ALLOWED', 'Not allowed in a partner session.'));
      return answer(200, ok());
    }
    return answer(404, null);
  }
  return { fetchImpl, calls, clients };
}

export const SECRET = 'S'.repeat(43);
export const hashOfSecret = (s) => createHash('sha256').update(String(s)).digest('hex');

/** A deploy link as mint() leaves it, written straight into the state store. */
export async function putLink(objects, { jobs = true } = {}) {
  const rec = {
    projectId: 'p1', ownerId: '1', ownerLogin: 'octo-partner', appName: 'Lab App', appVersion: '1.2.0',
    objects: [{ id: 'labapp_trial', name: 'Trials' }], codeSha256: 'c'.repeat(64), created: Date.now(),
    exp: Date.now() + 7 * 24 * 3600 * 1000, status: 'open',
    ...(jobs ? { appKey: 'labapp', jobs: [{ key: 'pull', name: 'Pull', type: 'http_pull', typeName: 'x', schedule: 'Every day' }],
      secrets: [{ name: 'LAB_API_KEY', host: 'api.lab.test', label: 'Lab API key' }] } : {}),
  };
  await objects.put(`deploylinks/${hashOfSecret(SECRET)}.json`, JSON.stringify(rec));
  return rec;
}
