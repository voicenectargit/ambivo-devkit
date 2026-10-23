#!/usr/bin/env node
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// The fixed checks of an app review: no AI, nothing from the app is run.
//
//   node ambivo-review-checks.mjs <app dir>      prints {"checks": [...], "findings": [...]} as JSON
//
// Dev Studio runs this from Ambivo's own read-only copy of the dev kit (/opt/ambivo-devkit), in a fresh
// container holding a frozen copy of the submitted app. The build runs afterwards, separately, and only
// when the "packages" check passed. Checks:
//   rules       ambivo-check.mjs (Ambivo's coding rules, the About page, the install step, app jobs)
//   secrets     keys, tokens and passwords written into the code
//   packages    every dependency is one the starter has, or on review/allowed-packages.json
//   hosts       every outside address the code names is Ambivo's, or declared in src/install/app-jobs.json
//   routes      every Ambivo API route the code names is in Ambivo's API description, and not retired
//   patterns    eval, code built from strings, hidden code, tokens in browser storage, mining libraries
//   files       nothing executable, no archives, no huge files; lists images for the content review
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..');
const root = process.argv[2];
if (!root || !existsSync(root)) { console.error('usage: ambivo-review-checks.mjs <app dir>'); process.exit(2); }

const checks = [];
const findings = [];
const check = (id, name, status, detail = '') => checks.push({ id, name, status, detail });
const find = (severity, category, title, file = '', line = null, detail = '') =>
  findings.push({ severity, category, title, file, line, detail, source: 'check' });

// The same folders the code fingerprint leaves out (devstudio/web/fingerprint.mjs EXCLUDED_DIRS).
const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', '.git', '.ambivo', 'coverage', '.claude', '.idea', '.vscode']);
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    st.isDirectory() ? walk(p, acc) : acc.push({ path: relative(root, p), size: st.size });
  }
  return acc;
}
const files = walk(root);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|html|htm|scss|sass|less|css|json|md|txt|yaml|yml|svg|xml|webmanifest|map)$|(^|\/)\.[a-z]*rc$/i;
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|html|htm)$/i;
// Every text file is read, wherever it is: code outside src/ (public/, a script angular.json loads) counts too.
// A code file over 1 MB cannot be reviewed by a person or the agent, so it fails "files" below.
const texts = files.filter((f) => TEXT.test(f.path) && f.size <= 5 << 20)
  .map((f) => {
    const text = readFileSync(join(root, f.path), 'utf8');
    const starts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    return { ...f, text, starts };
  });
// A file byte for byte the same as Ambivo's own starter copy (tools, config) is Ambivo's code, not the partner's.
const fromStarter = (f) => {
  const ours = join(KIT, 'starter', f.path);
  try { return existsSync(ours) && readFileSync(ours, 'utf8') === f.text; } catch { return false; }
};
const partnerTexts = texts.filter((f) => !fromStarter(f));
const code = partnerTexts.filter((f) => CODE_RE.test(f.path));
function lineOf(f, index) {
  let lo = 0, hi = f.starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f.starts[mid] <= index) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
function eachMatch(list, re, fn) {
  for (const f of list) for (const m of f.text.matchAll(re)) fn(f, m, lineOf(f, m.index));
}

// ---- rules: Ambivo's own check script, from Ambivo's copy -----------------------------------------
{
  const r = spawnSync(process.execPath, [join(KIT, 'scripts', 'ambivo-check.mjs'), root], { encoding: 'utf8', timeout: 120000 });
  const errs = [];
  for (const l of String(r.stdout).split('\n')) {
    const m = /^(ERROR|WARNING) (\S+?):(\d+) \[([a-z-]+)\] (.*)$/.exec(l);
    if (!m) continue;
    if (m[1] === 'ERROR') errs.push(m);
    find(m[1] === 'ERROR' ? (m[4] === 'about-page' ? 'critical' : 'high') : 'low', m[4] === 'about-page' ? 'about-page' : 'standards',
      m[5].slice(0, 280), m[2], Number(m[3]));
  }
  if (r.status === null) check('rules', "Ambivo's coding rules (ambivo:check)", 'fail', 'The check did not finish in 2 minutes.');
  else if (r.status !== 0 && !errs.length) check('rules', "Ambivo's coding rules (ambivo:check)", 'fail', String(r.stderr || r.stdout).trim().slice(0, 500));
  else check('rules', "Ambivo's coding rules (ambivo:check)", errs.length ? 'fail' : 'pass', errs.length ? `${errs.length} error(s)` : '');
}

// ---- secrets ---------------------------------------------------------------------------------------
{
  const SECRET = [
    [/AKIA[0-9A-Z]{16}/g, 'AWS access key'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
    [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'Anthropic key'], [/\bsk-[A-Za-z0-9]{32,}/g, 'OpenAI-style key'],
    [/gh[pousr]_[A-Za-z0-9]{30,}/g, 'GitHub token'], [/xox[abpr]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
    [/AIza[0-9A-Za-z_-]{35}/g, 'Google API key'], [/amb_sk_[A-Za-z0-9_]{20,}/g, 'Ambivo service key'],
    [/mongodb(\+srv)?:\/\/[^\s/:@'"]+:[^\s/@'"]+@/g, 'database address with a password'],
    [/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, 'session token (JWT)'],
    [/\b(?:api[_-]?key|secret|password|passwd|token)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/gi, 'value named like a secret'],
  ];
  let n = 0;
  for (const [re, what] of SECRET) eachMatch(texts, re, (f, m, line) => {
    if (what === 'value named like a secret') {
      // A placeholder (SUPPLIER_API_KEY, the name of a job secret) or a test or a document is not a secret.
      if (/\.(spec\.ts|md)$/.test(f.path) || /["']([A-Z][A-Z0-9_]{2,}|<[^>]*>|x{6,}|\*{6,})["']\s*$/.test(m[0])) return;
    }
    n++; find('critical', 'security', `A ${what} is written into the code`, f.path, line);
  });
  check('secrets', 'No keys, tokens or passwords in the code', n ? 'fail' : 'pass', n ? `${n} found` : '');
}

// ---- packages --------------------------------------------------------------------------------------
{
  const pkgPath = join(root, 'package.json');
  let ok = true;
  if (!existsSync(pkgPath)) { check('packages', 'Only known packages', 'fail', 'package.json is missing.'); ok = false; }
  else {
    let pkg;
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { pkg = null; }
    if (!pkg) { check('packages', 'Only known packages', 'fail', 'package.json is not valid JSON.'); ok = false; }
    else {
      const starter = JSON.parse(readFileSync(join(KIT, 'starter', 'package.json'), 'utf8'));
      const known = new Set([...Object.keys(starter.dependencies || {}), ...Object.keys(starter.devDependencies || {})]);
      let extra = [];
      try { extra = JSON.parse(readFileSync(join(KIT, 'review', 'allowed-packages.json'), 'utf8')).packages || []; } catch { /* none */ }
      for (const p of extra) known.add(p);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.optionalDependencies || {}) };
      const unknown = Object.keys(deps).filter((d) => !known.has(d));
      // A version that is not a registry version can fetch code from anywhere (git, a URL, a file).
      const odd = Object.entries(deps).filter(([, v]) => !/^[~^]?\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(String(v)));
      // The same versions as the starter, and the same lock: a different lock can point a known name anywhere.
      const starterDeps = { ...(starter.dependencies || {}), ...(starter.devDependencies || {}) };
      for (const [d, v] of Object.entries(deps)) {
        if (starterDeps[d] && starterDeps[d] !== v) odd.push([d, `${v} (the starter has ${starterDeps[d]})`]);
      }
      const scripts = Object.keys(pkg.scripts || {}).filter((s) => /^(pre|post)?install$|^prepare$/.test(s));
      try {
        const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
        const ours = JSON.parse(readFileSync(join(KIT, 'starter', 'package-lock.json'), 'utf8'));
        const strip = (l) => JSON.stringify(Object.fromEntries(Object.entries(l.packages || {}).filter(([k]) => k !== '')));
        if (strip(lock) !== strip(ours)) scripts.push('package-lock.json is not the starter\'s');
      } catch { scripts.push('package-lock.json is missing or not valid JSON'); }
      // Ways to make npm or the build run other code: overrides, workspaces, a project .npmrc, and
      // builders in angular.json that are not Angular's own.
      for (const k of ['overrides', 'resolutions', 'workspaces', 'bundledDependencies', 'bundleDependencies', 'config']) {
        if (pkg[k] !== undefined) { scripts.push(`"${k}" in package.json`); }
      }
      for (const f of files.filter((x) => /(^|\/)\.(npmrc|yarnrc|yarnrc\.yml|pnpmfile\.cjs)$/.test(x.path))) scripts.push(f.path);
      try {
        const ng = JSON.parse(readFileSync(join(root, 'angular.json'), 'utf8'));
        for (const proj of Object.values(ng.projects || {})) {
          for (const [t, target] of Object.entries(proj?.architect || proj?.targets || {})) {
            const b = String(target?.builder || '');
            if (!/^@angular\/(build|build-angular):[a-z0-9-]+$/.test(b)) scripts.push(`angular.json target ${t} uses builder "${b.slice(0, 80)}"`);
            for (const opt of [target?.options, ...Object.values(target?.configurations || {})]) {
              for (const k of ['plugins', 'indexHtmlTransformer', 'customWebpackConfig', 'ssr', 'server', 'prerender', 'appShell']) {
                if (opt && opt[k] !== undefined && opt[k] !== false) scripts.push(`angular.json ${t} sets "${k}"`);
              }
              // Every file the build is pointed at must be in the reviewed copy.
              for (const fr of opt?.fileReplacements || []) for (const f of [fr?.replace, fr?.with]) if (f && !existsSync(join(root, f))) scripts.push(`angular.json ${t} uses ${f}, which is not in the app`);
            }
          }
        }
      } catch { scripts.push('angular.json is missing or not valid JSON'); }
      // tsconfig paths: one target each, and it must be in the reviewed copy (a fallback list could reach a
      // file the review never saw).
      for (const f of files.filter((x) => /(^|\/)tsconfig[^/]*\.json$/.test(x.path))) {
        let tc;
        try { tc = JSON.parse(readFileSync(join(root, f.path), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')); } catch { continue; }
        const base = join(root, dirname(f.path), tc?.compilerOptions?.baseUrl || '.');
        for (const [k, targets] of Object.entries(tc?.compilerOptions?.paths || {})) {
          if (!Array.isArray(targets) || targets.length !== 1) { scripts.push(`${f.path} paths "${k}" must name one place`); continue; }
          const t = String(targets[0]).replace(/\*.*$/, '');
          if (!existsSync(join(base, t))) scripts.push(`${f.path} paths "${k}" points at ${targets[0]}, which is not in the app`);
        }
        for (const p of tc?.compilerOptions?.plugins || []) scripts.push(`${f.path} loads a compiler plugin ${String(p?.name || p?.transform || '').slice(0, 60)}`);
      }
      for (const d of unknown) find('high', 'packages', `Package ${d} is not one Ambivo has approved`, 'package.json');
      for (const [d, v] of odd) find('high', 'packages', `Package ${d} comes from "${String(v).slice(0, 80)}", not a fixed registry version`, 'package.json');
      for (const s of scripts) find('high', 'packages', /^(pre|post)?install$|^prepare$/.test(s)
        ? `package.json runs a "${s}" script on install` : `Can run code during install or build: ${s}`, 'package.json');
      ok = !unknown.length && !odd.length && !scripts.length;
      check('packages', 'Only known packages, at fixed versions, with no install scripts', ok ? 'pass' : 'fail',
        ok ? '' : [unknown.length && `unknown: ${unknown.join(', ')}`, odd.length && `not fixed: ${odd.map(([d]) => d).join(', ')}`,
          scripts.length && `can run code: ${scripts.join(', ')}`].filter(Boolean).join('; ').slice(0, 1500));
    }
  }
}

// ---- outside addresses -----------------------------------------------------------------------------
{
  const AMBIVO = /(^|\.)ambivo\.com$/i;
  const ALWAYS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'localhost', '127.0.0.1', 'www.w3.org', 'angular.dev', 'angular.io']);
  // Names reserved for examples (RFC 2606, RFC 6761): no one can own them, so a hint like name@example.com calls nothing.
  const RESERVED = /(^|\.)(example|test|invalid|localhost)$|(^|\.)example\.(com|net|org)$/i;
  let declared = new Set();
  try {
    const jobs = JSON.parse(readFileSync(join(root, 'src', 'install', 'app-jobs.json'), 'utf8'));
    for (const s of jobs.secrets || []) if (s?.host) declared.add(String(s.host).toLowerCase());
    for (const j of jobs.jobs || []) { try { declared.add(new URL(j.config.url).hostname.toLowerCase()); } catch { /* none */ } }
  } catch { declared = new Set(); }
  const hosts = new Map();
  // A link a person clicks (<a href="https://..."> or <a [href]="'https://...' + x">) opens a page; it sends
  // nothing from the app. Listed for staff, never a failure. location.href = ... is a call, and still fails.
  const LINK = /<a(?:\s[^<>]*?)?\s\[?href\]?\s*=\s*(?:"'|'"|"|')$/i;
  // A file that clicks, dispatches or reads link addresses by code can use a "link" as a call.
  const SCRIPTED = /\.click\s*\(|dispatchEvent\s*\(|\.href\b|dataset|getAttribute\s*\(|nativeElement|querySelector|ViewChild|createElement\s*\(/;
  const links = new Map();
  const appCode = partnerTexts.filter((f) => !/\.spec\.ts$/.test(f.path) && !/\.md$/.test(f.path) && f.path !== 'package-lock.json');
  // Any scheme or a protocol-relative //host; the host is read the way a browser reads it (new URL), so
  // "https://ambivo.com@evil.io" is evil.io. Escaped slashes are unescaped first.
  const unescape = (t) => t.replace(/\\\//g, '/');
  for (const f of appCode) {
    const t = unescape(f.text);
    for (const m of t.matchAll(/(?:\b[a-z][a-z0-9+.-]*:)?\/\/[^\s'"`<>()\\]{3,}/gi)) {
      if (/^[a-z]+:\/\/\/?$/i.test(m[0])) continue;
      let h;
      try { h = new URL(m[0].startsWith('//') ? `https:${m[0]}` : m[0]).hostname.toLowerCase(); } catch { continue; }
      if (!h || !/[a-z0-9]/i.test(h) || !/^(https?|wss?|ftp)?:?$/i.test(m[0].split('//')[0]) && !m[0].startsWith('//')) continue;
      const line = lineOf(f, m.index);
      if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$|^\d+\.\d+\.\d+\.\d+$|^localhost$/.test(h)) continue;
      if (AMBIVO.test(h) || ALWAYS.has(h) || RESERVED.test(h)) continue;
      const into = !SCRIPTED.test(t) && LINK.test(t.slice(Math.max(0, m.index - 300), m.index)) ? links : hosts;
      if (!into.has(h)) into.set(h, []);
      into.get(h).push(`${f.path}:${line}`);
    }
  }
  for (const [h, where] of links) {
    if (hosts.has(h)) continue;
    find('info', 'outside-link', `The app links to ${h} (a link a person clicks)`, where[0].split(':')[0], Number(where[0].split(':')[1]),
      where.length > 1 ? `Also at ${where.slice(1, 6).join(', ')}` : '');
  }
  let undeclared = 0;
  for (const [h, where] of hosts) {
    const jobsOnly = declared.has(h) && where.every((w) => w.startsWith('src/install/'));
    if (jobsOnly) { find('info', 'outside-address', `${h} is called by the app's scheduled jobs`, where[0].split(':')[0]); continue; }
    undeclared++;
    find('high', 'outside-address', `The app names an outside address: ${h}`, where[0].split(':')[0], Number(where[0].split(':')[1]),
      where.length > 1 ? `Also at ${where.slice(1, 6).join(', ')}` : '');
  }
  check('hosts', 'Calls only Ambivo, or outside services the scheduled jobs declare', undeclared ? 'fail' : 'pass',
    hosts.size ? `outside addresses: ${[...hosts.keys()].join(', ')}` : '');
}

// ---- Ambivo routes ---------------------------------------------------------------------------------
{
  const index = JSON.parse(readFileSync(join(KIT, 'specs', 'index.json'), 'utf8'));
  const ops = [];
  for (const s of index.specs || []) {
    let spec;
    try { spec = JSON.parse(readFileSync(join(KIT, 'specs', `${s.id}.json`), 'utf8')); } catch { continue; }
    for (const [path, item] of Object.entries(spec.paths || {})) {
      const deprecated = Object.values(item || {}).some((op) => op && typeof op === 'object' && op.deprecated);
      const re = new RegExp('^' + path.replace(/^\//, '').replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '$');
      ops.push({ path, re, deprecated });
    }
  }
  // Route strings the app passes to ApiService: this.api.get('user/x'), api.post(`custom/object/data`, ...).
  let unknown = 0, retired = 0, seen = 0;
  // Both shapes: api.get('user/x') and api.get({ endpoint: 'user/x', ... }).
  const ROUTE_RE = /(?:\bapi\.(?:get|post|put|patch|delete|request)\s*(?:<[^>]*>)?\(\s*|\bendpoint\s*:\s*)(['"`])\/?([a-z_][a-z0-9_/.-]*)/gi;
  // Routes the starter's own code calls (sign-in, session) count as known.
  const starterRoutes = new Set();
  (function scan(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) scan(p);
      else if (/\.ts$/.test(name)) for (const m of readFileSync(p, 'utf8').matchAll(ROUTE_RE)) starterRoutes.add(m[2].replace(/\/+$/, ''));
    }
  })(join(KIT, 'starter', 'src'));
  eachMatch(code.filter((f) => f.path.startsWith('src/')), /(?:\bapi\.(?:get|post|put|patch|delete|request)\s*(?:<[^>]*>)?\(\s*|\bendpoint\s*:\s*)(['"`])\/?([a-z_][a-z0-9_/.-]*)/gi, (f, m, line) => {
    const route = m[2].replace(/\/+$/, '');
    if (!route || route.includes('${')) return;
    seen++;
    if (starterRoutes.has(route)) return;
    const hit = ops.filter((o) => o.re.test(route));
    if (!hit.length) { unknown++; find('medium', 'api-route', `The app calls ${route}, which is not in Ambivo's API description`, f.path, line); }
    else if (hit.every((o) => o.deprecated)) { retired++; find('medium', 'api-route', `The app calls ${route}, which Ambivo is retiring`, f.path, line); }
  });
  check('routes', 'Calls only documented, current Ambivo routes', unknown || retired ? 'warn' : 'pass', `${seen} route(s) found`);
}

// ---- patterns that hide or run code ----------------------------------------------------------------
{
  const PATTERNS = [
    [/\beval\s*\)?\s*\(|\(\s*0\s*,\s*eval\s*\)|\[\s*['"`]ev['"`]\s*\+|['"`]eval['"`]\s*\]/g, 'critical', 'Runs text as code (eval)'],
    [/\b(?:new\s+)?Function\s*\(\s*['"`]/g, 'critical', 'Builds code from text (Function)'],
    [/\bconstructor\s*\[?\s*\(?\s*['"`]?constructor|\.constructor\.constructor\b/g, 'critical', 'Reaches the Function constructor indirectly'],
    [/\bset(?:Timeout|Interval)\s*\(\s*['"`]/g, 'high', 'Runs a string as code (setTimeout or setInterval with text)'],
    [/document\.write\s*\(/g, 'high', 'Writes into the page with document.write'],
    [/bypassSecurityTrust(?:Html|Script|Url|ResourceUrl|Style)\s*\(/g, 'high', "Turns off Angular's protection against injected code"],
    [/\bimport\s*\(\s*['"`]https?:/g, 'critical', 'Loads code from another website at run time'],
    [/<script[^>]+src\s*=\s*['"]https?:\/\/(?![a-z0-9.-]*ambivo\.com)/gi, 'critical', 'Loads a script from another website'],
    [/\b(coinhive|cryptonight|coin-hive|webminer|xmrig|cryptoloot)\b/gi, 'critical', 'Crypto mining code'],
    [/\b(?:localStorage|sessionStorage|indexedDB)\b[^;\n]*\b(?:token|session|jwt|password)\b/gi, 'high', 'Keeps a token or password in browser storage'],
    [/\b(?:atob|Buffer\.from)\s*\(\s*['"][A-Za-z0-9+/=]{200,}['"]/g, 'high', 'Decodes a long hidden string at run time'],
    [/\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){40,}/gi, 'high', 'A long run of escaped bytes (hidden text or code)'],
    [/navigator\.(?:geolocation|mediaDevices|clipboard\.read)/g, 'medium', 'Uses location, camera, microphone or the clipboard'],
    [/\bnew\s+(?:WebSocket|EventSource|RTCPeerConnection)\s*\(/g, 'medium', 'Opens a live connection (WebSocket, EventSource or WebRTC)'],
    [/\bnavigator\.sendBeacon\s*\(/g, 'medium', 'Sends data in the background (sendBeacon)'],
  ];
  let bad = 0;
  for (const [re, sev, title] of PATTERNS) eachMatch(code.filter((f) => !/\.spec\.ts$/.test(f.path)), re, (f, m, line) => {
    if (sev === 'critical' || sev === 'high') bad++;
    find(sev, 'pattern', title, f.path, line);
  });
  // Minified or one-line files hide what they do.
  for (const f of code) {
    let longest = 0;
    for (let i = 0; i < f.starts.length; i++) longest = Math.max(longest, (f.starts[i + 1] ?? f.text.length + 1) - f.starts[i] - 1);
    if (longest > 2000) { bad++; find('high', 'pattern', 'A line over 2,000 characters long: minified or hidden code', f.path); }
  }
  check('patterns', 'No hidden code, code built from text, or mining', bad ? 'fail' : 'pass', bad ? `${bad} serious` : '');
}

// ---- files -----------------------------------------------------------------------------------------
{
  const EXEC = /\.(exe|dll|so|dylib|bin|sh|bat|cmd|ps1|jar|wasm|apk|ipa|dmg|pkg|deb|rpm)$/i;
  const ARCHIVE = /\.(zip|tar|gz|tgz|7z|rar|bz2|xz)$/i;
  const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
  let bad = 0;
  for (const f of files) {
    if (EXEC.test(f.path)) { bad++; find('high', 'files', `A program or script file: ${f.path}`, f.path); }
    else if (ARCHIVE.test(f.path)) { bad++; find('high', 'files', `An archive the review cannot read: ${f.path}`, f.path); }
    else if (f.size > 5 << 20) { bad++; find('high', 'files', `A file over 5 MB: ${f.path}`, f.path); }
    else if (CODE_RE.test(f.path) && f.size > 1 << 20) { bad++; find('high', 'files', `A code file over 1 MB cannot be reviewed: ${f.path}`, f.path); }
  }
  const images = files.filter((f) => IMAGE.test(f.path)).map((f) => f.path);
  check('files', 'No programs, archives or huge files', bad ? 'fail' : 'pass',
    `${files.length} files, ${images.length} image(s)${images.length ? ': ' + images.slice(0, 30).join(', ') : ''}`);
}

process.stdout.write(JSON.stringify({ checks, findings }));
