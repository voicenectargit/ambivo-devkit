// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Dev Studio: a browser page in front of headless Claude Code, one Docker container per project.
//
//   node devstudio/web/server.mjs        then open http://127.0.0.1:4400
//
// Laptop mode (default): 127.0.0.1, one user, no sign-in.
// Server mode: set DEVSTUDIO_PUBLIC_URL and the settings in docs/HOSTING_PLAN.md
// ("Contract between the app and the infrastructure"). Run it behind infra/core (Caddy + egress proxy).
// With DEVSTUDIO_S3_BUCKET set, state lives in S3 (records, histories, project files); without it,
// in DEVSTUDIO_DATA on this host only.
import http from 'node:http';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { createAccess } from './access.mjs';
import { createPartnerSource } from './partnersource.mjs';
import { createLocalObjects } from './objects.mjs';
import { createApp } from './app.mjs';
import { createDockerDriver } from './drivers/docker.mjs';
import { createLocalDriver } from './drivers/local.mjs';
import { createKeyStore } from './keystore.mjs';
import { createKms, credentialSource } from './kms.mjs';
import { createGitHub } from './github.mjs';
import { createS3Objects } from './s3.mjs';
import { createObjectProjects } from './projects.mjs';
import { createProjectFiles } from './projectfiles.mjs';
import { migrateRecords, migrateFiles } from './migrate.mjs';

const config = loadConfig();
const credentials = credentialSource();
const driver = config.driver === 'local'
  ? createLocalDriver({ root: config.projectsRoot })
  : createDockerDriver(config.serverMode ? { network: config.network, proxyUrl: config.proxyUrl } : {});
const kms = config.kmsKeyId
  ? { keyId: config.kmsKeyId, client: createKms({ region: config.region, endpoint: config.kmsEndpoint, credentials }) }
  : null;
const objects = config.s3Bucket
  ? createS3Objects({ bucket: config.s3Bucket, region: config.region, endpoint: config.s3Endpoint, credentials })
  : null;
const keys = createKeyStore({ dataDir: config.data, kms, objects });
// Ambivo sandbox sessions (server mode): same encryption, own folder and purpose.
// OpenAI keys for Codex projects: same encryption, own folder and purpose.
const openaiKeys = createKeyStore({ dataDir: config.data, kms, folder: 'openai', purpose: 'openai-key', objects });
const ambivoSessions = config.serverMode ? createKeyStore({ dataDir: config.data, kms, folder: 'ambivo', purpose: 'ambivo-session', objects }) : null;
// Server mode: each session's GitHub user token, and the emailed-code step of an Ambivo sign-in. In the
// store (not memory), so a restart or a second server keeps them. Same encryption, own folder and purpose.
const githubTokens = config.serverMode ? createKeyStore({ dataDir: config.data, kms, folder: 'github', purpose: 'github-token', objects }) : null;
const ambivoPending = config.serverMode ? createKeyStore({ dataDir: config.data, kms, folder: 'ambivo-pending', purpose: 'ambivo-pending', objects }) : null;
// Deploy links (server mode): a client admin's Ambivo session between sign-in and Install, and their
// emailed-code step. Keyed by the link's hash, removed after the install. Same encryption, own purpose.
const deploySessions = config.serverMode ? createKeyStore({ dataDir: config.data, kms, folder: 'deploy-session', purpose: 'ambivo-deploy', objects }) : null;
const deployPending = config.serverMode ? createKeyStore({ dataDir: config.data, kms, folder: 'deploy-pending', purpose: 'ambivo-deploy-pending', objects }) : null;
const github = config.serverMode ? createGitHub(config.github) : null;
if (config.serverMode && keys.backend === 'local') console.log('WARNING: DEVSTUDIO_KMS_KEY_ID is empty; Claude keys use a local key file (development only).');

const projectStore = objects ? createObjectProjects({ objects }) : null;
const files = objects ? createProjectFiles({ objects, driver, image: config.image, tmpDir: join(config.data, 'tmp') }) : null;

// First start with S3: copy this host's records up before serving, so nobody sees an empty list.
const migration = objects ? await migrateRecords({ dataDir: config.data, objects }) : null;

// Who may sign in beyond DEVSTUDIO_ALLOWED_GITHUB: kept with the state (S3); staff manage it in the Partner Program app.
// Entries carry each GitHub account's numeric id, looked up when saved; older entries get theirs here.
// With DEVSTUDIO_PARTNERPROG_* set, the list comes from the Partner Program app instead (read every 5 minutes).
const partnerSource = config.partnerProg.on
  ? createPartnerSource({ config, objects: objects || createLocalObjects(config.data), lookup: github ? (name) => github.lookup(name) : null, credentials })
  : null;
if (partnerSource) console.log(`access: from the Partner Program (tenant ${config.partnerProg.tenant}, ${config.partnerProg.key ? 'with a service key' : `user ${config.partnerProg.email}`})`);
if (partnerSource) console.log(config.partnerProg.notify.on
  ? `access: emails each person whose access turns active, from ${config.partnerProg.notify.from} through SES (${config.partnerProg.notify.region})`
  : 'access: no access emails (DEVSTUDIO_PARTNERPROG_NOTIFY is not on)');
const access = createAccess({ objects, dataDir: config.data, lookup: github ? (name, token) => github.lookup(name, token) : null, source: partnerSource });
access.backfill().then((n) => n && console.log(`access: ${n} entries now matched by GitHub id`), (err) => console.error(`access backfill: ${err.message}`));
const { handler, stopIdle, restoreShares, accessToken } = createApp({ config, driver, keys, openaiKeys, github, ambivoSessions, githubTokens, ambivoPending, deploySessions, deployPending, projectStore, files, access, partnerSource, objects });
// Save and stop project containers nobody has used for config.idleMinutes (default 30).
if (config.idleMinutes > 0) {
  setInterval(() => stopIdle().catch((err) => console.error(`idle stop: ${err.message}`)), 5 * 60_000).unref();
}
const server = http.createServer(handler).listen(config.port, config.host, () => {
  // Without an id a list item matches by name, which a renamed GitHub account frees for someone else.
  // Terraform refuses such a list; a hand-made settings file does not, so say it here.
  const bare = config.serverMode ? [...config.admins, ...config.allowed].filter((x) => !/:\d+$/.test(x)) : [];
  if (bare.length) console.warn(`access: these have no GitHub id and match by name only: ${bare.join(', ')}. Use name:id.`);
  console.log(config.serverMode
    ? `Dev Studio (server mode) on ${config.host}:${config.port} for ${config.publicUrl}; keys: ${keys.backend}; state: ${objects ? `s3://${config.s3Bucket}` : config.data}`
    : `Dev Studio on http://localhost:${config.port}${driver.kind === 'local' ? `, projects in ${config.projectsRoot}` : ''}`);
  // In the dev container the browser reaches Dev Studio through Docker, so it needs the link with the secret.
  if (!config.serverMode && !/^(127\.|localhost$|::1$)/.test(config.host)) console.log(`Open Dev Studio: http://localhost:${config.port}/?token=${accessToken}`);
  // Project volumes take longer; they go up in the background.
  if (migration && !migration.skipped) {
    migrateFiles({ dataDir: config.data, objects, files, driver, ids: migration.projects })
      .catch((err) => console.log(`migration to S3: ${err.message}`));
  }
  // Share links that are on but have no files on this host (a new host, a lost disk): put them back
  // from their copy in S3. Caddy serves share files from disk only, so this is what brings them back.
  if (objects) {
    restoreShares().then((n) => n && console.log(`shares: ${n} restored from storage`), (err) => console.error(`shares restore: ${err.message}`));
  }
});

// On stop (a release recreates this container): save unsaved history and finish file saves.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    const quit = setTimeout(() => process.exit(0), 8000);
    try { await projectStore?.flushAll(); await files?.idle(); } catch (err) { console.log(`stopping: ${err.message}`); }
    clearTimeout(quit);
    process.exit(0);
  });
}
