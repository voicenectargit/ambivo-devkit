// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// App jobs: the scheduled jobs a Dev Studio app declares in src/install/app-jobs.json (the
// ambivo-app-jobs skill), and Core's /app_job routes that run them.
//
// The Jobs dialog shows the file, and the jobs as they run in the maker's own sandbox (with the
// maker's session). Deploy shows the client's admin the jobs and the secrets they must enter. A
// secret's value goes straight to Ambivo with that person's session; Dev Studio never stores it.

export const JOBS_FILE = '/work/app/src/install/app-jobs.json';
export const JOB_TYPES = ['http_pull', 'http_push', 'reminder', 'email_digest', 'housekeeping', 'app_webhook'];
const JOB_KEY = /^[a-z][a-z0-9_]{1,39}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const JOB_ID = /^[0-9a-f]{16}$/;
const MAX_FILE = 200000;

const TYPE_NAMES = {
  http_pull: 'Get records from an outside service',
  http_push: 'Send records to an outside service',
  reminder: 'Remind people about a date',
  email_digest: 'Email a list of records',
  housekeeping: 'Change or remove old records',
  app_webhook: 'Call the app\'s own web address',
};
const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export class JobsError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** "Every 12 hours", "Every day at 08:00 (America/Chicago)", "Mon, Thu at 08:00 (UTC)". */
export function scheduleText(job) {
  const s = job?.schedule ?? (job?.every_minutes !== undefined ? { every_minutes: job.every_minutes } : null);
  if (!s || typeof s !== 'object') return 'No schedule';
  const tz = typeof s.tz === 'string' && s.tz ? s.tz : 'UTC';
  if (s.every_minutes !== undefined) {
    const m = Number(s.every_minutes);
    if (m % 1440 === 0) return m === 1440 ? 'Every day' : `Every ${m / 1440} days`;
    if (m % 60 === 0) return m === 60 ? 'Every hour' : `Every ${m / 60} hours`;
    return `Every ${m} minutes`;
  }
  if (s.daily_at !== undefined) return `Every day at ${s.daily_at} (${tz})`;
  if (s.weekly) return `${(s.weekly.days || []).map((d) => DAY_NAMES[d] || d).join(', ')} at ${s.weekly.at} (${tz})`;
  return 'No schedule';
}

/** The jobs and secrets in an app-jobs.json text, in a plain shape for a preview. null when unreadable. */
export function jobsFromFile(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.jobs) || !doc.jobs.length) return null;
  return {
    appKey: typeof doc.app_key === 'string' ? doc.app_key : '',
    jobs: doc.jobs.filter((j) => j && typeof j.job_key === 'string').map((j) => ({
      key: j.job_key, name: typeof j.name === 'string' && j.name ? j.name : j.job_key,
      type: String(j.job_type || ''), typeName: TYPE_NAMES[j.job_type] || String(j.job_type || ''), schedule: scheduleText(j),
    })),
    secrets: (Array.isArray(doc.secrets) ? doc.secrets : [])
      .filter((s) => s && SECRET_NAME.test(String(s.name || '')) && HOST.test(String(s.host || '').toLowerCase()))
      .map((s) => ({ name: s.name, host: String(s.host).toLowerCase(), label: typeof s.label === 'string' && s.label ? s.label.slice(0, 120) : s.name })),
  };
}

/**
 * The file the Jobs dialog saves, checked for its shape. The full rules are ambivo-check.mjs's; this
 * refuses only what must never be written: no secret value, nothing that is not the app's jobs list.
 */
export function cleanJobsDoc(doc, appKey) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new JobsError('Send the jobs file as an object.');
  if (appKey && doc.app_key !== appKey) throw new JobsError(`The app key must be ${appKey}, the same as in app-objects.json.`);
  if (!Array.isArray(doc.jobs) || doc.jobs.length > 20) throw new JobsError('An app has from 0 to 20 jobs.');
  const keys = new Set();
  for (const j of doc.jobs) {
    if (!j || typeof j !== 'object' || !JOB_KEY.test(String(j.job_key || ''))) {
      throw new JobsError('Each job needs a key: 2 to 40 lowercase letters, digits or _, starting with a letter.');
    }
    if (keys.has(j.job_key)) throw new JobsError(`Two jobs have the key ${j.job_key}. Each key is used once.`);
    keys.add(j.job_key);
    if (!JOB_TYPES.includes(j.job_type)) throw new JobsError(`${j.job_key}: pick a job type.`);
    if (!j.config || typeof j.config !== 'object' || Array.isArray(j.config)) throw new JobsError(`${j.job_key}: the job has no settings.`);
  }
  const secrets = doc.secrets ?? [];
  if (!Array.isArray(secrets)) throw new JobsError('Secrets must be a list.');
  for (const s of secrets) {
    if (!s || typeof s !== 'object') throw new JobsError('Each secret needs a name and a host.');
    // Never a value in a file: the admin types it in Ambivo.
    if ('value' in s) throw new JobsError(`Secret ${s.name}: the file holds the name and host only. Set the value in the sandbox below.`);
    if (!SECRET_NAME.test(String(s.name || ''))) throw new JobsError(`Secret ${s.name || ''}: use capital letters, digits and _, like SUPPLIER_API_KEY.`);
    if (!HOST.test(String(s.host || '').toLowerCase())) throw new JobsError(`Secret ${s.name}: enter the host it is for, like api.example.com.`);
  }
  const text = `${JSON.stringify({ app_key: doc.app_key, jobs: doc.jobs, secrets }, null, 2)}\n`;
  if (text.length > MAX_FILE) throw new JobsError('The jobs file is too large.');
  return text;
}

/** The jobs in a file, as Core's PUT /app_job/app takes them (every_minutes copied for older servers). */
export function jobsForCore(doc) {
  return (doc.jobs || []).map((j) => ({ ...j, ...(j.schedule?.every_minutes !== undefined ? { every_minutes: j.schedule.every_minutes } : {}) }));
}

/** The app's objects and their fields, from app-objects.json, for the form's pickers. */
export function objectsForJobs(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { appKey: '', objects: [] }; }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.objects) ? raw.objects : [];
  return {
    appKey: typeof raw?.app_key === 'string' ? raw.app_key : '',
    objects: list.filter((o) => o && typeof o.collection_id === 'string').map((o) => ({
      id: o.collection_id, name: typeof o.name === 'string' && o.name ? o.name : o.collection_id,
      fields: o.schema && typeof o.schema === 'object' ? Object.keys(o.schema) : [],
    })),
  };
}

/** A secret entered by a person, checked before it goes to Ambivo. Returns the problem, or null. */
export function secretProblem(name, value, host) {
  if (!SECRET_NAME.test(String(name || ''))) return 'That is not a secret name.';
  if (typeof value !== 'string' || !value.trim()) return `Enter the value for ${name}.`;
  if (value.length > 4096 || /[\r\n]/.test(value)) return `${name}: enter one line of up to 4,096 characters.`;
  if (!HOST.test(String(host || '').toLowerCase())) return `${name}: the host is not valid.`;
  return null;
}

/**
 * One call to Core's /app_job routes with a person's session. Answers { ok, status, body } or
 * { ok: false, status, error, code, signIn } with Core's own message, so a refusal (a job type this
 * server does not know yet, no Pro plan) is shown as Core says it.
 */
export async function coreCall({ fetchImpl = fetch, apiUrl, token }, method, path, body) {
  let r;
  try {
    r = await fetchImpl(new URL(path.replace(/^\//, ''), apiUrl), {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 502, error: 'Ambivo could not be reached. Try again in a minute.' };
  }
  const out = await r.json().catch(() => null);
  if (r.ok && out?.result === 1) return { ok: true, status: 200, body: out };
  const code = String(out?.error_code || out?.error?.error_code || '');
  if (r.status === 401 || /^(INVALID_TOKEN|TOKEN_EXPIRED|SESSION_EXPIRED)$/.test(code)) {
    return { ok: false, status: 409, code, signIn: true, error: 'Your Ambivo sign-in has ended. Sign in again.' };
  }
  if (r.status === 404 && !out) return { ok: false, status: 502, code: 'NO_APP_JOBS', error: 'This Ambivo server does not run app jobs yet.' };
  const message = (typeof out?.error?.message === 'string' && out.error.message) || (typeof out?.error === 'string' && out.error)
    || (typeof out?.message === 'string' && out.message) || `Ambivo answered with an error (${r.status}).`;
  return { ok: false, status: r.status >= 400 && r.status < 500 ? r.status : 502, code, error: message };
}
