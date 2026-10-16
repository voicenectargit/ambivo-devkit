// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// One-time move of a server's local state into the shared object store (S3), on the first start with
// DEVSTUDIO_S3_BUCKET set.
//
//   records  DEVSTUDIO_DATA/{keys,ambivo,openai}/*.json     -> {keys,ambivo,openai}/<uid>.json
//            DEVSTUDIO_DATA/projects.json                    -> projects/<id>.json, owners/<uid>/<id>,
//                                                               projects/<id>/events.jsonl
//   files    each project's volumes on this host             -> projects/<id>/{work,claude}.tar.gz
//
// Every upload is a create (If-None-Match: *): an object already in the bucket is never replaced, so
// a newer copy saved by any server wins, and running this again uploads nothing. The local files are
// left where they are (a way back). When it has finished, DEVSTUDIO_DATA/s3-migrated.json records the
// bucket, so later starts skip the scan; deleting that file runs it again, harmlessly.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictError } from './objects.mjs';

const MARKER = 's3-migrated.json';

async function createOnce(objects, key, body, contentType) {
  if (await objects.head(key)) return false;
  try { await objects.put(key, body, { ifNoneMatch: '*', contentType }); return true; }
  catch (err) { if (err instanceof ConflictError) return false; throw err; }
}

/** Records only (fast). Returns the projects found, for migrateFiles. */
export async function migrateRecords({ dataDir, objects, log = console.log }) {
  const marker = join(dataDir, MARKER);
  if (existsSync(marker)) {
    try {
      const m = JSON.parse(readFileSync(marker, 'utf8'));
      if (m.bucket === objects.bucket && m.files) { log(`migration to S3: done before (${m.at}); skipped`); return { skipped: true, projects: [] }; }
    } catch {}
  }
  const counts = { keys: 0, ambivo: 0, openai: 0, projects: 0, events: 0, existing: 0 };
  for (const folder of ['keys', 'ambivo', 'openai']) {
    let names = [];
    try { names = readdirSync(join(dataDir, folder)).filter((n) => /^[A-Za-z0-9_-]{1,64}\.json$/.test(n)); } catch {}
    for (const n of names) {
      if (await createOnce(objects, `${folder}/${n}`, readFileSync(join(dataDir, folder, n)), 'application/json')) counts[folder]++;
      else counts.existing++;
    }
  }
  let projects = {};
  try { projects = JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')); } catch {}
  const ids = Object.keys(projects).filter((id) => /^[a-f0-9]{12}$/.test(id));
  for (const id of ids) {
    const { events = [], ...rec } = projects[id];
    if (await createOnce(objects, `projects/${id}.json`, JSON.stringify(rec), 'application/json')) counts.projects++;
    else counts.existing++;
    // The marker is created even when the record was already there: a half-finished earlier run.
    await createOnce(objects, `owners/${rec.owner?.id ?? 'local'}/${id}`, '', 'text/plain');
    const body = events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
    if (events.length && await createOnce(objects, `projects/${id}/events.jsonl`, body, 'application/x-ndjson')) counts.events++;
  }
  log(`migration to S3: uploaded ${counts.keys} Claude keys, ${counts.openai} OpenAI keys, ${counts.ambivo} Ambivo sessions, ${counts.projects} projects, ${counts.events} histories; ${counts.existing} were already there`);
  writeFileSync(marker, JSON.stringify({ bucket: objects.bucket, at: new Date().toISOString(), records: counts, files: false }, null, 2));
  return { skipped: false, projects: ids };
}

/** Project volumes (slower: one tar per volume). Run after the server is listening. */
export async function migrateFiles({ dataDir, objects, files, driver, ids, log = console.log }) {
  let uploaded = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      if (!(await driver.hasVolume(id))) continue;
      if (await files.saveNow(id, { onlyIfMissing: true })) uploaded++;
    } catch (err) {
      failed++;
      log(`migration to S3: project ${id} files: ${err.message}`);
    }
  }
  log(`migration to S3: uploaded files of ${uploaded} projects${failed ? `; ${failed} failed and are tried again on the next start` : ''}`);
  const marker = join(dataDir, MARKER);
  let m = {};
  try { m = JSON.parse(readFileSync(marker, 'utf8')); } catch {}
  writeFileSync(marker, JSON.stringify({ ...m, bucket: objects.bucket, at: new Date().toISOString(), files: failed === 0, filesUploaded: uploaded }, null, 2));
}
