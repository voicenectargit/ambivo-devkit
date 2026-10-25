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

/**
 * The app's objects and their fields, from app-objects.json, for the form's pickers. `types` is each
 * field's bsonType; `userFields` are the fields `core_links` points at `user` (they hold a user id).
 */
export function objectsForJobs(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { appKey: '', objects: [] }; }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.objects) ? raw.objects : [];
  const links = raw?.core_links && typeof raw.core_links === 'object' ? raw.core_links : {};
  return {
    appKey: typeof raw?.app_key === 'string' ? raw.app_key : '',
    objects: list.filter((o) => o && typeof o.collection_id === 'string').map((o) => {
      const schema = o.schema && typeof o.schema === 'object' ? o.schema : {};
      const types = {};
      for (const [f, d] of Object.entries(schema)) {
        const t = Array.isArray(d?.bsonType) ? d.bsonType.find((x) => x !== 'null') : d?.bsonType;
        if (typeof t === 'string') types[f] = t;
      }
      const own = links[o.collection_id] && typeof links[o.collection_id] === 'object' ? links[o.collection_id] : {};
      return {
        id: o.collection_id, name: typeof o.name === 'string' && o.name ? o.name : o.collection_id,
        fields: Object.keys(schema), types,
        userFields: Object.keys(schema).filter((f) => own[f] === 'user'),
      };
    }),
  };
}

const SYSTEM_FIELDS = new Set(['id', 'tenant_id', 'userid', 'updated_by_userid', 'created_by', 'created_by_userid',
  'updated_by', 'created_ts', 'updated_ts', 'access_dict', 'comments', 'file_ids_list', 'deleted']);
const ownFields = (o) => (o.fields || []).filter((f) => !SYSTEM_FIELDS.has(f) && !f.startsWith('_'));
const DATE_NAME = /(^|_)(date|due|deadline|expir\w*|end|ends|until|renew\w*)(_|$)|_(at|on)$/;
const LABEL_NAME = /^(name|title|label|subject|summary)$/;
const STATUS_NAME = /^(status|stage|state)$/;

/** The object's date fields: bsonType date first, then names that read like a date. */
function dateFields(o) {
  const typed = ownFields(o).filter((f) => o.types?.[f] === 'date');
  return typed.length ? typed : ownFields(o).filter((f) => DATE_NAME.test(f) && (!o.types?.[f] || o.types[f] === 'string'));
}
const labelField = (o) => ownFields(o).find((f) => LABEL_NAME.test(f)) || ownFields(o).find((f) => o.types?.[f] === 'string');
// due_date -> due date, lead_userid -> lead: how a field reads in a sentence.
const words = (f) => f.replace(/_?(userid|user_id|_id)$/, '').replace(/_/g, ' ').trim() || f;
const statusField = (o) => ownFields(o).find((f) => STATUS_NAME.test(f) && (!o.types?.[f] || o.types[f] === 'string'));

/**
 * Ready-made jobs for the Add job form, built from the app's own objects. Each one is a starting point
 * the maker changes before saving: an address, a mapping or a value it cannot know is left empty, and
 * the save check names it. A preset is offered only when the app has an object it fits.
 *
 * No time zone is set: the form fills in the maker's own, which they change to the client's.
 */
export function jobPresets(objects) {
  const list = (objects || []).filter((o) => o && o.id);
  if (!list.length) return [];
  const first = list[0];
  const out = [];
  const add = (id, title, text, job) => out.push({ id, title, text, job });

  add('pull_api', 'Get records from an API every 12 hours',
    `Calls an outside address and adds or updates ${first.name} records. You enter the address, the key and which value goes in which field.`,
    { job_key: 'pull_records', name: `Get ${first.name.toLowerCase()} from an outside service`, job_type: 'http_pull',
      schedule: { every_minutes: 720 },
      config: { url: '', method: 'GET', headers: { Accept: 'application/json' }, target_collection: first.id, field_map: {}, upsert_key: '' } });

  add('push_changes', 'Send new and changed records to an API every hour',
    `Sends ${first.name} records added or changed since the last run to an outside address. You enter the address and the key.`,
    { job_key: 'push_changes', name: `Send changed ${first.name.toLowerCase()} to an outside service`, job_type: 'http_push',
      schedule: { every_minutes: 60 },
      config: { url: '', method: 'POST', headers: {}, source_collection: first.id, fields: ownFields(first),
        filter: [], changed_since_last_run: true, batch_size: 100 } });

  const dated = list.find((o) => dateFields(o).length);
  if (dated) {
    const date = dateFields(dated)[0];
    const label = labelField(dated);
    const who = dated.userFields?.length ? { user_field: dated.userFields[0] } : 'owner';
    const whoText = dated.userFields?.length ? `the ${words(dated.userFields[0])} of each record` : 'the record\'s owner';
    const what = label ? `{${label}}` : dated.name;
    const day = words(date);
    add('remind_before', `Remind people 3 days before the ${day}`,
      `Every morning, tells ${whoText} about ${dated.name} records whose ${day} is 3 days away.`,
      { job_key: `remind_${date}`.slice(0, 40), name: `Remind before the ${day}`, job_type: 'reminder',
        schedule: { daily_at: '08:00' },
        config: { source_collection: dated.id, date_field: date, days: -3, notify: who, channels: ['in_app', 'email'],
          title: `${dated.name}: ${day} in 3 days`, message: `${what}: the ${day} is {${date}}.`, filter: [] } });
    add('remind_after', `Tell people the day after the ${day} passes`,
      `Every morning, tells ${whoText} about ${dated.name} records whose ${day} was yesterday.`,
      { job_key: `overdue_${date}`.slice(0, 40), name: `Tell when the ${day} has passed`, job_type: 'reminder',
        schedule: { daily_at: '08:00' },
        config: { source_collection: dated.id, date_field: date, days: 1, notify: who, channels: ['in_app', 'email'],
          title: `${dated.name}: ${day} has passed`, message: `${what}: the ${day} was {${date}}.`, filter: [] } });
  }

  const digestFields = ownFields(first).slice(0, 6);
  add('daily_digest', `Email the admins a list of ${first.name} every morning`,
    `At 08:00 every day, emails the company's admins the newest ${first.name} records, with a CSV file. Nothing is sent when there are none.`,
    { job_key: 'daily_list', name: `Daily list of ${first.name.toLowerCase()}`, job_type: 'email_digest',
      schedule: { daily_at: '08:00' },
      config: { source_collection: first.id, filter: [], fields: digestFields, sort: { field: 'created_ts', dir: 'desc' },
        max_rows: 200, to: { role: 'admins' }, subject: `${first.name}: today's list`, attach_csv: true, skip_when_empty: true } });
  add('weekly_digest', `Email the admins a list of ${first.name} every Monday`,
    `At 08:00 on Mondays, emails the company's admins the ${first.name} records, with a CSV file.`,
    { job_key: 'weekly_list', name: `Weekly list of ${first.name.toLowerCase()}`, job_type: 'email_digest',
      schedule: { weekly: { days: ['mon'], at: '08:00' } },
      config: { source_collection: first.id, filter: [], fields: digestFields, sort: { field: 'created_ts', dir: 'desc' },
        max_rows: 500, to: { role: 'admins' }, subject: `${first.name}: this week's list`, attach_csv: true, skip_when_empty: true } });

  const withStatus = list.find((o) => statusField(o));
  if (withStatus) {
    const status = statusField(withStatus);
    add('archive_old', `Mark ${withStatus.name} not changed in 90 days`,
      `Every night, sets ${words(status)} to archived on ${withStatus.name} records nobody has changed in 90 days. Change the value to one your app uses.`,
      { job_key: 'archive_old', name: `Archive old ${withStatus.name.toLowerCase()}`, job_type: 'housekeeping',
        schedule: { daily_at: '02:00' },
        config: { source_collection: withStatus.id, action: 'set', set: { [status]: 'archived' },
          filter: [{ field: 'updated_ts', op: 'older_than_days', value: 90 }, { field: status, op: 'ne', value: 'archived' }] } });
  }
  return out;
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
