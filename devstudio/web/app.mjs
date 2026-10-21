// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Dev Studio: a browser page in front of headless Claude Code, one container per project.
// createApp() builds the request handler from its parts (settings, container driver, key store,
// GitHub client), so tests can swap any of them for a fake. server.mjs wires the real ones.
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sign, verify, parseCookies, cookie } from './session.mjs';
import { parseTar, findSecrets, createGitHub } from './github.mjs';
import { PREVIEW_PORT, EXPORT_EXCLUDES } from './drivers/docker.mjs';
import { zipFiles, clientFiles } from './zipfile.mjs';
import { createFileProjects } from './projects.mjs';
import { createShares, ShareError } from './share.mjs';
import { openaiKeyProblem, codexArgv, codexContext, codexEvent, codexNewAppPrompt, stepTokens } from './codex.mjs';
import { createKeyStore } from './keystore.mjs';
import { createLocalObjects } from './objects.mjs';
import { checkBrief, docxText, BriefError, BRIEF_DIR, BRIEF_MAX } from './brief.mjs';
import { dataModelView, OBJECTS_FILE, MODEL_DOC } from './datamodel.mjs';
import { createAccess, AccessError, parseNames, names } from './access.mjs';
import { createPartnerSource, PARTNERPROG_NAME } from './partnersource.mjs';
import { parsePhases, PhasesError, newPhases, mergePhases, findPhase, cannotStart, phasesView, openingPrompt, phase0Prompt,
  PHASE0, PHASES_FILE, PHASE_DOCS, PHASE_ID, handoffFile } from './phases.mjs';
import { startSignIn, finishSignIn, signOut as ambivoSignOut, DEFAULT_API as AMBIVO_DEFAULT_API } from './ambivo-signin.mjs';
import { createDeploy } from './deploy.mjs';
import { JOBS_FILE, JOB_ID, JobsError, cleanJobsDoc, coreCall, jobsForCore, objectsForJobs, secretProblem } from './appjobs.mjs';

/** Exit codes that mean a run hit its container's memory cap (see the error emitted when a run ends). */
const OUT_OF_MEMORY_CODES = new Set([134, 137]);
/** The page shows this under a memory error: building on your own computer has no shared memory cap. */
const BUILD_LOCALLY_HELP = {
  text: 'Large apps build faster on your own computer, with all its memory. Use the free Docker image.',
  link: 'How to start with Docker',
  href: 'https://www.ambivo.com/documentation/guides/dev-studio#docker',
};

const HERE = dirname(fileURLToPath(import.meta.url));
// Claude Code model aliases a partner may pick per app. '' is Claude Code's default.
export const MODELS = ['', 'sonnet', 'opus'];
const DEFAULT_PLUGIN = '/opt/ambivo-devkit';
const LOCAL_USER = Object.freeze({ id: 'local', login: 'local' });
const ID = '[a-f0-9]{12}';

// The plugin is written for a terminal. In Dev Studio the partner has only the web page and its buttons.
function devStudioContext(serverMode) {
  return [
    'You are running inside Ambivo Dev Studio. The partner talks to you through a web page and has no terminal.',
    'Never ask them to run a command. Run commands yourself when they are needed.',
    'To try the app, they click Preview at the top of the page. It runs the app from /work/app and opens it in a new tab.',
    'They sign in there with their sandbox account. Do not start your own dev server on port 4200; Preview uses it.',
    ...(serverMode ? ['If the Ambivo tools say there is no sign-in or it has ended, ask the partner to click "Sign in to your Ambivo sandbox" on the left of the page, then send their next message.'] : []),
    serverMode
      ? 'To take the code, they click Download zip or Push to GitHub. Do not run /ambivo-bundle or push to GitHub yourself.'
      : 'To take the code, they click Download zip. Do not offer /ambivo-bundle or a GitHub push from here.',
    'A large app is built in phases (the ambivo-phased-build rules). The page lists the phases from docs/PHASES.md with their status and cost,',
    'and has the buttons Start phase, Approve phase and Reopen. Each phase is a new conversation with you.',
    'Only the partner approves a phase, with the Approve phase button. Never say a phase is approved, and never start the next phase yourself.',
    'When a phase is done, end your reply by asking the partner to check it and click Approve phase.',
    'A client brief the partner uploaded is in /work/brief.',
  ].join(' ');
}

/** What kind of Claude credential this is, from its prefix only (the value is never logged). */
export function keyKind(key) {
  const k = String(key || '').trim();
  if (k.startsWith('sk-ant-oat')) return 'subscription';   // `claude setup-token`: Claude Pro/Max/Team
  if (k.startsWith('sk-ant-admin')) return 'admin';
  if (k.startsWith('sk-ant-api')) return 'api';
  return k.startsWith('sk-ant-') ? 'api' : 'unknown';
}

/**
 * Check the credential before saving it, so a wrong one fails now instead of after minutes of retries.
 * A subscription token cannot be checked this way (it is not an API key); Claude Code checks it on first use.
 */
export async function keyProblem(key, fetchImpl = fetch, log = console.log) {
  const kind = keyKind(key);
  if (kind === 'unknown') return 'Paste an Anthropic API key (sk-ant-api…) or a Claude subscription token (sk-ant-oat…).';
  if (kind === 'admin') return 'That is an Anthropic Admin key. It cannot run Claude. Use an API key from console.anthropic.com instead.';
  if (kind === 'subscription') return null;
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': String(key).trim(), 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return null;
    let type = '';
    try { type = (await r.json())?.error?.type || ''; } catch {}
    log(`key check: HTTP ${r.status} ${type} (api key, prefix only)`);
    if (r.status === 401) return 'Anthropic does not recognise that API key. It may have been deleted, or copied with a missing character.';
    if (r.status === 403) return 'Anthropic accepted the key but will not let it run models. Check the key\'s workspace in console.anthropic.com.';
    return null; // other answers (rate limit, outage): let the run report it
  } catch {
    return null;
  }
}

/** Summarise one stream-json line from `claude -p` into a page event, or null to skip. */
export function toEvent(msg) {
  if (msg.type === 'system' && msg.subtype === 'init') return { kind: 'status', text: 'Working…', session: msg.session_id };
  if (msg.type === 'assistant') {
    const parts = msg.message?.content ?? [];
    const text = parts.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const tools = parts.filter((c) => c.type === 'tool_use').map((c) => {
      const i = c.input ?? {};
      const what = i.file_path || i.command || i.path || i.pattern || i.query || '';
      // mcp__plugin_ambivo-devkit_ambivo__whoami -> whoami
      const name = String(c.name).replace(/^mcp__.*?__/, '');
      return `${name}${what ? `: ${String(what).slice(0, 140)}` : ''}`;
    });
    if (text) return { kind: 'assistant', text };
    if (tools.length) return { kind: 'tool', text: tools.join('\n') };
    return null;
  }
  if (msg.type === 'result') {
    return {
      kind: 'done', session: msg.session_id, error: msg.is_error || undefined,
      cost: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
      text: /budget/i.test(String(msg.subtype || '')) ? 'Stopped at the spending limit. Raise the limit to carry on.'
        : msg.is_error ? (msg.result || 'The run stopped with an error.') : undefined,
    };
  }
  return null;
}

/**
 * PROTOTYPE convenience (laptop mode only): with no token typed in, use the session the developer
 * created on this computer with `ambivo-mcp.mjs login`. Read at request time, kept only in memory.
 */
function localAmbivoSession() {
  try {
    const f = join(process.env.XDG_CONFIG_HOME || join(process.env.HOME, '.config'), 'ambivo-devkit', 'session.json');
    const s = JSON.parse(readFileSync(f, 'utf8'));
    return s.token && (!s.expiresAt || s.expiresAt > Date.now() / 1000) ? s : undefined;
  } catch {
    return undefined;
  }
}

const LOGIN_COMMAND = `node ${join(HERE, '..', '..', 'plugins', 'ambivo-devkit', 'mcp', 'ambivo-mcp.mjs')} login`;

/**
 * Local driver only: has the maker signed in to Claude Code in this container (`claude`, then /login),
 * or set a key in its environment? Then a run needs no key saved in Dev Studio. Read at request time.
 */
function claudeSignedInHere() {
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  return existsSync(join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || '', '.claude'), '.credentials.json'));
}

/** Laptop mode answers only its own page: a localhost Host (no DNS rebinding), and an Origin, if sent, of that same host. */
export function localRequestAllowed(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const name = host.replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(name)) return false;
  const origin = req.headers.origin;
  return origin === undefined || String(origin).toLowerCase() === `http://${host}`;
}
/**
 * Laptop mode: the secret in Dev Studio's link (http://localhost:4300/?token=...), kept in the data folder so a
 * restart keeps the same link. Inside the dev container, Docker hands every request from outside over from its
 * own address, so the Host check alone cannot tell this computer from another one on the network, or from
 * another container. A request on this machine's own loopback (an IDE's port forwarding, a terminal in the
 * container) needs no secret.
 */
export function loadAccessToken(dir) {
  const file = join(dir, 'access-token');
  try { const t = readFileSync(file, 'utf8').trim(); if (/^[a-f0-9]{48}$/.test(t)) return t; } catch { /* first start */ }
  mkdirSync(dir, { recursive: true });
  const t = randomBytes(24).toString('hex');
  writeFileSync(file, t, { mode: 0o600 });
  return t;
}
const ACCESS_COOKIE = 'ds_access';
const isLoopback = (addr) => /^(127\.|::1$|::ffff:127\.)/.test(String(addr || ''));
function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function json(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function page(res, code, title, html, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<body style="font:16px/1.5 system-ui,sans-serif;margin:32px 16px;max-width:720px">${html}</body>`);
}

async function readBody(req, max = 100000) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > max) throw new BriefError('The request is too large. A brief file can be up to 10 MB.', 413); }
  return raw ? JSON.parse(raw) : {};
}

/** A raw upload (the brief), refused past `max` bytes without reading the rest. */
async function readRaw(req, max) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) throw new BriefError('The file is larger than 10 MB. Send a smaller copy, for example without pictures.', 413);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readAll(stream, max) {
  const chunks = [];
  let n = 0;
  for await (const c of stream) {
    n += c.length;
    if (n > max) throw new Error(`The project is larger than ${max >> 20} MB without node_modules.`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** Sign-in tries allowed per GitHub user in the window below. */
export const AMBIVO_SIGN_IN_LIMIT = 5;
export const AMBIVO_SIGN_IN_WINDOW_MS = 10 * 60 * 1000;
const AMBIVO_CODE_MS = 10 * 60 * 1000;     // how long Dev Studio waits for the emailed code
/** Object key of a user's recent Ambivo sign-in tries: { tries: [ms, ...] }. */
export const ambivoTriesKey = (uid) => `ratelimit/ambivo-sign-in/${uid}.json`;
/** How often an open event stream gets a comment line, so a load balancer never sees it idle (60 s). */
export const KEEPALIVE_MS = 25_000;
/** The longest a one-off command in a project (the sandbox teardown) may run before it is given up. */
export const RUN_IN_TIMEOUT_MS = 15 * 60_000;
export const AMBIVO_ENDED = 'Your Ambivo sandbox sign-in has ended. Sign in again.';

/**
 * @param ambivoSessions  server mode: a key store (folder 'ambivo', purpose 'ambivo-session') for each
 *                        partner's Ambivo sandbox session. null turns the Ambivo sign-in routes off.
 * @param projectStore    where projects and their histories are saved (projects.mjs). Default: the
 *                        projects.json file in DEVSTUDIO_DATA, as before.
 * @param files           saves and restores each project's volumes (projectfiles.mjs), or null when
 *                        they live only on this host
 * @param shares          share links (share.mjs). Default: built files in config.shares on this host.
 * @param openaiKeys      each user's OpenAI key for Codex projects (a key store, purpose 'openai-key').
 *                        Default: local files under DEVSTUDIO_DATA/openai.
 * @param githubTokens    server mode: a key store (folder 'github', purpose 'github-token') holding each
 *                        session's GitHub user token, by session id. Default: local files.
 * @param ambivoPending   server mode: a key store (folder 'ambivo-pending', purpose 'ambivo-pending')
 *                        holding the emailed-code step of an Ambivo sign-in, by GitHub user id.
 * @param objects         the object store (objects.mjs or s3.mjs) for plain state: the Ambivo sign-in
 *                        rate limit, and share builds. Default: the key store's own store.
 * @param access          who may sign in (access.mjs). Default: built here, from partnerSource when there is one.
 * @param partnerSource   the Partner Program source (partnersource.mjs). Default: built and started here
 *                        when config.partnerProg.on and `access` is not given.
 * @param keepAliveMs     how often an open event stream gets a comment line (KEEPALIVE_MS)
 */
export function createApp({ config, driver, keys, github = null, ambivoSessions = null, projectStore = null, files = null, shares = null, openaiKeys = null, githubTokens = null, ambivoPending = null, deploySessions = null, deployPending = null, objects = null, access: accessIn = null, partnerSource: partnerSourceIn = null, fetchImpl = fetch, log = console.log, previewPoll = { tries: 90, ms: 2000 }, keepAliveMs = KEEPALIVE_MS, runInTimeoutMs = RUN_IN_TIMEOUT_MS }) {
  // The Partner Program source (config.partnerProg.on): who may sign in beyond the floor comes from there.
  const partnerSource = partnerSourceIn ?? (!accessIn && config.partnerProg?.on
    ? createPartnerSource({ config, fetchImpl, objects: objects || keys?.store || createLocalObjects(config.data), lookup: github ? (name) => github.lookup(name) : null, log })
    : null);
  partnerSource?.start();
  const access = accessIn ?? createAccess({ objects: null, dataDir: config.data, lookup: github ? (name, token) => github.lookup(name, token) : null, source: partnerSource });
  // DEVSTUDIO_ADMINS is "login:id"; with the id, a renamed account keeps the right and the freed name gets nothing.
  const admins = parseNames(config.admins || []);
  const isAdmin = (user) => !!user?.login && admins.some((a) => names(a, { id: user.id, login: user.login }));
  const { serverMode } = config;
  const PLUGIN = config.plugin || DEFAULT_PLUGIN;
  // Local driver: the maker's own Claude Code sign-in in the container stands in for a saved Claude key.
  const ownLogin = () => driver.kind === 'local' && claudeSignedInHere();

  // ---- the dev container's checks (local driver, in the image only) ------------------------------
  // What ambivo-start saved at start, then the full check (the Claude sign-in tried for real) in the
  // background, and again on "Check again". Until a full check passes, no new app or message runs.
  let setup = null;
  let setupRun = null;
  if (driver.kind === 'local' && config.checks) {
    try { setup = JSON.parse(readFileSync(join(config.data, 'startup.json'), 'utf8')); } catch { /* not saved yet */ }
  }
  function checkSetup() {
    if (driver.kind !== 'local' || !config.checks) return Promise.resolve(null);
    setupRun ??= new Promise((resolve) => {
      execFile(process.execPath, [config.checks, '--auth', '--json'], { timeout: 150_000, maxBuffer: 1 << 20 }, (err, stdout) => {
        try { setup = JSON.parse(stdout); } catch { log(`checks: ${err?.message || 'no answer'}`); }
        setupRun = null;
        resolve(setup);
      });
    });
    return setupRun;
  }
  checkSetup();
  /** Refuse work only on a full check that failed: a check still running, or none at all, refuses nothing. */
  const notReady = () => (setup?.auth && !setup.ready
    ? 'Dev Studio is not ready yet. See Status on the left, fix what it lists, then click Check again.' : null);
  mkdirSync(config.data, { recursive: true });

  // Project records are saved (no secrets). Claude keys are in the key store, per user.
  const store = projectStore || createFileProjects({ dataDir: config.data });
  const openai = openaiKeys || createKeyStore({ dataDir: config.data, folder: 'openai', purpose: 'openai-key' });
  const share = shares || createShares({ dir: config.shares, driver, fetchImpl, apiUrl: config.ambivoApi, log, objects });
  const projects = store.cache;   // id -> record + events, as loaded on this server
  const ambivoTokens = new Map(); // project id -> Ambivo token typed in for it (memory only)
  // Server mode only. Kept in the object store, so a restart or another server keeps them.
  //   ghTokens       session id -> { token, exp }: the GitHub user token, encrypted
  //   pendingStore   GitHub user id -> { challenge, email }, meta { exp }: waiting for the emailed code
  //   stateObjects   ratelimit/ambivo-sign-in/<uid>.json: recent Ambivo sign-in tries
  const ghTokens = !serverMode ? null : (githubTokens || createKeyStore({ dataDir: config.data, folder: 'github', purpose: 'github-token' }));
  const pendingStore = !serverMode ? null : (ambivoPending || createKeyStore({ dataDir: config.data, folder: 'ambivo-pending', purpose: 'ambivo-pending' }));
  const stateObjects = objects || keys?.store || createLocalObjects(config.data);
  const listeners = new Map();    // id -> Set(res)
  const busy = new Set();
  // Messages sent while the assistant works: id -> [text]. Sent together when the run ends. In memory only.
  const queued = new Map();
  const QUEUE_MAX = 5;
  const previewOk = new Map();    // id -> time the preview last answered
  const PREVIEW_FRESH_MS = 15000;

  function emit(id, event) {
    if (!projects[id]) return;
    // In a phased project each event belongs to the phase active when it happened, so the page can group them.
    const phase = projects[id].phases?.active;
    if (phase && event.phase === undefined) event = { ...event, phase };
    store.append(id, { ts: Date.now(), ...event });
    for (const res of listeners.get(id) ?? []) res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  /** Save a record change. Failures are logged; the page keeps working from memory. */
  function update(id, fn) {
    return store.update(id, fn).catch((err) => log(`project ${id}: saving: ${err.message}`));
  }

  /** The record (or phase entry) that holds a conversation's session, thread and token count. */
  function convOf(rec, phaseId, side = null) {
    if (!rec) return null;
    // A side conversation (the user guide) keeps its own session and cost, apart from the phases.
    if (side) return (rec[side] ||= {});
    return phaseId ? findPhase(rec.phases, phaseId) : rec;
  }

  /** A text file in the project's container, or null when it is not there. */
  async function readText(id, path) {
    const b = await driver.readFile(id, path).catch(() => null);
    return b ? b.toString('utf8') : null;
  }

  /** Is this phase finished, as far as files show? { done, error } */
  async function phaseDone(id, phaseId) {
    if (phaseId === PHASE0.id) {
      const text = await readText(id, PHASES_FILE);
      if (text === null) return { done: false, error: null };
      let parsed;
      try { parsed = parsePhases(text); } catch (err) { if (err instanceof PhasesError) return { done: false, error: err.message }; throw err; }
      for (const f of PHASE_DOCS) {
        if ((await readText(id, `/work/app/${f}`)) === null) return { done: false, error: null, parsed };
      }
      return { done: true, error: null, parsed };
    }
    const note = await readText(id, handoffFile(phaseId));
    return { done: !!note?.trim() };
  }

  /**
   * After a message: read docs/PHASES.md and the phase's handoff note, and save what changed.
   * A project not built in phases becomes one when its first conversation wrote a valid docs/PHASES.md
   * (the assistant judged the app large): that conversation becomes phase 0.
   */
  // The end-user guide, written by the assistant with the ambivo-user-guide skill.
  const GUIDE_DIR = '/work/app/docs/user-guide';
  const GUIDE_PROMPT = 'Write the user guide for this app with the ambivo-user-guide skill from the ambivo-devkit plugin. ' +
    'Replace docs/user-guide/ if it is there. Follow the writing rules in the skill for every sentence.';
  const GUIDE_PROMPT_CODEX = 'Write the user guide for this app as the section "The user guide" in /work/app/AGENTS.md says. ' +
    'Replace docs/user-guide/ if it is there. Follow its writing rules for every sentence.';

  // Screenshots the assistant takes of a phase's screens (plugin scripts/ambivo-screenshot.mjs --phase <id>).
  const shotsDir = (phaseId) => `/work/app/.ambivo/screens/${phaseId}`;
  const SHOT_NAME = /^[a-z0-9][a-z0-9._-]{0,80}\.png$/i;
  async function listShots(id, phaseId) {
    if (!PHASE_ID.test(phaseId)) return [];
    const out = await driver.sh(id, `ls -1 '${shotsDir(phaseId)}' 2>/dev/null || true`).then((o) => o.stdout, () => '');
    return String(out).split('\n').map((x) => x.trim()).filter((x) => SHOT_NAME.test(x)).sort().slice(0, 200);
  }

  async function syncPhases(id, phaseId) {
    const p = projects[id];
    if (!p) return;
    if (!p.phases) {
      const text = await readText(id, PHASES_FILE);
      if (text === null) return;
      let parsed;
      try { parsed = parsePhases(text); } catch (err) { if (!(err instanceof PhasesError)) throw err; return; }
      await update(id, (rec) => { if (!rec.phases) { rec.phases = mergePhases(newPhases('waiting', rec), parsed); rec.phasesError = null; } });
      emit(id, { kind: 'phases', phase: PHASE0.id });
      return;
    }
    const text = await readText(id, PHASES_FILE);
    let parsed = null, error = null;
    if (text !== null) {
      try { parsed = parsePhases(text); } catch (err) { if (!(err instanceof PhasesError)) throw err; error = err.message; }
    }
    const done = phaseId ? await phaseDone(id, phaseId) : { done: false };
    const shots = phaseId ? (await listShots(id, phaseId)).length : 0;
    await update(id, (rec) => {
      if (!rec.phases) return;
      if (parsed) mergePhases(rec.phases, parsed);
      rec.phasesError = error;
      const ph = phaseId && findPhase(rec.phases, phaseId);
      if (ph) ph.shots = shots;
      if (ph && ph.status === 'working' && done.done) ph.status = 'waiting';
    });
    emit(id, { kind: 'phases' });
  }

  /**
   * Before anything runs in a project's container: on a server that has never had the project (or
   * lost its volume), bring back its files and Claude session from storage first.
   */
  // ---- idle containers ----------------------------------------------------------------------------
  // A project's container runs the assistant and its preview. Left running, every project ever
  // opened holds memory. One idle past config.idleMinutes is saved and stopped; prepare() starts it
  // again on the next message, preview, share, push or download.
  const lastActive = new Map(); // id -> ms
  const touch = (id) => lastActive.set(id, Date.now());

  async function stopIdle(now = Date.now()) {
    const limit = (config.idleMinutes || 0) * 60_000;
    if (!limit || !driver.isRunning || !driver.stop) return [];
    const stopped = [];
    for (const id of Object.keys(projects)) {
      if (busy.has(id)) { touch(id); continue; }
      // First sight after a restart: start the clock instead of stopping at once.
      if (!lastActive.has(id)) { touch(id); continue; }
      if (now - lastActive.get(id) < limit) continue;
      if (!(await driver.isRunning(id))) continue;
      try {
        if (files) await files.save(id);
        await driver.stop(id);
        previewOk?.delete?.(id);
        stopped.push(id);
        log(`project ${id}: idle ${Math.round((now - lastActive.get(id)) / 60_000)} min, files saved, container stopped`);
      } catch (err) {
        log(`project ${id}: could not stop the idle container: ${err.message}`);
      }
    }
    return stopped;
  }

  async function prepare(id) {
    if (files) {
      const r = await files.restore(id);
      if (r === 'restored') emit(id, { kind: 'status', text: 'Your saved files are back.' });
    }
    touch(id);
    return driver.ensureRunning(id, config.image);
  }

  // ---- who is asking ------------------------------------------------------------------------
  const publicOrigin = serverMode ? new URL(config.publicUrl).origin : null;
  const cookieBase = { secure: !!config.secureCookies };
  const accessToken = serverMode ? null : (config.accessToken || loadAccessToken(config.data));
  // __Host-: the browser takes it only from this exact host, over HTTPS, with no Domain. Partner code on
  // p-<id> and s-<id> can set cookies for the parent domain, and a planted ds_session ran the victim's
  // requests as the planter. Plain http (tests on a laptop) cannot use the prefix.
  const SESSION = cookieBase.secure ? '__Host-ds_session' : 'ds_session';

  function currentUser(req) {
    if (!serverMode) return LOCAL_USER;
    const s = verify(parseCookies(req.headers.cookie)[SESSION], config.sessionSecret, { scope: 'app' });
    return s ? { id: String(s.uid), login: s.login, sid: s.sid, exp: s.exp, iat: s.iat, signed: s } : null;
  }

  /**
   * A session in use stays signed in: past half its life, a request renews both cookies for another
   * sessionHours, up to sessionMaxDays after the GitHub sign-in. After that, signing in again is needed.
   */
  function renewSession(res, user) {
    if (!serverMode || !user?.exp || !user.signed) return;
    const ttl = config.sessionHours * 3600 * 1000, now = Date.now();
    if (user.exp - now > ttl / 2) return;
    const iat = user.iat ?? user.exp - ttl;
    const cap = iat + config.sessionMaxDays * 86400 * 1000;
    const exp = Math.min(now + ttl, cap);
    if (exp <= user.exp) return;
    const app = sign({ ...user.signed, exp, iat }, config.sessionSecret);
    const { uid, login, via, gid, gname } = user.signed;
    const prev = sign({ uid, login, via, gid, gname, exp, iat, scope: 'preview' }, config.sessionSecret);
    const age = Math.floor((exp - now) / 1000);
    res.setHeader('Set-Cookie', [
      cookie(SESSION, app, { ...cookieBase, maxAge: age }),
      cookie('ds_preview', prev, { ...cookieBase, maxAge: age, domain: config.previewDomain }),
    ]);
  }

  /** Owner check. Laptop mode: projects made before ownership belong to the one local user. */
  function owns(user, p) {
    if (!user || !p) return false;
    if (!p.owner) return !serverMode;
    return String(p.owner.id) === String(user.id);
  }
  const ownerId = (p) => (p.owner ? String(p.owner.id) : LOCAL_USER.id);
  // Each project has one assistant: Claude Code (the default, and every project made before Codex) or Codex.
  const isCodex = (p) => p?.assistant === 'codex';
  const keyStoreFor = (p) => (isCodex(p) ? openai : keys);
  const keyed = async (p) => (await keyStoreFor(p).has(ownerId(p))) || (!isCodex(p) && ownLogin());
  const KEY_NAME = { claude: 'Claude key', openai: 'OpenAI key' };
  const providerOf = (p) => (isCodex(p) ? 'openai' : 'claude');
  const keyName = (p) => KEY_NAME[providerOf(p)];

  /** Check a key with its provider, then save it encrypted. Returns the problem to show, or null. */
  async function saveKey(user, provider, key) {
    const problem = provider === 'openai' ? await openaiKeyProblem(key, fetchImpl, log) : await keyProblem(key, fetchImpl, log);
    if (problem) return problem;
    await (provider === 'openai' ? openai : keys).save(user.id, String(key).trim());
    return null;
  }
  const keyFrom = (provider, body) => (provider === 'openai' ? body.openaiKey : body.anthropicKey);

  // ---- one turn: the partner's message to the assistant in the project's container -------------
  /** The partner's sandbox session for a run in this project's container: env vars, 'ended', or null. */
  async function ambivoEnv(id, p) {
    const token = ambivoTokens.get(id) || (!serverMode ? localAmbivoSession()?.token : undefined);
    if (token) return { AMBIVO_TOKEN: token };
    if (!serverMode || !ambivoSessions) return null;
    // Decrypted here only, for this one exec.
    const s = await ambivoSession(ownerId(p));
    if (s === 'ended') return 'ended';
    if (!s) return null;
    return { AMBIVO_TOKEN: s.token, ...(s.apiUrl && s.apiUrl !== AMBIVO_DEFAULT_API ? { AMBIVO_API_URL: s.apiUrl } : {}) };
  }

  /** Run a command in the project's container and collect what it prints. */
  /** Runs a command in the project's container. Always settles: on exit, on a spawn error, or at the time limit. */
  function runIn(id, argv, env = {}, { timeoutMs = runInTimeoutMs } = {}) {
    return new Promise((resolveRun) => {
      const child = driver.exec(id, argv, { env, workdir: '/work', interactive: false });
      let out = '', err = '', done = false;
      const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolveRun({ code, out, err }); };
      const timer = setTimeout(() => { err += `\nError: no answer within ${Math.round(timeoutMs / 60000)} minutes.`; try { child.kill?.(); } catch { /* gone */ } finish(124); }, timeoutMs);
      timer.unref?.();
      child.stdout.on('data', (c) => { out += c; });
      child.stderr?.on('data', (c) => { err += c; });
      child.on('error', (e) => { err += `\nError: ${e.message}`; finish(1); });
      child.on('close', (code) => finish(code));
      child.stdin?.end?.();
    });
  }

  async function turn(id, prompt, { side = null } = {}) {
    // Busy before the first await: a removal or another run checking busy in between must see it.
    busy.add(id);
    const p = projects[id];
    const codex = isCodex(p);
    // The conversation this message belongs to: the active phase's, or the project's own (not phased),
    // or a side conversation such as the user guide.
    const phaseId = side ? null : p.phases?.active || null;
    let apiKey;
    try { apiKey = await keyStoreFor(p).get(ownerId(p)); }
    catch (err) { log(`key store: ${err.message}`); }
    if (!apiKey && !(!codex && ownLogin())) {
      busy.delete(id);
      emit(id, { kind: 'error', text: `Enter your ${keyName(p)} to continue.` });
      emit(id, { kind: 'idle' });
      return;
    }
    try {
      const r = await prepare(id);
      if (r.state === 'started') emit(id, { kind: 'status', text: 'The project had stopped. Started it again.' });
      // After a Dev Studio release the assistant gets the new skills. Only here, at the start of a message:
      // nothing runs in the container yet, and busy keeps everything else from starting.
      if (r.state !== 'recreated' && driver.isCurrent && !(await driver.isCurrent(id, config.image))) {
        await driver.recreate(id, config.image);
        previewOk.delete(id);
        log(`project ${id}: moved to the current runner image`);
        emit(id, { kind: 'status', text: 'Dev Studio was updated. The assistant now has the latest guidance. Your files and conversation are kept.' });
      }
      if (r.state === 'recreated') {
        emit(id, { kind: 'status', text: r.sessionKept ? 'The project was set up again. Your files and conversation are kept.'
          : 'The project was set up again. Your files are kept, but the assistant starts a new conversation.' });
        if (!r.sessionKept) {
          await update(id, (rec) => {
            for (const c of [rec, ...(rec.phases?.list ?? [])]) { delete c.session; delete c.codexThread; delete c.codexUsage; }
          });
        }
      }
    } catch (err) {
      busy.delete(id);
      emit(id, { kind: 'error', text: `Could not start the project: ${err.message}` });
      emit(id, { kind: 'idle' });
      return;
    }
    const credVar = codex ? 'OPENAI_API_KEY' : keyKind(apiKey) === 'subscription' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY';
    // Keys travel in the docker CLI's environment for this one exec, never in argv or on disk in the container.
    // No saved key (local driver): Claude Code uses the maker's own sign-in in the container.
    const env = apiKey ? { [credVar]: String(apiKey).trim() } : {};
    const amb = await ambivoEnv(id, p);
    if (amb === 'ended') emit(id, { kind: 'status', text: AMBIVO_ENDED });
    else if (amb) Object.assign(env, amb);
    const conv = convOf(projects[id], phaseId, side) || {};
    let session = conv.session, thread = conv.codexThread, usage = conv.codexUsage;
    let argv, workdir = '/work';
    if (codex) {
      // Codex reads AGENTS.md from its working folder: the app's, once the app exists.
      if (await driver.sh(id, 'test -f /work/app/AGENTS.md').then(() => true, () => false)) workdir = '/work/app';
      env.CLAUDE_PLUGIN_ROOT = PLUGIN;   // AGENTS.md and the skills write script paths with it
      argv = codexArgv({ thread, instructions: codexContext(devStudioContext(serverMode)) });
    } else {
      argv = ['claude', '-p', '--output-format', 'stream-json', '--verbose',
        '--plugin-dir', PLUGIN, '--dangerously-skip-permissions', '--append-system-prompt', devStudioContext(serverMode)];
      if (session) argv.push('--resume', session);
      const lim = projects[id]?.limits || {};
      if (lim.model) argv.push('--model', lim.model);
      if (lim.phaseBudget > 0) {
        // The limit covers a phase (or, in an app without phases, each message). Claude Code stops itself there.
        const spent = phaseId ? (findPhase(projects[id].phases, phaseId)?.cost ?? 0) : 0;
        const left = lim.phaseBudget - spent;
        if (left < 0.05) {
          busy.delete(id);
          emit(id, { kind: 'error', text: `This phase has used $${spent.toFixed(2)} of its $${lim.phaseBudget.toFixed(2)} limit. Raise the limit to carry on.`, limit: true });
          emit(id, { kind: 'idle' });
          return;
        }
        argv.push('--max-budget-usd', left.toFixed(2));
      }
    }
    const child = driver.exec(id, argv, { env, workdir });
    child.stdin.end(prompt);
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const ev = codex ? codexEvent(msg) : toEvent(msg);
        if (!ev) continue;
        // Sessions, threads and cost go to the conversation (phase) this message runs in; cost and tokens
        // also add to the project's total.
        if (ev.session && ev.session !== session) {
          const s = session = ev.session;
          update(id, (rec) => { const c = convOf(rec, phaseId, side); if (c) c.session = s; });
        }
        if (typeof ev.cost === 'number') {
          const cost = ev.cost;
          update(id, (rec) => {
            rec.cost = (rec.cost ?? 0) + cost;
            const ph = phaseId && findPhase(rec.phases, phaseId);
            if (ph) ph.cost = (ph.cost ?? 0) + cost;
            if (side) { const c = convOf(rec, null, side); c.cost = (c.cost ?? 0) + cost; }
          });
        }
        if (ev.thread) {
          const t = ev.thread;
          delete ev.thread;
          if (t !== thread) { thread = t; update(id, (rec) => { const c = convOf(rec, phaseId, side); if (c) c.codexThread = t; }); }
        }
        if (ev.usage) {
          // Codex reports tokens, not dollars. The usage is the thread's total so far; the step is the difference.
          const { step, saved } = stepTokens(usage, thread, ev.usage);
          usage = saved;
          update(id, (rec) => {
            const c = convOf(rec, phaseId, side);
            if (c) c.codexUsage = saved;
            rec.tokens = (rec.tokens ?? 0) + step;
            const ph = phaseId && findPhase(rec.phases, phaseId);
            if (ph) ph.tokens = (ph.tokens ?? 0) + step;
          });
          ev.tokens = step;
          delete ev.usage;
        }
        emit(id, ev);
      }
    });
    let errText = '';
    child.stderr.on('data', (c) => { errText += c; });
    child.on('close', async (code) => {
      if (code !== 0) {
        const who = codex ? 'Codex' : 'Claude Code';
        // 134: Claude Code (Bun) aborts when it cannot get memory; 137: the kernel's OOM killer. Dev Studio
        // never kills a run itself, so both mean the project hit its container's memory cap.
        emit(id, OUT_OF_MEMORY_CODES.has(code)
          ? { kind: 'error', text: `${who} stopped because this app ran out of memory on Dev Studio's shared server. Send your message again to try once more.`, help: BUILD_LOCALLY_HELP }
          : { kind: 'error', text: `${who} stopped (exit ${code}). ${errText.slice(-400)}` });
      }
      // Read the phase plan and this phase's handoff note before the page is told the message ended.
      try { await syncPhases(id, phaseId); } catch (err) { log(`project ${id}: phases: ${err.message}`); }
      busy.delete(id);
      touch(id);
      const waiting = queued.get(id);
      queued.delete(id);
      if (waiting?.length && projects[id] && !(projects[id].phases && !projects[id].phases.active)) {
        // Messages sent while it worked: one more run with all of them, in the order they came.
        emit(id, { kind: 'status', text: waiting.length === 1 ? 'Sending your waiting message.' : `Sending your ${waiting.length} waiting messages.` });
        store.flush(id).catch((err) => log(`project ${id}: saving history: ${err.message}`));
        turn(id, waiting.join('\n\n'));
        return;
      }
      emit(id, { kind: 'idle' });
      // End of a message: save the history now, and the files, so another server could take over.
      store.flush(id).catch((err) => log(`project ${id}: saving history: ${err.message}`));
      if (files && projects[id]) files.save(id).catch((err) => log(`project ${id}: saving files: ${err.message}`));
    });
  }

  // ---- Ambivo sandbox sign-in (server mode) ----------------------------------------------------
  // The partner signs in with their SANDBOX account's email and password. The password goes to Ambivo
  // in one request and is never kept or logged. Only a session for a partner sandbox tenant is kept:
  // the login response carries the tenant (user.tenant_dict), and a sandbox has meta.partner_sandbox.

  /** The partner's Ambivo session, decrypted: { token, apiUrl, expiresAt }, 'ended', or null. */
  async function ambivoSession(uid) {
    const info = await ambivoSessions.info(uid);
    if (!info) return null;
    if (!(info.until > Date.now())) return 'ended';
    let rec;
    try { rec = JSON.parse(await ambivoSessions.get(uid)); }
    catch (err) { log(`ambivo session store: ${err.message}`); return null; }
    if (!rec?.token || !(rec.expiresAt * 1000 > Date.now())) return 'ended';
    return rec;
  }

  /** What the page shows. Decrypts nothing. */
  async function ambivoStatus(uid) {
    const info = await ambivoSessions?.info(uid);
    if (!info) return { signedIn: false };
    if (!(info.until > Date.now())) return { signedIn: false, ended: true, email: info.email, message: AMBIVO_ENDED };
    return { signedIn: true, email: info.email, tenantName: info.tenantName, until: info.until };
  }

  /**
   * 0 when this user may try again now (the try is recorded), else the minutes to wait.
   * The tries are one object per user. Read, change, write, with no condition: two tries at the same
   * moment on two servers can count as one. That is fine for a limit of a few tries in ten minutes.
   */
  async function ambivoTry(uid) {
    const now = Date.now();
    const o = await stateObjects.get(ambivoTriesKey(uid));
    let saved = [];
    try { saved = o ? JSON.parse(o.body.toString('utf8')).tries ?? [] : []; } catch { saved = []; }
    const recent = (Array.isArray(saved) ? saved : []).filter((t) => typeof t === 'number' && now - t < AMBIVO_SIGN_IN_WINDOW_MS);
    if (recent.length >= AMBIVO_SIGN_IN_LIMIT) return Math.ceil((recent[0] + AMBIVO_SIGN_IN_WINDOW_MS - now) / 60000);
    recent.push(now);
    await stateObjects.put(ambivoTriesKey(uid), JSON.stringify({ tries: recent }), { contentType: 'application/json' });
    return 0;
  }

  /** The emailed-code step waiting for this user, or null. An expired one is deleted. */
  async function pendingGet(uid) {
    const meta = await pendingStore.info(uid);
    if (!meta) return null;
    if (!(meta.exp > Date.now())) { await pendingStore.remove(uid); return null; }
    try { return { ...JSON.parse(await pendingStore.get(uid)), exp: meta.exp }; }
    catch (err) { log(`ambivo pending store: ${err.message}`); return null; }
  }

  /** Keep a finished sign-in, or refuse it when the account is outside a partner sandbox. */
  async function ambivoKeep(user, session) {
    if (!session.sandbox) {
      // A real company's session is ended at Ambivo straight away and never stored.
      await ambivoSignOut({ apiUrl: session.apiUrl, token: session.token, connectionId: session.connectionId, fetchImpl });
      log(`ambivo sign-in refused (not a partner sandbox): ${user.login}`);
      return [403, { error: 'Dev Studio works with sandbox accounts only. Sign in with your sandbox email, like name+sandbox@yourcompany.com.', notSandbox: true }];
    }
    const until = session.expiresAt * 1000;
    await ambivoSessions.save(user.id,
      JSON.stringify({ token: session.token, apiUrl: session.apiUrl, expiresAt: session.expiresAt, connectionId: session.connectionId }),
      { email: session.email, tenantName: session.tenantName, until });
    log(`ambivo sign-in: ${user.login} to sandbox ${session.sandbox.partnerKey}`);
    return [200, { signedIn: true, email: session.email, tenantName: session.tenantName, until }];
  }

  function ambivoFailure(user, err) {
    log(`ambivo sign-in failed: ${user.login} ${err.code || err.message}`);
    if (err.code === 'UNREACHABLE') return [502, { error: err.message }];
    if (err.status === 429 || err.code === 'RATE_LIMIT_EXCEEDED') return [429, { error: err.message }];
    return [400, { error: err.message || 'Sign-in did not finish. Try again.' }];
  }

  async function ambivoSignIn(user, body) {
    const email = String(body.email ?? '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return [400, { error: 'Enter your sandbox email and password.' }];
    if (email.length > 100 || password.length > 128 || !/^[^@\s]+@[^@\s]+$/.test(email)) return [400, { error: 'Check the email and password.' }];
    const wait = await ambivoTry(user.id);
    if (wait) return [429, { error: `Too many sign-in tries. Wait ${wait} minutes, then try again.` }];
    await pendingStore.remove(user.id);
    let step;
    try {
      step = await startSignIn({ apiUrl: config.ambivoApi, email, password, deviceId: `devstudio-${user.id}`, os: 'web', fetchImpl });
    } catch (err) { return ambivoFailure(user, err); }
    if (step.challenge) {
      const exp = Date.now() + AMBIVO_CODE_MS;
      await pendingStore.save(user.id, JSON.stringify({ challenge: step.challenge, email }), { exp });
      return [200, { needCode: true, destination: step.challenge.destination }];
    }
    return ambivoKeep(user, step.session);
  }

  async function ambivoVerify(user, body) {
    const pending = await pendingGet(user.id);
    if (!pending || pending.exp <= Date.now()) {
      await pendingStore.remove(user.id);
      return [400, { error: 'Sign in again to get a new code.', restart: true }];
    }
    const code = String(body.code ?? '').replace(/\s+/g, '');
    if (!/^\d{4,8}$/.test(code)) return [400, { error: 'Enter the code from the email. It has 6 digits.' }];
    let step;
    try {
      step = await finishSignIn({ apiUrl: config.ambivoApi, challenge: pending.challenge, code, email: pending.email, fetchImpl });
    } catch (err) {
      // A wrong code can be typed again (Ambivo counts the tries). Anything else needs a new sign-in.
      if (err.code !== 'INVALID_MFA_CODE') await pendingStore.remove(user.id);
      const [status, out] = ambivoFailure(user, err);
      return [status, err.code === 'INVALID_MFA_CODE' ? out : { ...out, restart: true }];
    }
    await pendingStore.remove(user.id);
    return ambivoKeep(user, step.session);
  }

  async function ambivoForget(user) {
    await pendingStore.remove(user.id);
    if (!(await ambivoSessions.info(user.id))) return false;
    // End it at Ambivo too, so the token stops working everywhere. Best effort.
    try {
      const rec = JSON.parse(await ambivoSessions.get(user.id));
      if (rec?.token) await ambivoSignOut({ apiUrl: rec.apiUrl, token: rec.token, connectionId: rec.connectionId, fetchImpl });
    } catch (err) { log(`ambivo sign-out: ${err.message}`); }
    await ambivoSessions.remove(user.id);
    log(`ambivo signed out: ${user.login}`);
    return true;
  }

  // ---- preview ------------------------------------------------------------------------------
  function previewUrl(id, target) {
    if (!serverMode) return `http://localhost:${target.split(':').pop()}`;
    const u = new URL(config.publicUrl);
    return `${u.protocol}//p-${id}.${config.previewDomain}${u.port ? `:${u.port}` : ''}`;
  }

  const previewing = new Set();
  async function startPreview(id) {
    if (previewing.has(id)) return { error: 'The preview is still starting. Try again in a moment.' };
    previewing.add(id);
    try {
      await prepare(id);
      let target = await driver.previewTarget(id);
      if (!target) {
        // Made before previews: it needs the port, and that means a new container.
        if (busy.has(id)) return { error: 'The assistant is working. Try the preview again when it finishes.' };
        await driver.recreate(id, config.image);
        target = await driver.previewTarget(id);
      }
      if (!(await driver.previewReady(id))) {
        try { await driver.sh(id, 'test -f /work/app/package.json'); }
        catch { return { error: 'There is no app to preview yet.' }; }
        await driver.sh(id,
          `{ [ -d node_modules ] || npm install --no-audit --no-fund; } > /tmp/preview.log 2>&1 && ` +
          `exec npx ng serve --host 0.0.0.0 --port ${PREVIEW_PORT} >> /tmp/preview.log 2>&1`, { detach: true, workdir: '/work/app' });
        for (let i = 0; i < previewPoll.tries && !(await driver.previewReady(id)); i++) await new Promise((r) => setTimeout(r, previewPoll.ms));
        if (!(await driver.previewReady(id))) {
          const out = await driver.sh(id, 'tail -n 15 /tmp/preview.log').then((o) => o.stdout, () => '');
          return { error: 'The app did not start. Ask the assistant to fix it, and share this:', log: out };
        }
      }
      previewOk.set(id, Date.now());
      return { url: previewUrl(id, target) };
    } finally {
      previewing.delete(id);
    }
  }

  /** Caddy forward_auth: may this visitor see this preview host, and where is it? */
  async function previewCheck(req, res) {
    const fwd = String(req.headers['x-forwarded-host'] || '').toLowerCase().replace(/:\d+$/, '');
    const dom = config.previewDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = fwd.match(new RegExp(`^p-(${ID})\\.${dom}$`));
    if (!m) return page(res, 404, 'Not found', '<h2>There is no preview here.</h2>');
    const cookies = parseCookies(req.headers.cookie);
    const s = verify(cookies.ds_preview, config.sessionSecret, { scope: 'preview' });
    if (!s) {
      return page(res, 401, 'Sign in', `<h2>Sign in to see this preview</h2><p><a href="${esc(config.publicUrl)}/auth/login">Sign in with GitHub</a>, then open the preview again from Dev Studio.</p>`);
    }
    if (!(await access.stillAllowed(s, config.allowed))) {
      return page(res, 403, 'Paused', '<h2>Your access to Dev Studio is paused</h2><p>Ask your Ambivo contact.</p>');
    }
    const id = m[1];
    // Caddy asks on every request the preview makes: answer from memory when the project is known.
    const p = await store.get(id, { refresh: false });
    if (!p) return page(res, 404, 'Not found', '<h2>There is no preview here.</h2>');
    if (!owns({ id: String(s.uid) }, p)) return page(res, 403, 'Not yours', '<h2>This preview belongs to another account.</h2>');
    const fresh = Date.now() - (previewOk.get(id) ?? 0) < PREVIEW_FRESH_MS;
    if (!fresh) {
      if (!(await driver.previewReady(id).catch(() => false))) {
        previewOk.delete(id);
        // The app's /api calls go from Caddy to the Ambivo API and never reach the container, so a
        // tab left open on a stopped project can still sign in.
        const uri = String(req.headers['x-forwarded-uri'] || '');
        if (uri === '/api' || uri.startsWith('/api/')) {
          res.writeHead(200, { 'Cache-Control': 'no-store' });
          return res.end();
        }
        // Anything else starts the preview again (an idle project's container was stopped), and the
        // page reloads itself until it is up.
        // Every request of a starting page lands here; only the first one starts it, the rest are not news.
        if (!previewing.has(id)) startPreview(id).then((r) => r.error && log(`project ${id}: preview restart: ${r.error}`),
          (err) => log(`project ${id}: preview restart: ${err.message}`));
        return page(res, 503, 'Starting', `<h2>The preview is starting</h2><p>This page reloads by itself. It can take a minute.</p><p>If it does not start, open it again from <a href="${esc(config.publicUrl)}">Dev Studio</a>.</p>`, { Refresh: '5' });
      }
      previewOk.set(id, Date.now());
    }
    const target = await driver.previewTarget(id);
    touch(id);
    res.writeHead(200, { 'X-Preview-Upstream': target, 'Cache-Control': 'no-store' });
    return res.end();
  }

  // ---- sign-in (server mode) ----------------------------------------------------------------
  const redirectUri = () => `${config.publicUrl}/auth/callback`;

  function login(req, res) {
    const state = randomBytes(16).toString('base64url');
    const st = sign({ state, exp: Date.now() + 10 * 60 * 1000, scope: 'oauth' }, config.sessionSecret);
    res.writeHead(302, {
      Location: github.authorizeUrl(state, redirectUri()),
      'Set-Cookie': cookie('ds_oauth', st, { ...cookieBase, maxAge: 600, path: '/auth' }),
      'Cache-Control': 'no-store',
    });
    res.end();
  }

  async function callback(req, res, url) {
    const st = verify(parseCookies(req.headers.cookie).ds_oauth, config.sessionSecret, { scope: 'oauth' });
    const clearState = cookie('ds_oauth', '', { ...cookieBase, maxAge: 0, path: '/auth' });
    if (!st || !url.searchParams.get('state') || st.state !== url.searchParams.get('state') || !url.searchParams.get('code')) {
      return page(res, 400, 'Sign-in failed', `<h2>Sign-in did not finish</h2><p><a href="/auth/login">Try again</a>.</p>`, { 'Set-Cookie': clearState });
    }
    let who, tok;
    try {
      tok = await github.exchangeCode(url.searchParams.get('code'), redirectUri());
      who = await github.whoami(tok.token);
    } catch (err) {
      log(`sign-in: ${err.message}`);
      return page(res, 502, 'Sign-in failed', `<h2>GitHub sign-in did not work</h2><p><a href="/auth/login">Try again</a>.</p>`, { 'Set-Cookie': clearState });
    }
    const decision = await access.decide(who, config.allowed);
    if (!decision.ok) {
      log(`sign-in refused: ${who.login}${decision.paused ? ' (paused)' : ''}`);
      const why = decision.paused ? 'Your access to Dev Studio is paused. Ask your Ambivo contact.' : 'Ask your Ambivo contact to add your account or your organisation.';
      return page(res, 403, 'Not allowed', `<h2>Your GitHub account cannot use Dev Studio yet</h2><p>You signed in as ${esc(who.login)}. ${esc(why)}</p>`, { 'Set-Cookie': clearState });
    }
    const sid = randomBytes(16).toString('base64url');
    const ttl = config.sessionHours * 3600;
    const exp = Date.now() + ttl * 1000;
    const tokenExp = Date.now() + Math.min(ttl, tok.expiresIn || ttl) * 1000;
    // Without it the partner is still signed in; a push then asks them to sign in again.
    try { await ghTokens.save(sid, JSON.stringify({ token: tok.token, exp: tokenExp }), { exp: tokenExp }); }
    catch (err) { log(`github token store: ${err.message}`); }
    const iat = Date.now();
    // `via` = what let them in (an Access entry, or the floor list), checked again on every request.
    // gid/gname: the account (the user, or one of their orgs) that matched; it must still match later.
    const by = { via: decision.via, gid: decision.gid, gname: decision.gname };
    const app = sign({ sid, uid: who.id, login: who.login, ...by, exp, iat, scope: 'app' }, config.sessionSecret);
    // The preview cookie reaches p-<id>.<domain>. It opens previews only; it cannot call the API.
    const prev = sign({ uid: who.id, login: who.login, ...by, exp, iat, scope: 'preview' }, config.sessionSecret);
    log(`signed in: ${who.login}`);
    res.writeHead(302, {
      Location: '/', 'Cache-Control': 'no-store',
      'Set-Cookie': [
        cookie(SESSION, app, { ...cookieBase, maxAge: ttl }),
        cookie('ds_preview', prev, { ...cookieBase, maxAge: ttl, domain: config.previewDomain }),
        clearState,
      ],
    });
    res.end();
  }

  async function logout(req, res) {
    const u = currentUser(req);
    if (u?.sid) await ghTokens.remove(u.sid).catch((err) => log(`github token store: ${err.message}`));
    res.writeHead(200, {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Set-Cookie': [
        cookie(SESSION, '', { ...cookieBase, maxAge: 0 }),
        cookie('ds_preview', '', { ...cookieBase, maxAge: 0, domain: config.previewDomain }),
      ],
    });
    res.end(JSON.stringify({ ok: true }));
  }

  // ---- GitHub push --------------------------------------------------------------------------
  /** The session's GitHub user token, or null. Read from the store each time; an expired one is deleted. */
  async function userToken(user) {
    if (!user?.sid || !ghTokens) return null;
    const meta = await ghTokens.info(user.sid);
    if (!meta) return null;
    if (!(meta.exp > Date.now())) { await ghTokens.remove(user.sid); return null; }
    let t;
    try { t = JSON.parse(await ghTokens.get(user.sid)); }
    catch (err) { log(`github token store: ${err.message}`); return null; }
    if (!t?.token || !(t.exp > Date.now())) return null;
    return t.token;
  }

  // ---- GitHub on the maker's computer ------------------------------------------------------------
  // The dev container's own GitHub sign-in (ambivo-start github, kept by gh): Dev Studio pushes with the
  // maker's token, to repositories they may push to. Hosted Dev Studio uses its GitHub App instead.
  const GITHUB_SIGN_IN = 'docker run -it --rm -v ambivo-devkit-home:/home/node/.claude sgosain/ambivo-devkit github';
  const localGitHub = driver.kind === 'local'
    ? createGitHub({ api: 'https://api.github.com', web: 'https://github.com', browserWeb: 'https://github.com' }, fetchImpl) : null;
  const ghCache = { at: 0, token: null };
  /** The maker's GitHub token from gh, or null. Read at most every 30 seconds. */
  function ghToken() {
    if (!localGitHub) return Promise.resolve(null);
    if (Date.now() - ghCache.at < 30_000) return Promise.resolve(ghCache.token);
    return new Promise((resolve) => {
      execFile(config.ghCommand || 'gh', ['auth', 'token', '--hostname', 'github.com'], { timeout: 10_000 }, (err, stdout) => {
        ghCache.at = Date.now();
        ghCache.token = !err && String(stdout).trim() ? String(stdout).trim() : null;
        resolve(ghCache.token);
      });
    });
  }
  const canPush = async () => !!(serverMode && github) || !!(await ghToken());

  async function push(p, user, fullName) {
    let token, repo, local = false;
    if (serverMode) {
      token = await userToken(user);
      if (!token) return [401, { error: 'Sign in again to push to GitHub.', signIn: true }];
      const repos = await github.listRepos(token);
      repo = repos.find((r) => r.fullName.toLowerCase() === String(fullName || '').toLowerCase());
      if (!repo) return [400, { error: 'Dev Studio cannot reach that repository. Install the Dev Studio app on it first.' }];
    } else {
      token = await ghToken();
      if (!token) return [401, { error: `Sign in to GitHub first. Run this in a terminal on your computer: ${GITHUB_SIGN_IN}` }];
      const repos = await localGitHub.listUserRepos(token);
      repo = repos.find((r) => r.fullName.toLowerCase() === String(fullName || '').toLowerCase());
      if (!repo) return [400, { error: 'Your GitHub account cannot push to that repository.' }];
      local = true;
    }
    await prepare(p.id);
    const child = driver.exportTar(p.id);
    let errText = '';
    child.stderr?.on('data', (c) => { errText += c; });
    const tar = await readAll(child.stdout, 60 << 20);
    const files = parseTar(tar);
    if (!files.length) return [409, { error: 'There are no files to push yet.' + (errText ? ` ${errText.slice(-200)}` : '') }];
    const hits = findSecrets(files);
    if (hits.length) {
      return [409, { error: 'Some files look like they hold a secret, such as a key or a password. Ask the assistant to remove it, then push again.', files: hits.slice(0, 20) }];
    }
    const pushToken = local ? token : await github.installationToken(repo.installationId, repo.id);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
    const out = await (local ? localGitHub : github).pushFiles(pushToken, repo.fullName, files, {
      branch: `devstudio/${slug}-${stamp}`, message: `Ambivo app: ${p.name} (from Dev Studio)`,
    });
    log(`pushed ${p.id} to ${repo.fullName} ${out.branch} (${files.length} files)`);
    emit(p.id, { kind: 'status', text: `Pushed ${files.length} files to GitHub: ${out.url}` });
    return [200, { ...out, files: files.length }];
  }

  // ---- share link ---------------------------------------------------------------------------
  // A production build of the app, public: anyone with the link opens it and signs in with their own
  // Ambivo account. Dev Studio's sign-in is not needed and its cookies never reach the Ambivo API.
  function shareUrl(id) {
    if (!serverMode) return `http://s-${id}.localhost:${config.port}/`;
    const u = new URL(config.publicUrl);
    return `${u.protocol}//s-${id}.${config.previewDomain}${u.port ? `:${u.port}` : ''}/`;
  }

  /**
   * What the page shows about a project's link. `missing`: shared, but this host has no files for it.
   * A missing one is put back from the object store first, when a copy is there.
   */
  async function shareState(p) {
    if (!p.share?.on) return p.share ? { on: false, at: p.share.at } : { on: false };
    if (!share.exists(p.id)) await share.restore(p.id).catch((err) => log(`share ${p.id}: restoring: ${err.message}`));
    return { ...p.share, url: shareUrl(p.id), ...(share.exists(p.id) ? {} : { missing: true }) };
  }

  /**
   * On start: put back every share link that is on but has no files on this host, from its copy in
   * the object store. One at a time. Returns how many came back; failures are logged.
   */
  async function restoreShares() {
    let n = 0;
    for (const p of await store.listAll()) {
      if (!p?.share?.on || share.exists(p.id)) continue;
      try { if ((await share.restore(p.id)) === 'restored') n++; }
      catch (err) { log(`share ${p.id}: restoring: ${err.message}`); }
    }
    return n;
  }

  const sharing = new Set();
  async function makeShare(id) {
    if (sharing.has(id)) return [409, { error: 'The app is already being built for sharing. Wait for it to finish.' }];
    sharing.add(id);
    try {
      await prepare(id);
      emit(id, { kind: 'note', text: 'Building the app for sharing…' });
      const built = await share.build(id);
      share.publish(id, built);
      // A copy in the object store, so a restart or another server can put the link back.
      await share.save(id, built).catch((err) => log(`share ${id}: saving the build: ${err.message}`));
      const at = Date.now();
      await update(id, (rec) => { rec.share = { on: true, at }; });
      const url = shareUrl(id);
      emit(id, { kind: 'note', text: `Shared. Anyone with the link can open the app: ${url}` });
      return [200, { on: true, at, url, files: built.length }];
    } catch (err) {
      if (!(err instanceof ShareError)) throw err;
      emit(id, { kind: 'error', text: err.message });
      return [409, { error: err.message, ...(err.log ? { log: err.log } : {}) }];
    } finally {
      sharing.delete(id);
    }
  }

  async function stopShare(id) {
    await share.remove(id);
    const at = Date.now();
    await update(id, (rec) => { rec.share = { on: false, at }; });
    emit(id, { kind: 'note', text: 'The share link is off.' });
    return { on: false, at };
  }

  // ---- the client's brief -------------------------------------------------------------------
  /**
   * Put a checked brief file in the project's container (/work/brief), with a text copy for DOCX (made
   * here) and PDF (pdftotext in the container, best effort). Returns the entry for the record.
   */
  async function storeBrief(id, info, buf) {
    const at = Date.now();
    let text = null;
    if (info.type === 'docx') {
      const t = docxText(buf);   // a damaged file throws BriefError before anything is written
      await driver.writeFile(id, `${BRIEF_DIR}/${info.name}`, buf);
      await driver.writeFile(id, `${BRIEF_DIR}/${info.name}.txt`, Buffer.from(t));
      text = `${info.name}.txt`;
    } else {
      await driver.writeFile(id, `${BRIEF_DIR}/${info.name}`, buf);
      if (info.type === 'pdf') {
        try {
          await driver.sh(id, `pdftotext -layout '${BRIEF_DIR}/${info.name}' '${BRIEF_DIR}/${info.name}.txt'`);
          text = `${info.name}.txt`;
        } catch (err) { log(`project ${id}: pdftotext: ${String(err.message).slice(0, 200)}`); }
      }
    }
    return { name: info.name, type: info.type, size: info.size, at, ...(text ? { text } : {}) };
  }

  async function addBrief(id, rawName, buf) {
    const info = checkBrief(rawName, buf, projects[id]?.brief ?? []);
    await prepare(id);
    const entry = await storeBrief(id, info, buf);
    await update(id, (rec) => { rec.brief = [...(rec.brief ?? []).filter((b) => b.name !== entry.name), entry]; });
    emit(id, { kind: 'note', text: `Brief saved: ${entry.name} (${Math.max(1, Math.round(entry.size / 1024))} KB). The assistant reads it from /work/brief.` });
    emit(id, { kind: 'phases' });
    if (files) files.save(id).catch((err) => log(`project ${id}: saving files: ${err.message}`));
    return entry;
  }

  // ---- phases -------------------------------------------------------------------------------
  const phasesOut = (p) => ({ ...phasesView(p.phases, p.phasesError), brief: p.brief ?? [] });

  async function startPhase(p, phaseId) {
    const why = cannotStart(p.phases, phaseId);
    if (why) return [409, { error: why }];
    const at = Date.now();
    await update(p.id, (rec) => {
      const ph = findPhase(rec.phases, phaseId);
      ph.status = 'working'; ph.started = at;
      delete ph.session; delete ph.codexThread; delete ph.codexUsage;
      rec.phases.active = phaseId;
    });
    const fresh = projects[p.id];
    const ph = findPhase(fresh.phases, phaseId);
    emit(p.id, { kind: 'user', text: `Start phase: ${ph.title}` });
    turn(p.id, openingPrompt(fresh.phases, phaseId, { codex: isCodex(fresh) }));
    return [202, phasesOut(projects[p.id])];
  }

  async function approvePhase(p, phaseId) {
    const ph = findPhase(p.phases, phaseId);
    if (!ph || p.phases.active !== phaseId) return [409, { error: 'Only the phase in progress can be approved.' }];
    await prepare(p.id); // the files are read in the container, which may have been stopped while idle
    const done = await phaseDone(p.id, phaseId);
    if (!done.done) {
      return [409, { error: phaseId === PHASE0.id
        ? (done.error || 'The assistant has not written docs/APP_BRIEF.md, docs/DATA_MODEL.md and docs/PHASES.md yet. Ask it to finish phase 0.')
        : `The assistant has not written the handoff note docs/phases/${phaseId}.md yet. Ask it to finish the phase.` }];
    }
    await update(p.id, (rec) => {
      if (done.parsed) mergePhases(rec.phases, done.parsed);
      rec.phasesError = null;
      const x = findPhase(rec.phases, phaseId);
      x.status = 'approved'; x.approved = Date.now();
      rec.phases.active = null;
    });
    emit(p.id, { kind: 'note', text: `Phase approved: ${ph.title}.`, phase: phaseId });
    emit(p.id, { kind: 'phases', phase: phaseId });
    if (files) files.save(p.id).catch((err) => log(`project ${p.id}: saving files: ${err.message}`));
    return [200, phasesOut(projects[p.id])];
  }

  async function reopenPhase(p, phaseId) {
    const ph = findPhase(p.phases, phaseId);
    if (!ph || ph.dropped) return [404, { error: 'There is no such phase in the plan.' }];
    if (ph.status !== 'approved') return [409, { error: 'Only an approved phase can be reopened.' }];
    if (p.phases.active) return [409, { error: `Finish the phase "${findPhase(p.phases, p.phases.active)?.title}" first: approve it, then reopen this one.` }];
    await update(p.id, (rec) => {
      const x = findPhase(rec.phases, phaseId);
      x.status = 'working'; delete x.approved;
      rec.phases.active = phaseId;
    });
    emit(p.id, { kind: 'note', text: `Phase reopened: ${ph.title}. Your next message continues its conversation.` });
    emit(p.id, { kind: 'phases' });
    return [200, phasesOut(projects[p.id])];
  }

  // ---- jobs: the app's scheduled jobs (appjobs.mjs) -----------------------------------------------
  /**
   * The Jobs dialog. GET: the project's app-jobs.json and the app's objects, and the jobs as they run in
   * the maker's sandbox. PUT: save the file. POST ?action=install|enable|run|secret|runs: Core's
   * /app_job routes, as the maker, in their sandbox only. Answers [status, body].
   */
  async function jobsRoute(id, p, req, url) {
    const action = url.searchParams.get('action') || '';
    const signInText = serverMode
      ? 'Sign in to your Ambivo sandbox first, with the button on the left.'
      : `Sign in to Ambivo on this computer first. Run this in a terminal: ${config.loginCommand || LOGIN_COMMAND}`;
    const session = async () => {
      const amb = await ambivoEnv(id, p);
      if (!amb || amb === 'ended') return null;
      const apiUrl = amb.AMBIVO_API_URL || (!serverMode ? localAmbivoSession()?.apiUrl : null) || config.ambivoApi;
      return { fetchImpl, apiUrl, token: amb.AMBIVO_TOKEN };
    };
    const fail = (r) => [r.status, { error: r.error, code: r.code || undefined, ...(r.signIn ? { ambivoSignIn: true } : {}) }];
    await prepare(id);
    const objectsText = await readText(id, OBJECTS_FILE);
    const { appKey, objects } = objectsText ? objectsForJobs(objectsText) : { appKey: '', objects: [] };

    if (req.method === 'GET' && !action) {
      const text = await readText(id, JOBS_FILE);
      let doc = null, fileError = null;
      if (text !== null) { try { doc = JSON.parse(text); } catch (err) { fileError = `src/install/app-jobs.json is not valid JSON: ${err.message}`; } }
      const out = { appKey, objects, doc, fileError, hasObjects: objectsText !== null, live: null, liveError: null, signIn: false };
      const s = await session();
      if (!s) return [200, { ...out, signIn: true, liveError: signInText }];
      if (!appKey) return [200, out];
      const match = encodeURIComponent(JSON.stringify({ app_key: appKey }));
      const [jobs, runs, secrets] = await Promise.all([
        coreCall(s, 'GET', `app_job/list?page_size=50&match_filter_dict=${match}`),
        coreCall(s, 'GET', 'app_job/run/list?page_size=100'),
        coreCall(s, 'GET', `app_job/secret/list?app_key=${encodeURIComponent(appKey)}`),
      ]);
      if (!jobs.ok) return [200, { ...out, liveError: jobs.error, signIn: !!jobs.signIn }];
      out.live = {
        jobs: jobs.body.data_list || [],
        // Runs of this app's jobs only, newest first.
        runs: runs.ok ? (runs.body.data_list || []).filter((r) => r.app_key === appKey).slice(0, 50) : [],
        secrets: secrets.ok ? (secrets.body.data_list || []).map((x) => ({ name: x.name, host: x.host, updated_at: x.updated_at })) : [],
      };
      return [200, out];
    }
    if (req.method === 'PUT' && !action) {
      if (busy.has(id)) return [409, { error: 'The assistant is working. Save the jobs when it finishes.' }];
      if (objectsText === null) return [409, { error: 'The app has no custom objects yet (src/install/app-objects.json). Jobs work on the app\'s own objects. Ask the assistant to add them first.' }];
      let text;
      try { text = cleanJobsDoc((await readBody(req, 300000)).doc, appKey); }
      catch (err) { if (err instanceof JobsError) return [err.status, { error: err.message }]; throw err; }
      await driver.writeFile(id, JOBS_FILE, Buffer.from(text));
      log(`project ${id}: jobs file saved from the Jobs dialog`);
      emit(id, { kind: 'note', text: 'Jobs saved in src/install/app-jobs.json.' });
      // The rules check, from the plugin (the app's own copy may be older). Only the install folder's lines.
      const r = await runIn(id, ['node', `${PLUGIN}/scripts/ambivo-check.mjs`, '/work/app'], {}, { timeoutMs: 60000 });
      const lines = `${r.out}\n${r.err}`.split('\n').filter((l) => /src\/install\//.test(l)).map((l) => l.replace(/^ERROR /, '')).slice(0, 40);
      return [200, { saved: true, problems: lines }];
    }
    if (req.method !== 'POST') return [405, { error: 'Not allowed' }];
    const body = await readBody(req);
    const s = await session();
    if (!s) return [409, { error: signInText, ambivoSignIn: true }];
    if (action === 'install') {
      // The same call install.mjs makes after the objects: the whole list, into the sandbox.
      if (!appKey) return [409, { error: 'The app has no custom objects yet (src/install/app-objects.json).' }];
      let doc;
      try { doc = JSON.parse(await readText(id, JOBS_FILE) ?? 'null'); } catch { doc = null; }
      if (!doc || !Array.isArray(doc.jobs)) return [409, { error: 'There is no valid src/install/app-jobs.json to send.' }];
      const r = await coreCall(s, 'PUT', `app_job/app/${encodeURIComponent(appKey)}`, { jobs: jobsForCore(doc) });
      if (!r.ok) return fail(r);
      log(`project ${id}: ${(r.body.data_list || []).length} jobs sent to the sandbox`);
      return [200, { jobs: r.body.data_list || [], signingSecrets: r.body.signing_secrets || {} }];
    }
    if (action === 'secret') {
      const name = String(body.name || ''), host = String(body.host || '').trim().toLowerCase();
      const problem = secretProblem(name, body.value, host);
      if (problem) return [400, { error: problem }];
      if (!appKey) return [409, { error: 'The app has no custom objects yet (src/install/app-objects.json).' }];
      // The value goes to Ambivo only. It is never logged or kept here.
      const r = await coreCall(s, 'PUT', `app_job/secret/${encodeURIComponent(appKey)}/${encodeURIComponent(name)}`, { value: body.value, host });
      if (!r.ok) return fail(r);
      log(`project ${id}: sandbox secret ${name} set for ${host}`);
      return [200, { set: name, host }];
    }
    const job = String(url.searchParams.get('job') || '');
    if (!JOB_ID.test(job)) return [404, { error: 'No such job.' }];
    let r;
    if (action === 'enable') r = await coreCall(s, 'PATCH', `app_job/${job}`, { enabled: body.enabled === true });
    else if (action === 'run') r = await coreCall(s, 'POST', `app_job/${job}/run`, {});
    else if (action === 'runs') r = await coreCall(s, 'GET', `app_job/run/list?page_size=20&match_filter_dict=${encodeURIComponent(JSON.stringify({ job_id: job }))}`);
    else return [404, { error: 'Not found' }];
    if (!r.ok) return fail(r);
    return [200, action === 'runs' ? { runs: r.body.data_list || [] } : { ok: true, job: r.body.app_job || null }];
  }

  // ---- deploy: a one-time link for a client's admin (deploy.mjs) ---------------------------------
  const deploy = serverMode && deploySessions && deployPending ? createDeploy({
    stateObjects, sessions: deploySessions, pending: deployPending, config, fetchImpl, log,
    app: {
      getProject: (pid) => store.get(pid, { refresh: true }),
      runIn, prepare,
      sh: (pid, cmd) => driver.sh(pid, cmd, { workdir: '/work' }),
      isBusy: (pid) => busy.has(pid),
      setBusy: (pid, on) => { if (on) busy.add(pid); else { busy.delete(pid); touch(pid); } },
      update, emit, publicUrl: publicOrigin,
    },
  }) : null;
  const DEPLOY_ROUTE = /^\/deploy\/([A-Za-z0-9_-]{43})(?:\/(info|sign-in|verify|install|cancel))?$/;

  // ---- requests -----------------------------------------------------------------------------
  const ROUTE = new RegExp(`^/api/projects(?:/(${ID}))?(?:/(events|messages|download|keys|preview|push|share|brief|phases|datamodel|settings|guide|teardown|deploy|jobs))?(?:/([a-z][a-z0-9-]{0,39})/(start|approve|reopen|screens))?$`);

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      // Laptop mode: a share link is http://s-<id>.localhost:<port>/ (browsers send *.localhost here).
      if (!serverMode) {
        const sh = String(req.headers.host || '').toLowerCase().match(new RegExp(`^s-(${ID})\\.localhost(?::\\d+)?$`));
        if (sh) return await share.serve(req, res, sh[1], url, { on: !!projects[sh[1]]?.share?.on });
      }
      // Laptop mode has no sign-in, and a run can do anything in the project: refuse other sites and rebound hosts.
      if (!serverMode && !localRequestAllowed(req)) return json(res, 403, { error: 'Open Dev Studio at http://localhost.' });
      // ...and anything that does not come from this machine's own loopback needs the secret in Dev Studio's link.
      if (!serverMode && !isLoopback(req.socket?.remoteAddress)) {
        const given = url.searchParams.get('token');
        if (req.method === 'GET' && given !== null && sameSecret(given, accessToken)) {
          url.searchParams.delete('token');
          res.writeHead(302, {
            Location: url.pathname + url.search, 'Cache-Control': 'no-store',
            'Set-Cookie': cookie(ACCESS_COOKIE, accessToken, { secure: false, sameSite: 'Lax', maxAge: 365 * 24 * 3600 }),
          });
          return res.end();
        }
        if (!sameSecret(parseCookies(req.headers.cookie)[ACCESS_COOKIE], accessToken)) {
          if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'Open Dev Studio with its link. Run docker logs ambivo-devkit to see it.' });
          return page(res, 401, 'Open Dev Studio with its link',
            '<h2>Open Dev Studio with its link</h2><p>The first time, open Dev Studio with the link it printed when it started. '
            + 'Your browser remembers it after that.</p><p>To see the link, run this in a terminal on your computer:</p>'
            + '<pre>docker logs ambivo-devkit</pre><p>Open the line that starts with http://localhost:4300/?token=</p>');
        }
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        // no-store: the page changes often, and a cached copy hides fixes.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
        return res.end(readFileSync(join(HERE, 'public', 'index.html')));
      }
      if (url.pathname === '/healthz') return json(res, 200, { ok: true });

      if (serverMode) {
        // Changes must come from the Dev Studio page itself (no cross-site form posts).
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== publicOrigin) {
          return json(res, 403, { error: 'This request did not come from the Dev Studio page.' });
        }
        if (req.method === 'GET' && url.pathname === '/auth/login') return login(req, res);
        if (req.method === 'GET' && url.pathname === '/auth/callback') return await callback(req, res, url);
        if (req.method === 'POST' && url.pathname === '/auth/logout') return await logout(req, res);
        if (req.method === 'GET' && url.pathname === '/auth/preview-check') return await previewCheck(req, res);
      }
      // A client admin's deploy page and its calls. No Dev Studio sign-in: the link is the key.
      const dm = deploy && url.pathname.match(DEPLOY_ROUTE);
      if (dm) {
        const [, secret, act] = dm;
        if (!act && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer' });
          return res.end(readFileSync(join(HERE, 'public', 'deploy.html')));
        }
        let out;
        if (act === 'info' && req.method === 'GET') out = await deploy.info(secret);
        else if (act === 'sign-in' && req.method === 'POST') out = await deploy.signIn(secret, await readBody(req));
        else if (act === 'verify' && req.method === 'POST') out = await deploy.verify(secret, await readBody(req));
        else if (act === 'install' && req.method === 'POST') out = await deploy.install(secret, await readBody(req));
        else if (act === 'cancel' && req.method === 'POST') out = await deploy.cancel(secret);
        else out = [405, { error: 'Not allowed' }];
        res.setHeader('Referrer-Policy', 'no-referrer');
        return json(res, out[0], out[1]);
      }
      if (!url.pathname.startsWith('/api/')) {
        // A browser sent to a page that does not exist (a stray link, a GitHub redirect with a typo)
        // goes to the start page. Programs and /auth/* still get a plain 404.
        if (req.method === 'GET' && !url.pathname.startsWith('/auth/') && String(req.headers.accept || '').includes('text/html')) {
          res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
          return res.end();
        }
        return json(res, 404, { error: 'Not found' });
      }

      const user = currentUser(req);
      if (!user) return json(res, 401, { error: 'Sign in to continue.', signIn: true, sessionEnded: true });
      if (serverMode && !(await access.stillAllowed(user.signed, config.allowed))) {
        return json(res, 401, { error: 'Your access to Dev Studio is paused. Ask your Ambivo contact.', signIn: true, sessionEnded: true, paused: true });
      }
      renewSession(res, user);

      if (req.method === 'GET' && url.pathname === '/api/me') {
        return json(res, 200, {
          mode: serverMode ? 'server' : 'laptop', login: serverMode ? user.login : null, admin: serverMode && isAdmin(user),
          local: driver.kind === 'local', projectsRoot: driver.kind === 'local' ? driver.root : undefined,
          claudeSignedIn: ownLogin(),
          ...(driver.kind === 'local' && config.checks ? { setup: { ...(setup || {}), checking: !!setupRun } } : {}),
          keyed: await keys.has(user.id), openaiKeyed: await openai.has(user.id), canPush: await canPush(), installUrl: github?.installUrl || null,
          ...(serverMode && ambivoSessions ? { ambivo: await ambivoStatus(user.id) } : {}),
        });
      }
      if (url.pathname === '/api/status') {
        if (driver.kind !== 'local' || !config.checks) return json(res, 404, { error: 'Not found' });
        if (req.method === 'POST') await checkSetup();
        else if (req.method !== 'GET') return json(res, 405, { error: 'Not allowed' });
        return json(res, 200, { ...(setup || {}), checking: !!setupRun });
      }
      if (url.pathname === '/api/access' || url.pathname.startsWith('/api/access/')) {
        // Dev Studio admins only (DEVSTUDIO_ADMINS); to anyone else the page does not exist.
        if (!serverMode || !isAdmin(user)) return json(res, 404, { error: 'Not found' });
        const entryId = url.pathname.split('/')[3] || null;
        try {
          if (!entryId && req.method === 'GET') {
            // A person's work email (Partner Program entries) stays on the server: only the access emails use it.
            return json(res, 200, { entries: (await access.list({ fresh: true })).map(({ email, ...e }) => e), floor: config.allowed, admins: config.admins,
              ...(partnerSource ? { managedBy: { name: PARTNERPROG_NAME, url: config.partnerProg?.url || undefined, ...partnerSource.status() } } : {}) });
          }
          if (!entryId && req.method === 'POST') { const e = await access.add(await readBody(req), user.login, { token: await userToken(user) }); log(`access: ${user.login} added ${e.github} (${e.partner})`); return json(res, 201, { entry: e }); }
          if (entryId && req.method === 'PATCH') { const e = await access.update(entryId, await readBody(req), user.login, { token: await userToken(user) }); log(`access: ${user.login} set ${e.github} ${e.status}`); return json(res, 200, { entry: e }); }
          if (entryId && req.method === 'DELETE') { await access.remove(entryId); log(`access: ${user.login} removed ${entryId}`); return json(res, 200, { removed: entryId }); }
          return json(res, 405, { error: 'Not allowed' });
        } catch (err) {
          if (err instanceof AccessError) return json(res, err.status, { error: err.message });
          throw err;
        }
      }
      if (url.pathname === '/api/ambivo' || url.pathname.startsWith('/api/ambivo/')) {
        if (!serverMode || !ambivoSessions) return json(res, 404, { error: 'Not found' });
        if (req.method === 'POST' && url.pathname === '/api/ambivo/sign-in') {
          const [code, out] = await ambivoSignIn(user, await readBody(req));
          return json(res, code, out);
        }
        if (req.method === 'POST' && url.pathname === '/api/ambivo/verify') {
          const [code, out] = await ambivoVerify(user, await readBody(req));
          return json(res, code, out);
        }
        if (req.method === 'DELETE' && url.pathname === '/api/ambivo') return json(res, 200, { signedOut: await ambivoForget(user) });
        if (req.method === 'GET' && url.pathname === '/api/ambivo') return json(res, 200, await ambivoStatus(user.id));
        return json(res, 405, { error: 'Not allowed' });
      }
      if (url.pathname === '/api/key') {
        // One key per provider: Claude (default) or OpenAI (?provider=openai, or "provider" in the body).
        if (req.method === 'POST') {
          const body = await readBody(req);
          const provider = (body.provider || url.searchParams.get('provider')) === 'openai' ? 'openai' : 'claude';
          const problem = await saveKey(user, provider, keyFrom(provider, body));
          if (problem) return json(res, 400, { error: problem });
          return json(res, 200, { ok: true, provider });
        }
        if (req.method === 'DELETE') {
          const provider = url.searchParams.get('provider') === 'openai' ? 'openai' : 'claude';
          return json(res, 200, { deleted: await (provider === 'openai' ? openai : keys).remove(user.id), provider });
        }
        return json(res, 405, { error: 'Not allowed' });
      }
      if (req.method === 'GET' && url.pathname === '/api/ambivo-sign-in') {
        if (serverMode) return json(res, 200, { signedIn: false, server: true });
        const s = localAmbivoSession();
        return json(res, 200, s
          ? { signedIn: true, email: s.email, until: s.expiresAt ? s.expiresAt * 1000 : undefined, command: config.loginCommand || LOGIN_COMMAND }
          : { signedIn: false, command: config.loginCommand || LOGIN_COMMAND });
      }
      if (req.method === 'GET' && url.pathname === '/api/github/repos' && localGitHub) {
        const token = await ghToken();
        if (!token) return json(res, 401, { error: `Sign in to GitHub first. Run this in a terminal on your computer: ${GITHUB_SIGN_IN}` });
        return json(res, 200, { repos: await localGitHub.listUserRepos(token), installUrl: null, local: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/github/repos') {
        if (!serverMode || !github) return json(res, 404, { error: 'Not found' });
        const token = await userToken(user);
        if (!token) return json(res, 401, { error: 'Sign in again to push to GitHub.', signIn: true });
        return json(res, 200, { repos: await github.listRepos(token), installUrl: github.installUrl });
      }

      const m = url.pathname.match(ROUTE);
      if (!m) return json(res, 404, { error: 'Not found' });
      const [, id, sub, phaseId, phaseAction] = m;
      if (phaseId && sub !== 'phases') return json(res, 404, { error: 'Not found' });

      if (!id && req.method === 'GET') {
        // Every project listed is the user's own (or, in laptop mode, the one user's), so one key check per provider covers them.
        const mine = (await store.list(user.id)).filter((p) => owns(user, p));
        const has = {
          claude: mine.some((p) => !isCodex(p)) && ((await keys.has(user.id)) || ownLogin()),
          openai: mine.some(isCodex) && await openai.has(user.id),
        };
        return json(res, 200, mine.map(({ events, ...p }) => ({ ...p, busy: busy.has(p.id), keyed: owns(user, p) && has[providerOf(p)] })));
      }
      if (!id && req.method === 'POST') {
        // Room for a 10 MB brief file, sent as base64 in the JSON body.
        const body = await readBody(req, Math.ceil(BRIEF_MAX * 4 / 3) + 200000);
        const name = String(body.name || '').trim().slice(0, 60);
        const description = String(body.description || '').trim().slice(0, 4000);
        // A brief file can stand in for the description.
        let brief = null;
        if (body.brief) {
          const buf = Buffer.from(String(body.brief.data || ''), 'base64');
          brief = { info: checkBrief(body.brief.name, buf), buf };
        }
        if (!name || (!description && !brief)) return json(res, 400, { error: 'Give the app a name and describe what it should do.' });
        const assistant = body.assistant === 'codex' ? 'codex' : 'claude';
        if (assistant === 'codex' && driver.kind === 'local') return json(res, 400, { error: 'Codex works in the hosted Dev Studio only. Choose Claude Code.' });
        if (notReady()) return json(res, 409, { error: notReady(), notReady: true });
        const provider = assistant === 'codex' ? 'openai' : 'claude';
        if (keyFrom(provider, body)) {
          const problem = await saveKey(user, provider, keyFrom(provider, body));
          if (problem) return json(res, 400, { error: problem });
        } else if (!(await (provider === 'openai' ? openai : keys).has(user.id)) && !(provider === 'claude' && ownLogin())) {
          return json(res, 400, { error: `Enter your ${KEY_NAME[provider]}.`, needKey: true, provider });
        }
        const newId = randomBytes(6).toString('hex');
        // With a brief file the app is built in phases, and this first conversation is phase 0.
        await store.create({ id: newId, name, created: Date.now(), owner: { id: user.id, login: user.login }, ...(assistant === 'codex' ? { assistant } : {}),
          ...(brief ? { phases: newPhases('working') } : {}) });
        // A token typed in for a project is laptop-only. On the server the stored, sandbox-checked
        // session is the only way in, so a page cannot hand the assistant another company's token.
        if (body.ambivoToken && !serverMode) ambivoTokens.set(newId, String(body.ambivoToken));
        emit(newId, { kind: 'user', text: description || `Build the app in the brief: ${brief.info.name}` });
        emit(newId, { kind: 'status', text: 'Setting up the project…' });
        (async () => {
          await driver.create(newId, config.image, { name });
          let briefs = [];
          if (brief) {
            const entry = await storeBrief(newId, brief.info, brief.buf);
            await update(newId, (rec) => { rec.brief = [entry]; });
            emit(newId, { kind: 'note', text: `Brief saved: ${entry.name} (${Math.max(1, Math.round(entry.size / 1024))} KB).` });
            emit(newId, { kind: 'phases' }); // the page drew the panel before the brief was stored
            briefs = [entry];
          }
          const codex = assistant === 'codex';
          await turn(newId, brief ? phase0Prompt({ description, briefs, codex })
            : codex ? codexNewAppPrompt(description)
            : 'Start a new app with the ambivo-new-app skill from the ambivo-devkit plugin. ' +
            'You are talking to a partner through a web page, not a terminal: ask your questions in plain words, ' +
            'a few at a time, then stop and wait for the answers. Create the project in /work/app.\n\n' +
            `The partner's description:\n${description}`);
        })().catch((err) => { emit(newId, { kind: 'error', text: `Could not start the project: ${err.message}` }); emit(newId, { kind: 'idle' }); });
        return json(res, 201, { id: newId });
      }
      // Read fresh, so a project changed on another server shows its latest state. While this server
      // runs the project's message, its memory is the latest, and only the record is checked.
      const p = id && await store.get(id, { refresh: !busy.has(id) });
      // Someone else's project answers exactly like a missing one.
      if (!p || !owns(user, p)) return json(res, 404, { error: 'No such project' });

      if (!sub && req.method === 'GET') {
        const { phases, phasesError, ...rest } = p;
        return json(res, 200, { ...rest, assistant: isCodex(p) ? 'codex' : 'claude', busy: busy.has(id), keyed: await keyed(p), share: await shareState(p), phases: phasesOut(p) });
      }
      if (sub === 'share' && driver.kind === 'local') return json(res, 404, { error: 'Share links work in the hosted Dev Studio only.' });
      if (sub === 'share' && req.method === 'POST') {
        if (busy.has(id)) return json(res, 409, { error: 'The assistant is working. Share the app when it finishes.' });
        const [code, out] = await makeShare(id);
        return json(res, code, out);
      }
      if (sub === 'share' && req.method === 'DELETE') return json(res, 200, await stopShare(id));
      if (sub === 'deploy') {
        if (!deploy) return json(res, 404, { error: 'Deploy works in the hosted Dev Studio only.' });
        if (req.method === 'GET') return json(res, 200, deploy.status(p));
        if (req.method === 'POST') { const [code, out] = await deploy.mint(p, user); return json(res, code, out); }
        if (req.method === 'DELETE') { const [code, out] = await deploy.revoke(p, String(url.searchParams.get('link') || '')); return json(res, code, out); }
        return json(res, 405, { error: 'Not allowed' });
      }
      if (sub === 'jobs') { const [code, out] = await jobsRoute(id, p, req, url); return json(res, code, out); }
      if (sub === 'teardown' && (req.method === 'GET' || req.method === 'POST')) {
        // What the app made in the partner's Ambivo sandbox: listed (GET), or removed (POST). It runs the
        // devkit's teardown in the project's container, as the partner, in their sandbox only.
        const post = req.method === 'POST';
        const body = post ? await readBody(req) : {};
        let fingerprint = null;
        if (post) {
          // busy: an assistant turn, or another removal of this project, is running.
          if (busy.has(id)) return json(res, 409, { error: 'The assistant is working, or a removal is running. Try again when it finishes.' });
          if (typeof body.confirm !== 'string' || body.confirm.trim().toLowerCase() !== String(p.name).trim().toLowerCase()) {
            return json(res, 400, { error: `Type the app's name, ${p.name}, to confirm.` });
          }
          // The fingerprint of the list the partner saw. The teardown removes only that list, or nothing.
          fingerprint = typeof body.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(body.fingerprint) ? body.fingerprint : null;
          if (!fingerprint) return json(res, 400, { error: 'Look at the list of what goes before deleting.' });
          busy.add(id);
        }
        try {
          await prepare(id);
          const amb = await ambivoEnv(id, p);
          if (!amb || amb === 'ended') return json(res, 409, { error: 'Sign in to your Ambivo sandbox first. The teardown runs as you, in your sandbox only.', ambivoSignIn: true });
          // --expect: the teardown looks again and refuses (PLAN_CHANGED) when the list is not the one shown.
          const argv = ['node', `${PLUGIN}/mcp/ambivo-mcp.mjs`, 'teardown', '/work/app', ...(post ? ['--yes', `--expect=${fingerprint}`] : [])];
          const r = await runIn(id, argv, amb);
          let out = null;
          try { out = JSON.parse(r.out); } catch { /* an error, below */ }
          if (r.code !== 0 || !out) {
            if (/\[PLAN_CHANGED\]/.test(String(r.err))) return json(res, 409, { error: 'The list changed. Look at it again before deleting.', planChanged: true });
            // The CLI prints "Error: <message>", or "<message> [CODE]" for an Ambivo refusal.
            const line = String(r.err).split('\n').map((x) => x.trim()).find(Boolean) || '';
            const why = ((line.match(/Error: (.+)/) || [])[1] || line).replace(/\s*\[[A-Z0-9_]+\]$/, '') || 'The teardown did not run.';
            return json(res, 409, { error: why });
          }
          if (post) {
            const deleted = Array.isArray(out.deleted) ? out.deleted : [], failed = Array.isArray(out.failed) ? out.failed : [];
            const problems = Array.isArray(out.lookup_problems) ? out.lookup_problems.length : 0;
            const objs = deleted.filter((d) => d.entity === 'custom_object').length, recs = deleted.length - objs;
            log(`project ${id}: sandbox teardown: ${objs} objects, ${recs} records, ${failed.length} failed, ${problems} lookup problems`);
            const kept = out.kept?.length ? ` ${out.kept.length} were kept. The list says why.` : '';
            emit(id, { kind: 'note', text: `Removed from your sandbox: ${objs} custom objects with their records and files, and ${recs} other records.${kept}` +
              `${failed.length ? ` ${failed.length} could not be removed.` : ''}${problems ? ` ${problems} lookups failed, so some records were not checked.` : ''}` });
          }
          return json(res, 200, out);
        } finally {
          if (post) {
            busy.delete(id);
            touch(id);
            // Messages sent during a removal are not run: the page deletes the app next, and a run would
            // be paid for and then cut off. Say so, so nobody waits for an answer.
            const waiting = queued.get(id);
            queued.delete(id);
            if (waiting?.length) emit(id, { kind: 'note', text: `${waiting.length === 1 ? 'The message' : `The ${waiting.length} messages`} sent during the removal ${waiting.length === 1 ? 'was' : 'were'} not sent to the assistant.` });
            emit(id, { kind: 'idle' });
          }
        }
      }
      if (sub === 'guide' && req.method === 'POST') {
        if (busy.has(id)) return json(res, 409, { error: 'The assistant is working. Write the guide when it finishes.' });
        if (!(await keyed(p))) return json(res, 428, { error: `Enter your ${keyName(p)} to continue.`, needKey: true, provider: providerOf(p) });
        await prepare(id);
        if (!(await driver.sh(id, 'test -f /work/app/package.json').then(() => true, () => false))) {
          return json(res, 409, { error: 'There is no app yet. Build it first, then write its guide.' });
        }
        // Each guide is written from scratch, in its own conversation.
        await update(id, (rec) => { rec.guide = { cost: rec.guide?.cost ?? 0 }; });
        emit(id, { kind: 'user', text: 'Write the user guide.' });
        turn(id, isCodex(p) ? GUIDE_PROMPT_CODEX : GUIDE_PROMPT, { side: 'guide' });
        return json(res, 202, { ok: true });
      }
      if (sub === 'guide' && req.method === 'GET') {
        await prepare(id);
        const image = url.searchParams.get('image');
        if (image !== null) {
          if (!SHOT_NAME.test(image)) return json(res, 404, { error: 'There is no such picture.' });
          const png = await driver.readFile(id, `${GUIDE_DIR}/images/${image}`).catch(() => null);
          if (!png) return json(res, 404, { error: 'There is no such picture.' });
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
          return res.end(png);
        }
        const text = await readText(id, `${GUIDE_DIR}/USER_GUIDE.md`);
        const out = await driver.sh(id, `ls -1 '${GUIDE_DIR}/images' 2>/dev/null || true`).then((o) => o.stdout, () => '');
        const images = String(out).split('\n').map((x) => x.trim()).filter((x) => SHOT_NAME.test(x)).sort();
        return json(res, 200, { text, images, cost: p.guide?.cost ?? 0 });
      }
      if (sub === 'settings' && req.method === 'PUT') {
        const body = await readBody(req);
        const budget = body.phaseBudget === null || body.phaseBudget === '' || body.phaseBudget === undefined ? null : Number(body.phaseBudget);
        if (budget !== null && !(Number.isFinite(budget) && budget >= 1 && budget <= 1000)) return json(res, 400, { error: 'Enter a limit from $1 to $1000, or leave it empty for no limit.' });
        const model = String(body.model ?? '');
        if (!MODELS.includes(model)) return json(res, 400, { error: 'Choose one of the listed models.' });
        await update(id, (rec) => { rec.limits = { phaseBudget: budget, model }; });
        return json(res, 200, { limits: projects[id].limits });
      }
      if (sub === 'datamodel' && req.method === 'GET') {
        // The files are read in the container; a project stopped while idle is started first.
        await prepare(id);
        return json(res, 200, dataModelView(await readText(id, OBJECTS_FILE), await readText(id, MODEL_DOC)));
      }
      if (sub === 'brief' && req.method === 'GET') return json(res, 200, { files: p.brief ?? [] });
      if (sub === 'brief' && req.method === 'POST') {
        // The file itself is the body; its name is in ?name=.
        if (busy.has(id)) return json(res, 409, { error: 'The assistant is working. Add the file when it finishes.' });
        const entry = await addBrief(id, url.searchParams.get('name'), await readRaw(req, BRIEF_MAX));
        return json(res, 201, { file: entry, files: projects[id].brief });
      }
      if (sub === 'phases' && !phaseId && req.method === 'GET') return json(res, 200, phasesOut(p));
      if (sub === 'phases' && phaseId && phaseAction === 'screens' && req.method === 'GET') {
        // The phase's screenshots, taken by the assistant with ambivo-screenshot.mjs before its handoff note.
        if (!PHASE_ID.test(phaseId)) return json(res, 404, { error: 'There is no such phase in the plan.' });
        await prepare(id);
        const file = url.searchParams.get('file');
        if (file === null) return json(res, 200, { files: await listShots(id, phaseId) });
        if (!SHOT_NAME.test(file)) return json(res, 404, { error: 'There is no such screenshot.' });
        const png = await driver.readFile(id, `${shotsDir(phaseId)}/${file}`).catch(() => null);
        if (!png) return json(res, 404, { error: 'There is no such screenshot.' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
        return res.end(png);
      }
      if (sub === 'phases' && phaseId && req.method === 'POST') {
        if (!p.phases) return json(res, 409, { error: 'This app is not built in phases.' });
        if (busy.has(id)) return json(res, 409, { error: 'The assistant is working. Try again when it finishes.' });
        if (!PHASE_ID.test(phaseId)) return json(res, 404, { error: 'There is no such phase in the plan.' });
        if (phaseAction === 'start' && !(await keyed(p))) return json(res, 428, { error: `Enter your ${keyName(p)} to continue.`, needKey: true, provider: providerOf(p) });
        const [code, out] = phaseAction === 'start' ? await startPhase(p, phaseId)
          : phaseAction === 'approve' ? await approvePhase(p, phaseId) : await reopenPhase(p, phaseId);
        return json(res, code, out);
      }
      if (sub === 'events' && req.method === 'GET') {
        const history = [...p.events];
        const isKeyed = await keyed(p);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        for (const ev of history) res.write(`data: ${JSON.stringify(ev)}\n\n`);
        // End of history: the page sets its controls from the live state, not from replayed events.
        res.write(`data: ${JSON.stringify({ kind: 'sync', busy: busy.has(id), keyed: isKeyed })}\n\n`);
        if (!listeners.has(id)) listeners.set(id, new Set());
        listeners.get(id).add(res);
        // A comment line now and then: the load balancer closes a connection idle for 60 s.
        const ping = setInterval(() => res.write(': ping\n\n'), keepAliveMs);
        ping.unref?.();
        res.on('close', () => clearInterval(ping));
        req.on('close', () => listeners.get(id)?.delete(res));
        return;
      }
      if (sub === 'keys' && req.method === 'POST') {
        const body = await readBody(req);
        const problem = await saveKey(user, providerOf(p), keyFrom(providerOf(p), body));
        if (problem) return json(res, 400, { error: problem });
        if (body.ambivoToken && !serverMode) ambivoTokens.set(id, String(body.ambivoToken));
        return json(res, 200, { ok: true });
      }
      if (sub === 'messages' && req.method === 'POST') {
        if (notReady()) return json(res, 409, { error: notReady(), notReady: true });
        // Ask for the key BEFORE taking the message, so nothing is lost and nothing half-runs.
        if (!(await keyed(p))) return json(res, 428, { error: `Enter your ${keyName(p)} to continue.`, needKey: true, provider: providerOf(p) });
        // A phased app talks inside the phase in progress. Between phases there is no conversation to continue.
        if (p.phases && !p.phases.active) return json(res, 409, { error: 'No phase is in progress. Start the next phase, or reopen one, to talk to the assistant.', noPhase: true });
        const text = String((await readBody(req)).text || '').trim().slice(0, 8000);
        if (!text) return json(res, 400, { error: 'Type a message first.' });
        if (busy.has(id)) {
          // The assistant is working: keep the message and send it when this run ends.
          const q = queued.get(id) || [];
          if (q.length >= QUEUE_MAX) return json(res, 409, { error: `${QUEUE_MAX} messages are already waiting. Wait for the assistant to finish.` });
          q.push(text); queued.set(id, q);
          emit(id, { kind: 'user', text, queued: true });
          emit(id, { kind: 'note', text: 'The assistant is working. Your message goes to it when it finishes.' });
          return json(res, 202, { ok: true, queued: true, waiting: q.length });
        }
        emit(id, { kind: 'user', text });
        turn(id, text);
        return json(res, 202, { ok: true });
      }
      if (sub === 'download' && req.method === 'GET') {
        await prepare(id);   // stopped while idle, or on a server that has not run this project yet
        const fileName = p.name.replace(/[^a-z0-9-]+/gi, '-');
        if (url.searchParams.get('for') === 'client') {
          // For a client: the same files without the developer ones (AGENTS.md, tools/, the brief, the dev
          // relay, the dev kit's package.json scripts). Filtered and zipped here; the project is untouched.
          const x = EXPORT_EXCLUDES.map((e) => `--exclude='${e}'`).join(' ');
          const child = driver.exec(id, ['sh', '-c', `cd /work && exec tar --format=pax -cf - ${x} .`], { interactive: false });
          const zip = zipFiles(clientFiles(parseTar(await readAll(child.stdout, 60 << 20))));
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length, 'Content-Disposition': `attachment; filename="${fileName}-client.zip"` });
          return res.end(zip);
        }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fileName}.zip"` });
        driver.exportZip(id).stdout.pipe(res);
        return;
      }
      if (sub === 'push' && req.method === 'POST') {
        if (!(serverMode && github) && !localGitHub) return json(res, 404, { error: 'Not found' });
        if (busy.has(id)) return json(res, 409, { error: 'The assistant is working. Push when it finishes.' });
        const body = await readBody(req);
        try {
          const [code, out] = await push(p, user, body.repo);
          return json(res, code, out);
        } catch (err) {
          log(`push ${id}: ${err.message}`);
          return json(res, err.status === 409 ? 409 : 502, { error: err.status === 409 ? err.message : `The push did not work. ${err.message}` });
        }
      }
      if (sub === 'preview' && req.method === 'POST') {
        const r = await startPreview(id);
        return json(res, r.url ? 200 : 409, r);
      }
      // The Preview link opens this in a new tab: start the app, then send the tab to it.
      if (sub === 'preview' && req.method === 'GET') {
        const r = await startPreview(id);
        if (r.url) { res.writeHead(302, { Location: r.url, 'Cache-Control': 'no-store' }); return res.end(); }
        return page(res, 200, 'Preview', `<h2>The preview did not start</h2><p>${esc(r.error)}</p>${r.log ? `<pre style="white-space:pre-wrap">${esc(r.log)}</pre>` : ''}
<p>Close this tab and try again, or ask the assistant to fix it.</p>`);
      }
      if (!sub && req.method === 'DELETE') {
        // Removing the container mid-run would cut off a run the partner is paying for.
        if (busy.has(id)) return json(res, 409, { error: 'The assistant is working, or a removal is running. Delete the app when it finishes.' });
        await driver.remove(id);
        await share.remove(id);
        await store.remove(id);
        if (files) await files.remove(id);
        ambivoTokens.delete(id);
        previewOk.delete(id);
        return json(res, 200, { deleted: id });
      }
      return json(res, 405, { error: 'Not allowed' });
    } catch (err) {
      if (err instanceof BriefError && !res.headersSent) return json(res, err.status, { error: err.message });
      log(`error ${req.method} ${url.pathname}: ${err.message}`);
      if (res.headersSent) return res.end();
      return json(res, 500, { error: err.message });
    }
  }

  return { handler, projects, store, shares: share, busy, previewOk, stopIdle, lastActive, restoreShares, partnerSource, accessToken };
}
