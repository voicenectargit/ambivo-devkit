---
name: ambivo-app-jobs
description: Give an Ambivo app scheduled background jobs that Ambivo runs for it, with no server of the app's own. Use when the app must do something on a schedule or while nobody has it open - pull records from an outside service, push its records to one, remind people about due dates, email a list of records, clean up old records, or call the app's own webhook - and when writing src/install/app-jobs.json, the jobs part of install.mjs, or the secrets (API keys) a job sends.
---

# App jobs: scheduled work without a backend

An Ambivo app has no server of its own (the `ambivo-custom-objects` skill). When something must happen
on a schedule, or while nobody has the app open, Ambivo runs it as an **app job**. The app declares its
jobs in `src/install/app-jobs.json`, and the install step sends them to Ambivo with the app's custom
objects. A company admin turns each job on or off, runs it now, and sees its runs.

App jobs need the Pro plan. An app has at most 20 jobs, a company at most 50.

## When to add a job

| The app needs to | Job type |
|---|---|
| Copy records from an outside service into one of its objects (prices, weather, orders) | `http_pull` |
| Send its records to an outside service | `http_push` |
| Tell people when a record's date is near or past (due, expiry, follow-up) | `reminder` |
| Email a list of records every day or week | `email_digest` |
| Change or remove old records (expire, archive, purge) | `housekeeping` |
| Run its own code somewhere else on a schedule | `app_webhook` |

Prefer a built-in type. Use `app_webhook` only when no other type does the work: it needs a service
the client or partner must host, and that is a backend the app should not need. Ask the user first.

A job is for work on a schedule. Work that must happen when a record changes is an Ambivo workflow
(ask the user; see the workflows spec).

## Rules

- A job reads and writes **only the app's own custom objects**: every `source_collection` and
  `target_collection` starts with `<app_key>_` and is listed in `app-objects.json`.
- Field names in `field_map`, `fields`, `filter`, `date_field`, `sort` and `set` are fields of that
  object. A job never writes Ambivo's own fields: `id`, `tenant_id`, `userid`, `updated_by_userid`,
  `created_by`, `created_by_userid`, `updated_by`, `created_ts`, `updated_ts`, `access_dict`,
  `comments`, `file_ids_list`, `deleted`, or any field starting with `_`.
- Reminders and digests go to **people in the company only**: the record's owner, a user field on the
  record, named user ids, or the company's admins. Never an email address typed into the file.
- **No secret values in any file.** An API key, token or password is a *secret*: the file names it and
  the host it is for, and the company admin types the value in Ambivo or in Dev Studio's Deploy page.
  `headers` holds plain values only (like `Accept`); a key goes in `secret_headers`.
- Outside addresses are `https://` on a public host name. Never an IP address, `localhost`, `.local`
  or `.internal`.
- `job_key`: 2 to 40 lowercase letters, digits or `_`, starting with a letter, unique in the app. It is
  how a job is kept across installs: renaming it removes the old job and adds a new one.

## src/install/app-jobs.json

```json
{
  "app_key": "lab",
  "jobs": [
    { "job_key": "pull_prices", "name": "Pull supplier prices", "job_type": "http_pull",
      "schedule": { "every_minutes": 720 },
      "config": {
        "url": "https://api.supplier.example/v1/prices", "method": "GET",
        "headers": { "Accept": "application/json" },
        "secret_headers": { "X-Api-Key": "SUPPLIER_API_KEY" },
        "records_path": "data.items",
        "target_collection": "lab_price",
        "field_map": { "external_id": "id", "item_name": "name", "price": "price.amount" },
        "upsert_key": "external_id" } }
  ],
  "secrets": [
    { "name": "SUPPLIER_API_KEY", "host": "api.supplier.example", "label": "Supplier API key" }
  ]
}
```

- `app_key` is the same as in `app-objects.json`.
- `name` is what the admin sees. Plain words, under 80 characters.
- `secrets` lists every secret a job names: `name` (capital letters, digits and `_`, like
  `SUPPLIER_API_KEY`), the `host` it is sent to (exactly the host of the job's `url`), and a `label`
  the admin understands. Never a `value`.

### Schedule

One of:

```json
"schedule": { "every_minutes": 720 }
"schedule": { "daily_at": "08:00", "tz": "America/Chicago" }
"schedule": { "weekly": { "days": ["mon", "thu"], "at": "08:00" }, "tz": "Europe/Istanbul" }
```

- `every_minutes`: 15 to 10080 (one week).
- `daily_at` and `weekly.at`: `HH:MM`, 24-hour. `tz`: an IANA time zone name; `UTC` when left out.
  Ask the user which time zone the client works in.
- `days`: `mon tue wed thu fri sat sun`.

### Filter

`http_push`, `reminder`, `email_digest` and `housekeeping` take a `filter`: up to 10 conditions on the
source object's own fields, all of which must hold.

```json
"filter": [
  { "field": "status", "op": "eq", "value": "open" },
  { "field": "priority", "op": "in", "value": ["high", "urgent"] },
  { "field": "end_date", "op": "older_than_days", "value": 30 },
  { "field": "due_date", "op": "within_next_days", "value": 3 }
]
```

Ops: `eq ne lt lte gt gte in nin exists older_than_days within_next_days`.

### The job types and their config

**`http_pull`**: fetch a list from an outside address and add or update records.

```json
{ "url": "https://...", "method": "GET", "headers": {}, "secret_headers": { "X-Api-Key": "NAME" },
  "body": null, "records_path": "data.items", "target_collection": "lab_item",
  "field_map": { "<object field>": "<dotted path in each fetched item>" }, "upsert_key": "external_id" }
```

`method` is `GET` or `POST` (`body`, a JSON object or list, only with `POST`). `records_path` is where
the list sits in the answer; leave it out when the answer is the list. `upsert_key` is one of the
`field_map` fields: it finds the record to update, so the same item is never added twice. Up to 5,000
items a run.

**`http_push`**: send records to an outside address.

```json
{ "url": "https://...", "method": "POST", "headers": {}, "secret_headers": { "X-Api-Key": "NAME" },
  "source_collection": "lab_item", "filter": [], "fields": ["external_id", "title"],
  "changed_since_last_run": true, "batch_size": 100 }
```

`method` is `POST` or `PUT`. Each call's body is
`{"run_id", "app_key", "job_key", "records": [{...fields, "id"}]}`, one call per batch, at most 1,000
records a run.

**`reminder`**: tell people about records whose date is near or past.

```json
{ "source_collection": "lab_trial", "date_field": "due_date", "days": -3,
  "notify": "owner", "channels": ["in_app", "push", "email"],
  "title": "Trial due soon", "message": "{name} is due on {due_date}", "filter": [] }
```

`days`: -30 to 30. Negative is before the date, 0 on the day, positive after. `notify` is `"owner"`,
`{"user_field": "assigned_to"}` (a field holding a user id), `{"userids": ["..."]}` or
`{"role": "admins"}`. `{field}` in the title or message is replaced by that field's value. Each record
is reminded once for each date value.

**`email_digest`**: email a list of records.

```json
{ "source_collection": "lab_ticket", "filter": [], "fields": ["title", "status", "created_ts"],
  "sort": { "field": "created_ts", "dir": "desc" }, "max_rows": 200,
  "to": { "role": "admins" }, "subject": "Open tickets", "attach_csv": true, "skip_when_empty": true }
```

`to` is `{"userids": [...]}` or `{"role": "admins"}`. The email comes from Ambivo with the company's
name, and replies go to the company.

**`housekeeping`**: change or remove records that match.

```json
{ "source_collection": "lab_sample", "filter": [{ "field": "end_date", "op": "older_than_days", "value": 90 }],
  "action": "set", "set": { "status": "expired" } }
{ "source_collection": "lab_log", "filter": [{ "field": "created_ts", "op": "older_than_days", "value": 365 }],
  "action": "delete" }
```

At most 500 records a run. `delete` needs a filter. Tell the user plainly what a delete job removes.

**`app_webhook`**: Ambivo calls the address on the schedule, signed.

```json
{ "url": "https://myapp.example.com/hooks/nightly", "headers": {}, "secret_headers": {} }
```

The install's answer holds `signing_secrets.<job_key>` once, when the job is first made. The service
checks `X-Ambivo-Signature` = hex HMAC-SHA256(secret, `"<X-Ambivo-Timestamp>.<raw body>"`). install.mjs
prints that it was made and tells the admin to copy the secret to the service; it never writes it to a file.

## install.mjs: send the jobs after the objects

When `app-jobs.json` exists, `install.mjs` reads it next to itself and, after every object exists,
sends the whole list. The list replaces the app's jobs in that company: a job missing from it is
removed, and a job that stays keeps its on/off state.

```js
const jobsUrl = new URL('./app-jobs.json', import.meta.url);
if (existsSync(jobsUrl)) {
  const jobsCfg = JSON.parse(await readFile(jobsUrl, 'utf8'));
  // Older Ambivo servers read every_minutes on the job itself.
  const jobs = jobsCfg.jobs.map((j) => ({ ...j, ...(j.schedule?.every_minutes ? { every_minutes: j.schedule.every_minutes } : {}) }));
  const r = await api('PUT', `/app_job/app/${jobsCfg.app_key}`, { jobs });
  console.log(`jobs: ${r.data_list.length} installed`);
  for (const key of Object.keys(r.signing_secrets ?? {})) {
    console.log(`job ${key}: copy its signing secret from this run's answer to your service now. It is shown once.`);
  }
  const missing = (jobsCfg.secrets ?? []).map((s) => s.name);
  if (missing.length) console.log(`An admin must set these secrets before the jobs can run: ${missing.join(', ')}`);
}
```

- `api()` is the install step's own helper (Bearer `AMBIVO_TOKEN`, `AMBIVO_API_URL`). On an error, print
  Ambivo's `error.message` and `error_code`, and stop with exit code 1.
- `APP_JOB_REQUIRES_PRO`: the company is not on Pro. Print it plainly. The objects are installed already.
- A job type the server does not know yet is refused with Ambivo's message. Show it as it is.
- Never send secret values from install.mjs.

## Secrets: who sets them, and how

The company admin sets each value, in their own company:

```
PUT /app_job/secret/{app_key}/{name}   {"value": "<the key>", "host": "api.supplier.example"}
GET /app_job/secret/list?app_key=lab   names and hosts only; a value is never read back
```

- Dev Studio's **Jobs** dialog sets them in the partner's sandbox, and its **Deploy** page asks the
  client's admin for each one before Install. Neither keeps the value.
- A value is sent only to calls to its `host`. A job pointed at another host does not get it, and its
  runs are skipped until the admin sets the secret again for the new host.
- A run is skipped while a secret it needs is missing.

## Running, testing, cost

- An admin turns jobs on or off (`PATCH /app_job/{job_id}` `{"enabled"}`), runs one now
  (`POST /app_job/{job_id}/run`, about a minute), and lists runs (`GET /app_job/run/list`).
- Test each job in the sandbox: install, set the secrets, Run now, then read the run and the records.
- Pro includes 3,000 succeeded runs and 1,000 job emails a month for each company. After that a run
  costs $0.002 and an email $0.001. Failed, skipped and timed-out runs are free. Pick the longest
  schedule that works: every 12 hours, not every 15 minutes, for prices that change daily.

## Before you say it is done

- `npm run ambivo:check` passes. It checks app-jobs.json against app-objects.json and install.mjs.
- install.mjs was run against the sandbox twice; the second run changed nothing.
- Every secret the jobs name is set in the sandbox, and each job ran once with Run now and succeeded.
- The README says which jobs the app has, what each does, and which secrets the admin must set.
