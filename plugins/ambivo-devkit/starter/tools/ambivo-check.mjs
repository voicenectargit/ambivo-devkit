#!/usr/bin/env node
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Check an Ambivo app against the rules its code depends on.
//
//   ambivo-check.mjs [project dir]     check src/app and src/install; exit 1 on any error
//   ambivo-check.mjs --hook            Claude Code PostToolUse hook: check the file just written;
//                                      exit 2 with the problems so the agent fixes them
//
// Only projects made from the Ambivo starter are checked (they have src/ambivo/SYNCED_FROM_NX.json).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';

const PROVIDED_AM = new Set([
  '@am/crm/ui/layout',
  '@am/shared/ui/common',
  '@am/shared/ui/overflow-bar',
  '@am/shared/utils/resource',
  '@am/shared/utils/rxjs',
  '@am/shared/utils/types',
]);

const LEGACY_ROUTES = [
  'purchase_order/manage',
  'purchase_order/approve',
  'purchase_order/picklist',
  'purchase_order/create_bill',
  'purchase_order/create_from_installed_base',
  'inventory/place/manage',
  'inventory/uom',
  'custom/module',
];

// Look and feel: partner apps must look like Ambivo's own apps.
const COLOUR_DECL = /(?:^|[\s;{"'`])(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|fill|stroke|outline(?:-color)?|box-shadow|text-decoration-color|caret-color|accent-color)\s*:\s*[^;"'`]*?(?:#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:red|blue|green|black|white|gray|grey|orange|purple|yellow|pink|navy|teal|maroon)\b)/i;
const FONT_DECL = /font-family\s*:(?!\s*(?:inherit|var\())/i;
const OTHER_UI_NAMES = 'bootstrap|ngx-bootstrap|@ng-bootstrap|primeng|primeicons|ng-zorro-antd|@fortawesome|font-awesome|tailwindcss|bulma|materialize-css|@clr\\/angular|@nebular|@taiga-ui|daisyui';
const OTHER_UI = new RegExp(
  `from\\s+['"](?:${OTHER_UI_NAMES})|@import\\s+['"][^'"]*(?:${OTHER_UI_NAMES})|@tailwind\\b|` +
  `<link[^>]+(?:${OTHER_UI_NAMES}|fonts\\.googleapis\\.com\\/css2?\\?family=(?!Roboto|Material))`, 'i');

// [id, severity, test(text, file) -> line numbers or [], message]
const RULES = [
  ['hard-coded-colour', 'error', (t) => lines(t, COLOUR_DECL),
    "Use the theme's colour tokens (var(--color-primary), var(--color-fg-muted), var(--mat-sys-error) and the rest; see the ambivo-angular-app skill), never a hex, rgb(), hsl() or named colour. The tokens follow the light and dark themes."],
  ['font-family', 'error', (t) => lines(t, FONT_DECL),
    'Do not set font-family. Ambivo apps use Roboto from the starter, and Material Symbols for icons.'],
  ['other-ui-library', 'error', (t) => lines(t, OTHER_UI),
    'Use Angular Material and the Ambivo components only. Other UI, icon or CSS libraries (Bootstrap, Tailwind, PrimeNG, ng-zorro, Font Awesome...) break the Ambivo look.'],
  ['http-client', 'error', (t, f) => (f.includes(`core${sep}api`) ? [] : lines(t, /\bHttpClient\b/)),
    'Call the API through ApiService, never HttpClient. ApiService turns "result: 2" replies into errors.'],
  ['token-storage', 'error', (t, f) => (f.includes(`core${sep}auth`) ? [] : lines(t, /\b(localStorage|sessionStorage)\b|document\.cookie/)),
    'Do not use browser storage here. The session token lives in memory only; keep other storage in a small service and never store tokens.'],
  ['is-mobile', 'error', (t) => lines(t, /is_mobile['"]?\s*:\s*(true|!0|1\b)/),
    'Never send is_mobile: true. The API trusts it and gives a 180-day token.'],
  ['legacy-route', 'error', (t) => lines(t, new RegExp(LEGACY_ROUTES.map((r) => r.replace('/', '\\/')).join('|'))),
    'This route is being retired. Use the current verbed route; see the ambivo-api skill.'],
  ['mat-dialog', 'error', (t) => lines(t, /\bMatDialog\b|MAT_DIALOG_DATA|MatDialogRef|afterClosed\(|mat-dialog-/),
    'Dialogs are the CDK Dialog with DialogLayout (@am/shared/ui/common), never MatDialog.'],
  ['decorator-io', 'error', (t) => lines(t, /@(Input|Output|HostBinding|HostListener)\(/),
    'Use input() / output() and the host object, not decorators.'],
  ['ng-class', 'error', (t) => lines(t, /\[ngClass\]|\[ngStyle\]|\bngClass\b|\bngStyle\b/),
    'Use [class.x] / [style.x], not ngClass / ngStyle.'],
  ['legacy-control-flow', 'error', (t) => lines(t, /\*ngIf|\*ngFor|\[ngSwitch\]/),
    'Use @if / @for / @switch.'],
  ['busy-by-hand', 'error', (t) => lines(t, /\bbusy\.set\(\s*(true|false)\s*\)/),
    'Let indicate(this.busy) own the busy flag (@am/shared/utils/rxjs).'],
  ['onpush', 'error', (t, f) => (f.endsWith('.ts') && /@Component\(/.test(t) && !/ChangeDetectionStrategy\.OnPush/.test(t) ? [firstLine(t, /@Component\(/)] : []),
    'Every component uses ChangeDetectionStrategy.OnPush.'],
  ['unknown-am-import', 'error', (t) => linesWhere(t, /from\s+['"](@am\/[^'"]+)['"]/g, (m) => !PROVIDED_AM.has(m[1])),
    'This @am import does not exist outside Ambivo. Available: ' + [...PROVIDED_AM].join(', ')],
  ['entity-data-create', 'error', (t) => lines(t, /entity\/data['"`][^\n]*\n?[^\n]*['"]?action['"]?\s*:\s*['"](add|create)['"]/),
    'Do not create records through /entity/data. Use the entity\'s own create route.'],
  ['hard-coded-id', 'warning', (t, f) => (f.includes(`${sep}install${sep}`) ? [] : lines(t, /['"`][0-9a-f]{24}['"`]/)),
    'A 24-character id is written into the code. Tenant, site, user and record ids come from the API or runtime config.'],
  ['standalone-true', 'warning', (t) => lines(t, /standalone:\s*true/),
    'Standalone is the default; remove standalone: true.'],
  ['any-type', 'warning', (t, f) => (f.includes(`${sep}core${sep}`) ? [] : lines(t, /:\s*any\b|<any>|as any\b/)),
    'Avoid any. Use a real type, or unknown.'],
];

function lines(text, re) {
  const out = [];
  text.split('\n').forEach((l, i) => {
    if (re.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) out.push(i + 1);
  });
  return out;
}
function firstLine(text, re) {
  return text.split('\n').findIndex((l) => re.test(l)) + 1;
}
function linesWhere(text, re, keep) {
  const out = [];
  for (const m of text.matchAll(re)) if (keep(m)) out.push(text.slice(0, m.index).split('\n').length);
  return out;
}

function checkFile(file) {
  if (!/\.(ts|html|scss|css)$/.test(file) || /\.spec\.ts$/.test(file)) return [];
  const text = readFileSync(file, 'utf8');
  const found = [];
  for (const [id, severity, test, message] of RULES) {
    for (const line of test(text, file)) found.push({ file, line, id, severity, message });
  }
  return found;
}

// A standalone app's own data: src/install/app-objects.json and the install step that sends it.
// hosting_apps is what marks an object as a standalone app's; schema_meta in a seeded app's format (key,
// attributes) is what makes an object an app extension inside the CRM. An object is never both.
const GENERATOR = /agent\/schema\/(?:generate|design-app)/;
function checkInstall(root) {
  const dir = join(root, 'src', 'install');
  const out = [];
  const add = (file, line, id, message) => out.push({ file, line, id, severity: 'error', message });
  const objectsPath = join(dir, 'app-objects.json');
  if (existsSync(objectsPath)) {
    const text = readFileSync(objectsPath, 'utf8');
    let doc;
    try { doc = JSON.parse(text); } catch (e) {
      add(objectsPath, 1, 'install-json', `app-objects.json is not valid JSON: ${e.message}`);
      return out;
    }
    const key = doc.app_key;
    if (typeof key !== 'string' || !/^[a-z][a-z0-9]{1,23}$/.test(key)) {
      add(objectsPath, firstLine(text, /"app_key"/) || 1, 'install-app-key',
        'Set "app_key" at the top of app-objects.json: 2 to 24 lowercase letters or digits. The install step sends it as hosting_apps on every object.');
    }
    for (const obj of Array.isArray(doc.objects) ? doc.objects : []) {
      const id = String(obj?.collection_id ?? '');
      const line = firstLine(text, new RegExp(`"collection_id"\\s*:\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)) || 1;
      if (key && !id.startsWith(`${key}_`)) {
        add(objectsPath, line, 'install-object-prefix', `${id || 'An object'} must start with "${key}_", the app key.`);
      }
      const apps = obj?.hosting_apps;
      if (apps !== undefined && !(Array.isArray(apps) && apps.length === 1 && apps[0] === key)) {
        add(objectsPath, line, 'install-hosting-apps', `${id}: hosting_apps must be ["${key}"], or left out so the install step adds it.`);
      }
      const meta = obj?.schema_meta;
      if (meta && typeof meta === 'object' && ('key' in meta || 'attributes' in meta)) {
        add(objectsPath, line, 'install-schema-meta',
          `${id}: schema_meta holds a seeded app's object definition (key, attributes). That makes an app extension, not a standalone app's object. Leave those out.`);
      }
    }
  }
  const installPath = join(dir, 'install.mjs');
  if (existsSync(installPath) && !/hosting_apps/.test(readFileSync(installPath, 'utf8'))) {
    add(installPath, 1, 'install-sends-hosting-apps', 'install.mjs must send hosting_apps: [app_key] on every object it creates or updates.');
  }
  for (const f of existsSync(join(root, 'src')) ? walk(join(root, 'src')) : []) {
    if (!/\.(m?js|ts)$/.test(f) || /\.spec\.ts$/.test(f) || f.includes(`${sep}ambivo${sep}`)) continue;
    const t = readFileSync(f, 'utf8');
    if (GENERATOR.test(t)) {
      add(f, firstLine(t, GENERATOR), 'schema-generator',
        "Don't call agent/schema/generate or design-app. They design app extensions for the CRM. A standalone app writes its own schema.");
    }
  }
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, acc) : acc.push(p);
  }
  return acc;
}

function projectRoot(from) {
  let d = resolve(from);
  while (true) {
    if (existsSync(join(d, 'src', 'ambivo', 'SYNCED_FROM_NX.json'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function report(problems, root) {
  return problems
    .map((p) => `${p.severity.toUpperCase()} ${relative(root, p.file)}:${p.line} [${p.id}] ${p.message}`)
    .join('\n');
}

if (process.argv[2] === '--hook') {
  let input = '';
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    let file;
    try {
      file = JSON.parse(input)?.tool_input?.file_path;
    } catch {
      process.exit(0);
    }
    if (!file || !existsSync(file)) process.exit(0);
    const root = projectRoot(dirname(file));
    // Only app code: never the copied Ambivo files.
    if (!root) process.exit(0);
    const inInstall = resolve(file).startsWith(join(root, 'src', 'install'));
    const own = inInstall || resolve(file).startsWith(join(root, 'src', 'app')) || resolve(file) === join(root, 'src', 'styles.scss');
    if (!own) process.exit(0);
    const errors = (inInstall ? checkInstall(root) : [...checkFile(resolve(file)), ...checkInstall(root).filter((p) => p.file === resolve(file))])
      .filter((p) => p.severity === 'error');
    if (!errors.length) process.exit(0);
    console.error(`Ambivo check found problems in the file you just wrote:\n${report(errors, root)}`);
    process.exit(2);
  });
} else {
  const root = projectRoot(process.argv[2] ?? '.');
  if (!root) {
    console.error('Not an Ambivo starter project (no src/ambivo/SYNCED_FROM_NX.json found).');
    process.exit(1);
  }
  const files = walk(join(root, 'src', 'app'));
  if (existsSync(join(root, 'src', 'styles.scss'))) files.push(join(root, 'src', 'styles.scss'));
  const problems = [...files.flatMap(checkFile), ...checkInstall(root)];
  // Other UI libraries added as dependencies, even if not imported yet.
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    const banned = new RegExp(`^(?:${OTHER_UI_NAMES})(?:$|/)`, 'i');
    for (const d of deps.filter((d) => banned.test(d))) {
      problems.push({ file: pkgPath, line: firstLine(readFileSync(pkgPath, 'utf8'), new RegExp(`"${d.replace(/[/\\^$.*+?()[\]{}|]/g, '\\$&')}"`)), id: 'other-ui-library', severity: 'error',
        message: `${d} is another UI library. Use Angular Material and the Ambivo components only.` });
    }
  }
  const errors = problems.filter((p) => p.severity === 'error');
  if (problems.length) console.log(report(problems, root));
  console.log(`${errors.length} error(s), ${problems.length - errors.length} warning(s).`);
  process.exit(errors.length ? 1 : 0);
}
