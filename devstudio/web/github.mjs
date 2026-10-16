// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// GitHub: one GitHub App signs partners in (user-to-server OAuth) and pushes their code
// (installation tokens, only on repositories the partner installed the App on).
//
// The push happens on the server: Dev Studio reads the project's files out of the container (tar),
// scans them for secrets, and writes them with the Git Data API (blobs, tree, commit, branch).
// The installation token stays in this process for the length of the push and never enters the
// project container, where the assistant runs with permissions bypassed and could read it.
import { createSign } from 'node:crypto';

const b64u = (s) => Buffer.from(s).toString('base64url');

/** The App's own JWT (RS256, 10 minutes at most; iat set 60 s back for clock drift). */
export function appJwt(appId, privateKeyPem, now = Math.floor(Date.now() / 1000)) {
  if (!appId || !privateKeyPem) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are needed to push');
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKeyPem).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createGitHub(cfg, fetchImpl = fetch) {
  const { api, web, browserWeb, clientId, clientSecret, appId, privateKey, slug } = cfg;

  async function call(token, method, path, body, { scheme = 'Bearer' } = {}) {
    const r = await fetchImpl(path.startsWith('http') ? path : `${api}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ambivo-devstudio',
        ...(token ? { Authorization: `${scheme} ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) throw new GitHubError(`GitHub ${method} ${path.replace(/\?.*/, '')}: HTTP ${r.status} ${data?.message || ''}`.trim(), r.status);
    return data;
  }

  return {
    installUrl: slug ? `${browserWeb}/apps/${slug}/installations/new` : null,

    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, allow_signup: 'false' });
      return `${browserWeb}/login/oauth/authorize?${q}`;
    },

    /** Exchange the callback code for the user's token. */
    async exchangeCode(code, redirectUri) {
      const r = await fetchImpl(`${web}/login/oauth/access_token`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'ambivo-devstudio' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.access_token) throw new GitHubError(`GitHub sign-in failed: ${data.error || `HTTP ${r.status}`}`, 401);
      return { token: data.access_token, expiresIn: data.expires_in };
    },

    /** The signed-in user and the orgs they belong to. */
    async whoami(userToken) {
      const user = await call(userToken, 'GET', '/user');
      let orgs = [];
      try {
        // Active memberships, public or private. Needs the App's "Members: read" org permission
        // for private memberships; falls back to the public list.
        const m = await call(userToken, 'GET', '/user/memberships/orgs?state=active&per_page=100');
        orgs = (m || []).map((x) => ({ id: x.organization?.id, login: x.organization?.login })).filter((o) => o.login);
      } catch {
        const o = await call(userToken, 'GET', '/user/orgs?per_page=100').catch(() => []);
        orgs = (o || []).map((x) => ({ id: x.id, login: x.login })).filter((o) => o.login);
      }
      return { id: user.id, login: user.login, orgs };
    },

    /** A GitHub user or organisation by name: { id, login, type }. A token raises the rate limit. */
    async lookup(name, token = null) {
      return call(token, 'GET', `/users/${encodeURIComponent(name)}`);
    },

    /** Repositories the user can reach through installations of this App. */
    async listRepos(userToken) {
      const inst = await call(userToken, 'GET', '/user/installations?per_page=100');
      const out = [];
      for (const i of inst?.installations ?? []) {
        for (let page = 1; page <= 10; page++) {
          const r = await call(userToken, 'GET', `/user/installations/${i.id}/repositories?per_page=100&page=${page}`);
          for (const repo of r?.repositories ?? []) {
            out.push({ id: repo.id, fullName: repo.full_name, installationId: i.id, defaultBranch: repo.default_branch, private: !!repo.private });
          }
          if ((r?.repositories ?? []).length < 100) break;
        }
      }
      return out;
    },

    /** A short-lived token for one repository, contents write only. */
    async installationToken(installationId, repositoryId) {
      const jwt = appJwt(appId, privateKey);
      const r = await call(jwt, 'POST', `/app/installations/${installationId}/access_tokens`,
        { repository_ids: [repositoryId], permissions: { contents: 'write' } });
      return r.token;
    },

    /**
     * Write files to a new branch on top of the default branch. files: [{ path, mode, content: Buffer }].
     * Returns { branch, url }.
     */
    async pushFiles(token, fullName, files, { branch, message }) {
      const repo = await call(token, 'GET', `/repos/${fullName}`);
      const base = repo.default_branch;
      let head;
      try {
        head = (await call(token, 'GET', `/repos/${fullName}/git/ref/heads/${encodeURIComponent(base)}`)).object.sha;
      } catch (e) {
        if (e.status === 404 || e.status === 409) throw new GitHubError('The repository is empty. Add a README on GitHub first, then push again.', 409);
        throw e;
      }
      const tree = [];
      const queue = [...files];
      const worker = async () => {
        for (let f; (f = queue.shift());) {
          const b = await call(token, 'POST', `/repos/${fullName}/git/blobs`, { content: f.content.toString('base64'), encoding: 'base64' });
          tree.push({ path: f.path, mode: f.mode, type: 'blob', sha: b.sha });
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      tree.sort((a, b) => (a.path < b.path ? -1 : 1));
      const t = await call(token, 'POST', `/repos/${fullName}/git/trees`, { tree });
      const c = await call(token, 'POST', `/repos/${fullName}/git/commits`, { message, tree: t.sha, parents: [head] });
      await call(token, 'POST', `/repos/${fullName}/git/refs`, { ref: `refs/heads/${branch}`, sha: c.sha });
      return { branch, url: `${browserWeb}/${fullName}/tree/${branch.split('/').map(encodeURIComponent).join('/')}` };
    },
  };
}

// ---- Reading the project's files -------------------------------------------------------------

const LIMITS = { files: 5000, fileBytes: 5 << 20, totalBytes: 50 << 20 };
const EXCLUDED_PART = new Set(['node_modules', 'dist', '.angular', '.git', '.idea', '.vscode', '.DS_Store', 'coverage', '.claude']);

/** Same exclusions as the zip and the bundle script, applied again here (the tar comes from the container). */
export function excluded(path) {
  const parts = path.split('/');
  if (parts.some((p) => EXCLUDED_PART.has(p))) return true;
  const name = parts[parts.length - 1];
  return name.startsWith('.env') || name.endsWith('.zip');
}

/**
 * Parse a tar stream (ustar, pax and GNU long names) into regular files. The content is untrusted:
 * paths are checked, links and devices are skipped, and sizes are capped.
 */
export function parseTar(buf, limits = LIMITS) {
  const files = [];
  let total = 0, off = 0, paxPath = null, longName = null;
  const str = (b) => { const i = b.indexOf(0); return b.subarray(0, i < 0 ? b.length : i).toString('utf8'); };
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      for (const rec of data.toString('utf8').split('\n')) {
        const m = rec.match(/^\d+ path=(.*)$/s);
        if (m) paxPath = m[1];
      }
      continue;
    }
    if (type === 'L') { longName = str(data); continue; }
    if (type === 'g') continue;
    const prefix = str(h.subarray(345, 500));
    let name = paxPath ?? longName ?? (prefix ? `${prefix}/${str(h.subarray(0, 100))}` : str(h.subarray(0, 100)));
    paxPath = longName = null;
    if (type !== '0' && type !== '\0' && type !== '7') continue;   // files only: no links, dirs, devices
    name = name.replace(/^\.\//, '');
    if (!name || name.startsWith('/') || name.split('/').some((p) => p === '..' || p === '')) continue;
    if (excluded(name)) continue;
    if (size > limits.fileBytes) throw new Error(`${name} is larger than ${limits.fileBytes >> 20} MB`);
    total += size;
    if (total > limits.totalBytes) throw new Error(`The project is larger than ${limits.totalBytes >> 20} MB without node_modules`);
    if (files.length >= limits.files) throw new Error(`The project has more than ${limits.files} files`);
    const modeBits = parseInt(str(h.subarray(100, 108)).trim() || '644', 8);
    files.push({ path: name, mode: modeBits & 0o111 ? '100755' : '100644', content: Buffer.from(data) });
  }
  return files;
}

// The same patterns as the bundle script's built-in scan (plugins/ambivo-devkit/scripts/ambivo-bundle.sh).
const SECRET = /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|xox[abposr]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

/** Places that look like a secret: [{ path, line }]. Binary files (with a NUL byte) are skipped. */
export function findSecrets(files) {
  const hits = [];
  for (const f of files) {
    if (f.content.includes(0)) continue;
    f.content.toString('utf8').split('\n').forEach((l, i) => { if (SECRET.test(l)) hits.push({ path: f.path, line: i + 1 }); });
  }
  return hits;
}
