#!/usr/bin/env node
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Take a screenshot of a page of the running app, so the assistant can look at what it built.
//
//   node ambivo-screenshot.mjs /samples                 desktop width (1280), saved under .ambivo/screens/
//   node ambivo-screenshot.mjs /samples --phone         phone width (390)
//   node ambivo-screenshot.mjs /samples --out a.png --wait 3000 --url http://localhost:4200
//   node ambivo-screenshot.mjs /samples --phase intake  saved under .ambivo/screens/intake/ for the phase's handoff
//
// The app must be running (`npm start`, or Dev Studio's preview) on --url. Pages behind sign-in: with
// AMBIVO_TOKEN set (the sandbox session), the page is signed in through the starter's development-only
// hook `__ambivoDevSignIn`, then the route is opened inside the app. The session lives in memory only, so
// a reload would sign out again. Uses Chromium's DevTools protocol; no npm packages.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(msg); process.exit(1); };
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const route = args.find((a, i) => !a.startsWith('--') && !['--out', '--wait', '--url', '--phase'].includes(args[i - 1])) || '/';
const phone = args.includes('--phone');
const base = (opt('--url', 'http://localhost:4200')).replace(/\/$/, '');
const waitMs = Number(opt('--wait', 2500));
const width = phone ? 390 : 1280, height = phone ? 844 : 900;
// Screenshots go in the app's folder (the one with package.json): here, or ./app (Dev Studio runs in /work).
const appDir = existsSync('package.json') ? '.' : existsSync(join('app', 'package.json')) ? 'app' : '.';
const phase = opt('--phase', '');
if (phase && !/^[a-z][a-z0-9-]{0,39}$/.test(phase)) fail('--phase takes a phase id from docs/PHASES.md, such as intake.');
const shotName = `${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}${phone ? '-phone' : ''}.png`;
const out = opt('--out', join(appDir, '.ambivo', 'screens', ...(phase ? [phase] : []), shotName));

const BROWSERS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = process.env.CHROMIUM || BROWSERS.find((b) => existsSync(b));
if (!browser) fail('No Chromium found. Set CHROMIUM to the browser to use.');

// The app answers?
try { await fetch(base, { signal: AbortSignal.timeout(5000) }); }
catch { fail(`The app is not running at ${base}. Start it first (npm start, in the background), then try again.`); }

const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'ambivo-shot-'));
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const chrome = spawn(browser, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  // The app on localhost is reached directly; everything else (fonts, the API) through the egress proxy.
  ...(proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1;[::1]'] : []),
  `--window-size=${width},${height}`, 'about:blank',
], { stdio: 'ignore' });
// Chromium may still be writing its profile as it dies; a leftover temp folder is not an error.
const stop = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* left in tmp */ } };
process.on('exit', stop);

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
}
if (!target) fail('Chromium did not start.');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not reach Chromium')); });
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  waiting.set(id, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const run = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: phone });
await cdp('Page.navigate', { url: `${base}/` });
await sleep(waitMs);

let signedIn = false;
if (process.env.AMBIVO_TOKEN) {
  const hasHook = await run('typeof globalThis.__ambivoDevSignIn === "function"');
  if (hasHook) {
    try { await run(`globalThis.__ambivoDevSignIn(${JSON.stringify(process.env.AMBIVO_TOKEN)})`); signedIn = true; }
    catch (err) { console.error(`Signing in did not work: ${err.message}`); }
  } else {
    console.error('This app has no development sign-in hook (__ambivoDevSignIn), so pages behind sign-in show the sign-in page. ' +
      'The ambivo-angular-app skill, "Checking your screens", has the few lines to add.');
  }
}
// Open the route inside the app: Angular's router follows popstate. A reload would lose the session.
await run(`history.pushState({}, '', ${JSON.stringify(route)}); dispatchEvent(new PopStateEvent('popstate', { state: {} })); true`);
await sleep(waitMs);

const landed = await run('location.pathname + location.search');
const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
  clip: { x: 0, y: 0, width, height: Math.min(4000, await run('Math.max(document.documentElement.scrollHeight, innerHeight)')), scale: 1 } });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`Saved ${out} (${width} wide${signedIn ? ', signed in' : ''}). Page: ${landed}${landed !== route ? ` (asked for ${route})` : ''}`);
ws.close();
process.exit(0);
