#!/usr/bin/env node
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
//
// The dev container's checks: is it ready to build apps, and if not, what to do.
//
//   node ambivo-checks.mjs --write        at every start (ambivo-start): what is fixed at start, saved to
//                                         $DEVSTUDIO_DATA/startup.json, problems printed
//   node ambivo-checks.mjs --auth         `ambivo-start status`: also tries the Claude sign-in (and an
//                                         OpenAI key, if set) for real; prints a checklist; exit 1 when not ready
//   node ambivo-checks.mjs --auth --json  Dev Studio: the same, as JSON on stdout
//
// Required for "ready": Node, Claude Code, the plugin, a writable apps folder, and (with --auth) a Claude
// sign-in that Anthropic accepts. The sandbox sign-in is recommended: without it Claude still builds,
// but cannot read Ambivo.
import { execFile } from 'node:child_process';
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Read on each use: the environment is the container's, set before this runs (and a test's).
const HOME = () => process.env.HOME || '/home/node';
const CONFIG = () => process.env.CLAUDE_CONFIG_DIR || join(HOME(), '.claude');
const DATA = () => process.env.DEVSTUDIO_DATA || join(CONFIG(), 'devstudio');
const WORK = () => process.env.DEVSTUDIO_PROJECTS || '/work';
const MARKET = '/opt/ambivo-devkit';
const IMAGE = 'sgosain/ambivo-devkit';
const VOLUME = '-v ambivo-devkit-home:/home/node/.claude';
export const CLAUDE_SIGN_IN = `docker run -it --rm ${VOLUME} ${IMAGE} claude`;
export const SANDBOX_SIGN_IN = `docker run -it --rm ${VOLUME} ${IMAGE} login`;

function run(cmd, args, { timeout = 20_000, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', timeout, cwd: tmpdir(), env: env ?? process.env, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() }));
  });
}
const firstWord = (s) => (s || '').split(/\s+/)[0] || null;

/** The Claude sign-in, tried for real. */
async function claudeAuth(fetchImpl) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const r = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
      if (r.ok) return { ok: true, text: 'Claude: Anthropic accepts your API key' };
      return { ok: false, text: `Claude: Anthropic refused the API key (HTTP ${r.status})`, fix: 'Check ANTHROPIC_API_KEY, or create a new key at console.anthropic.com.' };
    } catch {
      return { ok: false, text: 'Claude: Anthropic could not be reached', fix: 'Check your internet connection, then check again.' };
    }
  }
  const signedIn = process.env.CLAUDE_CODE_OAUTH_TOKEN || existsSync(join(CONFIG(), '.credentials.json'));
  if (!signedIn) return { ok: false, text: 'Claude: not signed in', fix: 'Run this in a terminal on your computer. In Claude Code, type /login, sign in, then type /exit.', command: CLAUDE_SIGN_IN };
  // A Claude account sign-in has no free check: one tiny request on the smallest model.
  const r = await run('claude', ['-p', 'Reply with the word OK.', '--model', 'haiku', '--max-turns', '1'], { timeout: 90_000 });
  if (r.ok) return { ok: true, text: 'Claude: your Claude sign-in works' };
  const why = (r.err || r.out).split('\n').find(Boolean)?.slice(0, 160) || 'no answer';
  return { ok: false, text: `Claude: the sign-in did not work (${why})`, fix: 'Sign in again. Run this in a terminal on your computer, type /login, sign in, then type /exit.', command: CLAUDE_SIGN_IN };
}

/** An OpenAI key, only when one is set. Codex itself runs in the hosted Dev Studio only. */
async function openaiAuth(fetchImpl) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetchImpl('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    return r.ok ? { ok: true, text: 'OpenAI: your API key works' }
      : { ok: false, text: `OpenAI: the API key was refused (HTTP ${r.status})`, fix: 'Check OPENAI_API_KEY, or create a new key at platform.openai.com.' };
  } catch {
    return { ok: false, text: 'OpenAI: could not be reached', fix: 'Check your internet connection, then check again.' };
  }
}

function sandboxSession() {
  try {
    const s = JSON.parse(readFileSync(join(process.env.XDG_CONFIG_HOME || join(HOME(), '.config'), 'ambivo-devkit', 'session.json'), 'utf8'));
    if (s.token && s.expiresAt > Date.now() / 1000 + 600) return s;
  } catch { /* not signed in */ }
  return null;
}

/**
 * Every check: { id, ok, required, text, fix? }. `ready` is true when every required check is ok.
 * @param auth  also try the Claude sign-in (and an OpenAI key) for real
 */
export async function runChecks({ auth = false, fetchImpl = fetch } = {}) {
  const checks = [];
  const add = (id, required, ok, text, fix, command) => checks.push({ id, required, ok, text, ...(ok ? {} : { fix, ...(command ? { command } : {}) }) });

  const node = process.versions.node;
  add('node', true, Number(node.split('.')[0]) >= 20, `Node.js ${node}`, `Use the ${IMAGE} image: it has Node.js 22.`);

  const wantClaude = process.env.CLAUDE_CODE_VERSION || null;
  const claude = firstWord((await run('claude', ['--version'])).out);
  add('claude', true, !!claude && (!wantClaude || claude === wantClaude),
    claude ? `Claude Code ${claude}` : 'Claude Code is not installed',
    'Check your internet connection, then start the container again. It downloads Claude Code when it starts.');

  let wantPlugin = null;
  try { wantPlugin = JSON.parse(readFileSync(join(MARKET, 'plugins/ambivo-devkit/.claude-plugin/plugin.json'), 'utf8')).version; } catch { /* not in the image */ }
  const cache = join(CONFIG(), 'plugins/cache/ambivo/ambivo-devkit');
  const installed = existsSync(cache) ? readdirSync(cache) : [];
  const pluginOk = !!wantPlugin && installed.includes(wantPlugin);
  add('plugin', true, pluginOk, pluginOk ? `Ambivo plugin ${wantPlugin}` : 'The Ambivo plugin is not installed',
    'Start the container again. If it still fails, write to dev-partner@ambivo.com.');

  let writable = false;
  try {
    accessSync(WORK(), constants.W_OK);
    const probe = join(WORK(), `.devstudio-write-check-${process.pid}`);
    writeFileSync(probe, ''); unlinkSync(probe); writable = true;
  } catch { /* reported below */ }
  add('work', true, writable, writable ? 'Your apps folder can be written' : 'Your apps folder cannot be written',
    'Start the container from a folder you own, with -v "$PWD":/work.');

  const chromium = (await run(process.env.CHROMIUM || 'chromium', ['--version'])).out;
  add('chromium', false, !!chromium, chromium || 'Chromium is missing', `Use the ${IMAGE} image: Claude uses Chromium to look at the screens it builds.`);

  if (auth) {
    const c = await claudeAuth(fetchImpl);
    add('claude-auth', true, c.ok, c.text, c.fix, c.command);
    const o = await openaiAuth(fetchImpl);
    if (o) add('openai-auth', false, o.ok, o.text, o.fix);
  }

  const s = sandboxSession();
  add('sandbox', false, !!s, s ? `Ambivo sandbox: ${s.email}` : 'Ambivo sandbox: not signed in',
    'Claude can still build, but cannot read Ambivo. To sign in, run this in a terminal on your computer.', SANDBOX_SIGN_IN);

  return { checkedAt: new Date().toISOString(), auth, ready: checks.every((c) => !c.required || c.ok), checks };
}

/** The checklist as the terminal shows it. */
export function checklist(result) {
  const lines = [];
  for (const c of result.checks) {
    lines.push(`${c.ok ? '  ok  ' : c.required ? '  FIX ' : '  --  '} ${c.text}`);
    if (!c.ok && c.fix) lines.push(`        ${c.fix}`);
    if (!c.ok && c.command) lines.push(`        ${c.command}`);
  }
  lines.push('');
  lines.push(result.ready
    ? (result.auth ? 'Ready to build apps.' : 'Set up. Run `ambivo-start status` to check the Claude sign-in too.')
    : 'Not ready yet. Fix the lines marked FIX, then check again.');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const result = await runChecks({ auth: args.includes('--auth') });
  if (args.includes('--write')) {
    try {
      mkdirSync(DATA(), { recursive: true });
      writeFileSync(join(DATA(), 'startup.json'), JSON.stringify(result, null, 2));
    } catch (err) { console.error(`Could not save the checks: ${err.message}`); }
  }
  if (args.includes('--json')) process.stdout.write(JSON.stringify(result));
  else if (args.includes('--write')) {
    // At start: only what needs doing; a full checklist is `ambivo-start status`.
    const bad = result.checks.filter((c) => !c.ok && c.required);
    if (bad.length) console.error(`${checklist({ ...result, checks: bad })}`);
  } else console.log(checklist(result));
  if (args.includes('--auth') && !args.includes('--json')) process.exitCode = result.ready ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
