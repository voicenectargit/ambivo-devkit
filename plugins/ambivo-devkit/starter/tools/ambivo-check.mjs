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
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
    // The app's permanent app ID, registered with Ambivo (register_app): com.<company domain reversed>.<app>.
    const appId = doc.app_id;
    if (appId === undefined) {
      add(objectsPath, 1, 'install-app-id', 'Register the app first with the register_app tool. It adds "app_id" (com.yourcompany.app) here; a review and a certificate need it.');
    } else if (typeof appId !== 'string' || !/^[a-z][a-z0-9]{0,62}(\.[a-z][a-z0-9]{0,62}){2,}$/.test(appId) || appId.length > 155) {
      add(objectsPath, firstLine(text, /"app_id"/) || 1, 'install-app-id', '"app_id" must look like com.yourcompany.app: lowercase letters and digits, parts joined by dots. Only register_app writes it.');
    }
    if (typeof key !== 'string' || !/^[a-z][a-z0-9]{1,23}$/.test(key)) {
      add(objectsPath, firstLine(text, /"app_key"/) || 1, 'install-app-key',
        'Set "app_key" at the top of app-objects.json: 2 to 24 lowercase letters or digits. The install step sends it as hosting_apps on every object.');
    } else if (['crm', 'inventory', 'workforce', 'books', 'ambivo'].includes(key)) {
      // Ambivo refuses these as app keys (APP_KEY_RESERVED_FOR_AMBIVO).
      add(objectsPath, firstLine(text, /"app_key"/) || 1, 'install-app-key',
        `"${key}" is the name of an Ambivo app. Pick another app_key.`);
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
  // Outside a partner sandbox Ambivo refuses an app's objects without its certificate (APP_CERTIFICATE_REQUIRED).
  // Apps made before certificates existed have an install step that never sends one.
  if (existsSync(installPath)) {
    const code = codeOnly(readFileSync(installPath, 'utf8'));
    if (/custom\/object\b/.test(code) && !(/ambivo-certificate\.json/.test(code) && /\bapp_certificate\b/.test(code))) {
      add(installPath, 1, 'install-sends-certificate',
        'install.mjs must read ambivo-certificate.json next to itself and send "app_certificate": <cert_id> on every POST and PUT /custom/object. Without it, installing in a client\'s company is refused.');
    }
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

// A standalone app's scheduled jobs: src/install/app-jobs.json (the ambivo-app-jobs skill).
const JOB_TYPES = ['http_pull', 'http_push', 'reminder', 'email_digest', 'housekeeping', 'app_webhook'];
const JOB_KEY = /^[a-z][a-z0-9_]{1,39}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const FILTER_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'exists', 'older_than_days', 'within_next_days'];
// Fields Ambivo keeps on every record. A job may read some of them, and never writes any.
const RESERVED_FIELDS = new Set(['id', 'tenant_id', 'userid', 'updated_by_userid', 'created_by', 'created_by_userid',
  'updated_by', 'created_ts', 'updated_ts', 'access_dict', 'comments', 'file_ids_list', 'deleted']);
const reservedField = (f) => RESERVED_FIELDS.has(f) || String(f).startsWith('_');
// A header value that looks like a key: "Bearer ...", "sk_...", or a long run of random-looking characters.
const KEYLIKE = /^\s*(bearer|basic|token)\s+\S+|\b(sk|pk|rk)_[A-Za-z0-9]|\bsk-[A-Za-z0-9]|[A-Za-z0-9+/_=-]{32,}/i;

/** The host of an https URL on a public-looking name, or null. */
function publicHttpsHost(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
      h.endsWith('.localhost') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[') || !/\.[a-z]{2,63}$/.test(h)) return null;
  return h;
}

function checkJobs(root) {
  const dir = join(root, 'src', 'install');
  const path = join(dir, 'app-jobs.json');
  if (!existsSync(path)) return [];
  const out = [];
  const text = readFileSync(path, 'utf8');
  const lineOf = (needle) => (needle ? firstLine(text, new RegExp(String(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) : 0) || 1;
  const add = (line, id, message) => out.push({ file: path, line, id, severity: 'error', message });
  let doc;
  try { doc = JSON.parse(text); } catch (e) {
    add(1, 'jobs-json', `app-jobs.json is not valid JSON: ${e.message}`);
    return out;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { add(1, 'jobs-json', 'app-jobs.json must be an object: {"app_key", "jobs", "secrets"}.'); return out; }

  // The app's objects and their fields, from app-objects.json.
  let objectsDoc = null;
  try { objectsDoc = JSON.parse(readFileSync(join(dir, 'app-objects.json'), 'utf8')); } catch { /* reported by checkInstall, or missing */ }
  const key = doc.app_key;
  if (!objectsDoc) {
    add(lineOf('"app_key"'), 'jobs-app-key', 'app-jobs.json needs src/install/app-objects.json next to it. Jobs work only on the app\'s own custom objects.');
  } else if (key !== objectsDoc.app_key) {
    add(lineOf('"app_key"'), 'jobs-app-key', `"app_key" must be "${objectsDoc.app_key}", the same as in app-objects.json.`);
  }
  const objects = new Map();
  for (const o of Array.isArray(objectsDoc?.objects) ? objectsDoc.objects : Array.isArray(objectsDoc) ? objectsDoc : []) {
    if (o && typeof o.collection_id === 'string') {
      const fields = o.schema && typeof o.schema === 'object' ? Object.keys(o.schema) : [];
      objects.set(o.collection_id, fields.length ? new Set(fields) : null);
    }
  }

  // Secrets: names and hosts only.
  const secrets = new Map();
  const secretList = doc.secrets ?? [];
  if (!Array.isArray(secretList)) add(lineOf('"secrets"'), 'jobs-secrets', '"secrets" must be a list of {"name", "host", "label"}.');
  for (const s of Array.isArray(secretList) ? secretList : []) {
    const name = s?.name;
    const line = lineOf(`"${name}"`);
    if (typeof name !== 'string' || !SECRET_NAME.test(name)) { add(line, 'jobs-secrets', `Secret name ${JSON.stringify(name)}: use capital letters, digits and _, like SUPPLIER_API_KEY.`); continue; }
    if (s && 'value' in s) add(line, 'jobs-secret-value', `Secret ${name} has a "value". Never put a secret value in a file. The company admin sets it in Ambivo.`);
    const host = String(s?.host ?? '').toLowerCase();
    if (!publicHttpsHost(`https://${host}/`) || /[/:]/.test(host)) add(line, 'jobs-secrets', `Secret ${name}: "host" must be the host name the secret is sent to, like api.example.com.`);
    if (secrets.has(name)) add(line, 'jobs-secrets', `Secret ${name} is listed twice.`);
    secrets.set(name, host);
  }

  const jobs = doc.jobs;
  if (!Array.isArray(jobs) || !jobs.length) { add(lineOf('"jobs"'), 'jobs-list', '"jobs" must be a list of 1 to 20 jobs.'); return out; }
  if (jobs.length > 20) add(lineOf('"jobs"'), 'jobs-list', `An app has at most 20 jobs; this file has ${jobs.length}.`);
  const seen = new Set();
  for (const job of jobs) {
    const jk = job?.job_key;
    const line = lineOf(jk ? `"${jk}"` : null);
    const bad = (id, msg) => add(line, id, `${jk || 'A job'}: ${msg}`);
    if (typeof jk !== 'string' || !JOB_KEY.test(jk)) bad('jobs-key', 'job_key is 2 to 40 lowercase letters, digits or _, starting with a letter.');
    else if (seen.has(jk)) bad('jobs-key', 'this job_key is used twice.');
    seen.add(jk);
    if (!JOB_TYPES.includes(job?.job_type)) { bad('jobs-type', `job_type must be one of: ${JOB_TYPES.join(', ')}.`); continue; }
    for (const p of scheduleProblems(job)) bad('jobs-schedule', p);
    const cfg = job.config;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { bad('jobs-config', 'config must be an object.'); continue; }
    for (const p of configProblems(job.job_type, cfg, key, objects, secrets)) bad(p[0], p[1]);
  }

  // install.mjs must send the jobs.
  const installPath = join(dir, 'install.mjs');
  if (existsSync(installPath) && !/app_job\/app\//.test(readFileSync(installPath, 'utf8'))) {
    out.push({ file: installPath, line: 1, id: 'install-sends-jobs', severity: 'error',
      message: 'app-jobs.json exists, so install.mjs must send it with PUT /app_job/app/{app_key} after the objects. See the ambivo-app-jobs skill.' });
  }
  return out;
}

function scheduleProblems(job) {
  const s = job.schedule ?? (job.every_minutes !== undefined ? { every_minutes: job.every_minutes } : null);
  if (!s || typeof s !== 'object') return ['add a "schedule": {"every_minutes"}, {"daily_at"} or {"weekly"}.'];
  const forms = ['every_minutes', 'daily_at', 'weekly'].filter((k) => s[k] !== undefined);
  if (forms.length !== 1) return ['"schedule" takes exactly one of every_minutes, daily_at or weekly.'];
  const out = [];
  if (s.every_minutes !== undefined && !(Number.isInteger(s.every_minutes) && s.every_minutes >= 15 && s.every_minutes <= 10080)) {
    out.push('every_minutes must be a whole number from 15 to 10080.');
  }
  if (s.daily_at !== undefined && !HHMM.test(String(s.daily_at))) out.push('daily_at must be a time like "08:00".');
  if (s.weekly !== undefined) {
    const w = s.weekly;
    if (!w || !Array.isArray(w.days) || !w.days.length || w.days.some((d) => !DAYS.includes(d))) out.push(`weekly.days must list days from: ${DAYS.join(' ')}.`);
    if (!HHMM.test(String(w?.at ?? ''))) out.push('weekly.at must be a time like "08:00".');
  }
  if (s.tz !== undefined && (typeof s.tz !== 'string' || !/^(UTC|[A-Z][A-Za-z_+-]*(\/[A-Za-z0-9_+-]+){1,2})$/.test(s.tz))) {
    out.push('tz must be a time zone name like "America/Chicago", or "UTC".');
  }
  return out;
}

function configProblems(type, cfg, key, objects, secrets) {
  const out = [];
  const p = (id, m) => out.push([id, m]);
  // The outside address, its headers and its secret headers.
  if (['http_pull', 'http_push', 'app_webhook'].includes(type)) {
    const host = publicHttpsHost(cfg.url);
    if (!host) p('jobs-url', 'url must be an https address on a public host name, never an IP address, localhost, .local or .internal.');
    const methods = type === 'http_pull' ? ['GET', 'POST'] : type === 'http_push' ? ['POST', 'PUT'] : null;
    if (methods && cfg.method !== undefined && !methods.includes(String(cfg.method).toUpperCase())) p('jobs-config', `method must be ${methods.join(' or ')}.`);
    const headers = cfg.headers ?? {};
    if (typeof headers !== 'object' || Array.isArray(headers)) p('jobs-config', 'headers must be an object.');
    else {
      for (const [h, v] of Object.entries(headers)) {
        if (/^(authorization|x-api-key|api-key|apikey|x-auth-token|cookie)$/i.test(h) || KEYLIKE.test(String(v))) {
          p('jobs-header-secret', `headers.${h} looks like a key. Put it in secret_headers with a secret name, and list the secret in "secrets".`);
        }
      }
    }
    const sh = cfg.secret_headers ?? {};
    if (typeof sh !== 'object' || Array.isArray(sh)) p('jobs-config', 'secret_headers must be an object of header: SECRET_NAME.');
    else {
      for (const [h, name] of Object.entries(sh)) {
        if (!secrets.has(name)) p('jobs-secret-unknown', `secret_headers.${h} names ${JSON.stringify(name)}, which is not in "secrets".`);
        else if (host && secrets.get(name) !== host) p('jobs-secret-host', `secret ${name} is for ${secrets.get(name)}, but the url's host is ${host}. They must be the same.`);
      }
    }
  }
  // The app's own object, and the fields named on it.
  const objectOf = (field) => {
    const c = cfg[field];
    if (typeof c !== 'string' || !c) { p('jobs-object', `${field} is required.`); return null; }
    if (key && !c.startsWith(`${key}_`)) { p('jobs-object', `${field} ${c} must start with "${key}_". Jobs work only on the app's own objects.`); return null; }
    if (!objects.has(c)) { p('jobs-object', `${field} ${c} is not in app-objects.json.`); return null; }
    return c;
  };
  const fieldsOn = (coll, names, what, { write = false } = {}) => {
    if (!coll) return;
    const known = objects.get(coll);
    for (const f of names) {
      if (typeof f !== 'string' || !f) { p('jobs-field', `${what}: a field name is missing.`); continue; }
      if (write && reservedField(f)) { p('jobs-reserved-field', `${what}: ${f} is a field Ambivo sets itself. A job may not write it.`); continue; }
      if (known && !known.has(f) && !reservedField(f)) p('jobs-field', `${what}: ${f} is not a field of ${coll}.`);
    }
  };
  const filterOn = (coll) => {
    const f = cfg.filter ?? [];
    if (!Array.isArray(f)) { p('jobs-filter', 'filter must be a list of {"field", "op", "value"}.'); return; }
    if (f.length > 10) p('jobs-filter', 'filter has at most 10 conditions.');
    for (const c of f) if (!FILTER_OPS.includes(c?.op)) p('jobs-filter', `filter op ${JSON.stringify(c?.op)} must be one of: ${FILTER_OPS.join(' ')}.`);
    fieldsOn(coll, f.map((c) => c?.field), 'filter');
  };
  if (type === 'http_pull') {
    const t = objectOf('target_collection');
    const fm = cfg.field_map;
    if (!fm || typeof fm !== 'object' || Array.isArray(fm) || !Object.keys(fm).length) p('jobs-config', 'field_map must map the object\'s fields to paths in each fetched item.');
    else {
      fieldsOn(t, Object.keys(fm), 'field_map', { write: true });
      if (!(cfg.upsert_key in fm)) p('jobs-config', 'upsert_key must be one of the field_map fields. It finds the record to update.');
    }
  } else if (type === 'http_push') {
    const s = objectOf('source_collection');
    if (!Array.isArray(cfg.fields) || !cfg.fields.length) p('jobs-config', 'fields must list the fields to send.');
    else fieldsOn(s, cfg.fields, 'fields');
    filterOn(s);
  } else if (type === 'reminder') {
    const s = objectOf('source_collection');
    fieldsOn(s, [cfg.date_field], 'date_field');
    if (!(Number.isInteger(cfg.days) && cfg.days >= -30 && cfg.days <= 30)) p('jobs-config', 'days must be a whole number from -30 to 30.');
    const n = cfg.notify;
    if (n === 'owner' || (n && typeof n === 'object' && n.role === 'admins')) { /* ok */ }
    else if (n && typeof n === 'object' && typeof n.user_field === 'string') fieldsOn(s, [n.user_field], 'notify.user_field');
    else if (n && typeof n === 'object' && Array.isArray(n.userids) && n.userids.length) { /* ok */ }
    else p('jobs-recipients', 'notify must be "owner", {"user_field"}, {"userids"} or {"role": "admins"}: people in the company only.');
    if (!Array.isArray(cfg.channels) || !cfg.channels.length || cfg.channels.some((c) => !['in_app', 'push', 'email'].includes(c))) {
      p('jobs-config', 'channels must list in_app, push or email.');
    }
    filterOn(s);
  } else if (type === 'email_digest') {
    const s = objectOf('source_collection');
    if (!Array.isArray(cfg.fields) || !cfg.fields.length) p('jobs-config', 'fields must list the columns of the email.');
    else fieldsOn(s, cfg.fields, 'fields');
    if (cfg.sort !== undefined) fieldsOn(s, [cfg.sort?.field], 'sort');
    const to = cfg.to;
    if (!(to && typeof to === 'object' && (to.role === 'admins' || (Array.isArray(to.userids) && to.userids.length)))) {
      p('jobs-recipients', 'to must be {"userids": [...]} or {"role": "admins"}: people in the company only, never an email address.');
    }
    if (typeof cfg.subject !== 'string' || !cfg.subject.trim()) p('jobs-config', 'subject is required.');
    filterOn(s);
  } else if (type === 'housekeeping') {
    const s = objectOf('source_collection');
    if (cfg.action === 'set') {
      if (!cfg.set || typeof cfg.set !== 'object' || Array.isArray(cfg.set) || !Object.keys(cfg.set).length) p('jobs-config', 'set must name the fields to change and their new values.');
      else fieldsOn(s, Object.keys(cfg.set), 'set', { write: true });
    } else if (cfg.action === 'delete') {
      if (!Array.isArray(cfg.filter) || !cfg.filter.length) p('jobs-filter', 'a delete job needs a filter, so it never removes every record.');
    } else p('jobs-config', 'action must be "set" or "delete".');
    filterOn(s);
  }
  return out;
}

// The fixed About page every Ambivo-made app shows (src/ambivo-about/). Its files must stay byte for byte
// Ambivo's copy (SHA-256 of the bytes with CRLF turned into LF); Ambivo refuses to certify the app otherwise,
// and without a certificate it refuses to install the app's custom objects in a client's company.
// Same list as Dev Studio's about.mjs and the certify_app tool.
const ABOUT_LOCK = {
  'src/ambivo-about/about.page.ts': ['e7ab6a1067f731ac22e675c5decdab90eb6ea97ce91537ac41e08cfd22b0d1a6'],
  'src/ambivo-about/about.ts': ['7d850408b4e4ac5703ef52dad47160d7eb3402767eba1b4fd99535cded14c331'],
};
const ABOUT_SOURCE = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const plugin = join(here, '..', 'starter', 'src', 'ambivo-about');
  return existsSync(plugin) ? plugin : "the dev kit's starter (starter/src/ambivo-about/)";
})();
const sha256Text = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
// Code lines only: comments and import lines do not count as showing the page.
const codeOnly = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|import\s)/.test(l)).join('\n');

function checkAbout(root) {
  const out = [];
  const add = (rel, line, message) => out.push({ file: join(root, rel), line, id: 'about-page', severity: 'error', message });
  for (const [rel, hashes] of Object.entries(ABOUT_LOCK)) {
    const p = join(root, rel);
    if (!existsSync(p)) add(rel, 1, `The About page file is missing. Copy it unchanged from ${ABOUT_SOURCE}.`);
    else if (!hashes.includes(sha256Text(readFileSync(p, 'utf8')))) {
      add(rel, 1, `This file is locked: the About page must stay as Ambivo wrote it. Put back the copy from ${ABOUT_SOURCE}. Never edit, move or delete src/ambivo-about/.`);
    }
  }
  const certPath = join(root, 'src', 'install', 'ambivo-certificate.json');
  if (!existsSync(certPath)) add('src/install/ambivo-certificate.json', 1, 'Missing. Write {"certificate": null} here, then run the certify_app tool.');
  else {
    try { const d = JSON.parse(readFileSync(certPath, 'utf8')); if (!d || !('certificate' in d)) throw new Error(); }
    catch { add('src/install/ambivo-certificate.json', 1, 'Not valid. Only the certify_app tool writes this file; put back {"certificate": null} and certify again.'); }
  }
  const read = (rel) => (existsSync(join(root, rel)) ? codeOnly(readFileSync(join(root, rel), 'utf8')) : '');
  if (!/provideAmbivoAbout\(\)/.test(read('src/app/app.config.ts'))) {
    add('src/app/app.config.ts', 1, "Call provideAmbivoAbout() (from '../ambivo-about/about') in the providers, after provideRouter.");
  }
  const appFiles = existsSync(join(root, 'src', 'app')) ? walk(join(root, 'src', 'app')).filter((f) => /\.(ts|html)$/.test(f)) : [];
  const signIn = join(root, 'src', 'app', 'sign-in') + sep;
  if (!appFiles.some((f) => f.startsWith(signIn) && codeOnly(readFileSync(f, 'utf8')).includes('<ambivo-about-link'))) {
    add('src/app/sign-in/sign-in-layout.component.ts', 1, 'The sign-in page must show <ambivo-about-link /> under the card (import AmbivoAboutLink).');
  }
  if (!appFiles.some((f) => !f.startsWith(signIn) && /\bABOUT_NAV_ITEM\b|<ambivo-about-link/.test(codeOnly(readFileSync(f, 'utf8'))))) {
    add('src/app/shell/nav.ts', 1, 'Signed-in pages must reach the About page: ABOUT_NAV_ITEM last in NAV_ITEMS, or <ambivo-about-link /> on a page.');
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
    const inAbout = resolve(file).startsWith(join(root, 'src', 'ambivo-about'));
    const own = inInstall || inAbout || resolve(file).startsWith(join(root, 'src', 'app')) || resolve(file) === join(root, 'src', 'styles.scss');
    if (!own) process.exit(0);
    const errors = (inAbout ? checkAbout(root)
      : inInstall ? [...checkInstall(root), ...checkJobs(root), ...checkAbout(root)]
        : [...checkFile(resolve(file)), ...checkInstall(root).filter((p) => p.file === resolve(file)), ...checkAbout(root)])
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
  const problems = [...files.flatMap(checkFile), ...checkInstall(root), ...checkJobs(root), ...checkAbout(root)];
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
