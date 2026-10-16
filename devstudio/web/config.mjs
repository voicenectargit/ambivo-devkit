// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Dev Studio settings, read once from the environment.
//
// Laptop mode (DEVSTUDIO_PUBLIC_URL unset): 127.0.0.1, one user, no sign-in, as the prototype always ran.
// Server mode (DEVSTUDIO_PUBLIC_URL set): GitHub sign-in, projects owned per GitHub user, project
// containers on an internal network behind the egress proxy. See docs/HOSTING_PLAN.md.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A PEM key stored in an env file often has its newlines written as "\n". */
export function pem(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

/** The value Terraform puts in a secret until someone sets it by hand. It counts as not set. */
export const SECRET_PLACEHOLDER = 'SET-ME-OUT-OF-BAND';

/**
 * The Partner Program source. On only when tenant, email and password are all set; otherwise Dev Studio
 * keeps its own Access list. The password is not enumerable, so printing or serialising the config
 * does not show it.
 */
function partnerProgConfig(env, ambivoApi, region) {
  const val = (k) => { const v = String(env[k] || '').trim(); return v === SECRET_PLACEHOLDER ? '' : v; };
  const api = val('DEVSTUDIO_PARTNERPROG_API') || ambivoApi;
  const out = {
    tenant: val('DEVSTUDIO_PARTNERPROG_TENANT'),
    email: val('DEVSTUDIO_PARTNERPROG_EMAIL'),
    api: api.endsWith('/') ? api : `${api}/`,
    // The custom objects' collection ids. Overridable in case the app's objects are renamed.
    partnerCollection: val('DEVSTUDIO_PARTNERPROG_PARTNER_COLLECTION') || 'partnerprog_partner',
    personCollection: val('DEVSTUDIO_PARTNERPROG_PERSON_COLLECTION') || 'partnerprog_person',
  };
  Object.defineProperty(out, 'password', { value: String(env.DEVSTUDIO_PARTNERPROG_PASSWORD || '') === SECRET_PLACEHOLDER ? '' : String(env.DEVSTUDIO_PARTNERPROG_PASSWORD || ''), enumerable: false });
  out.on = !!(out.tenant && out.email && out.password);
  // Email each person when their access turns active (notify.mjs). Only with the source on. The sender
  // is fixed here, never taken from a record. An empty reply-to or configuration set leaves it out.
  const or = (k, d) => (env[k] === undefined ? d : String(env[k]).trim());
  out.notify = {
    on: out.on && String(env.DEVSTUDIO_PARTNERPROG_NOTIFY || '').trim().toLowerCase() === 'on',
    from: or('DEVSTUDIO_NOTIFY_FROM', '') || 'Ambivo Dev Studio <notification@mail.ambivo.com>',
    replyTo: or('DEVSTUDIO_NOTIFY_REPLY_TO', 'dev-partner@ambivo.com'),
    configurationSet: or('DEVSTUDIO_SES_CONFIGURATION_SET', 'ambivo-prod'),
    region,
    sesEndpoint: String(env.DEVSTUDIO_SES_ENDPOINT || ''),   // tests only: a fake SES
  };
  return out;
}

export function loadConfig(env = process.env) {
  const publicUrl = String(env.DEVSTUDIO_PUBLIC_URL || '').replace(/\/+$/, '');
  const serverMode = !!publicUrl;
  const cfg = {
    serverMode,
    publicUrl,
    port: Number(env.DEVSTUDIO_PORT || 4400),
    host: env.DEVSTUDIO_HOST || (serverMode ? '0.0.0.0' : '127.0.0.1'),
    data: env.DEVSTUDIO_DATA || join(HERE, 'data'),
    // Share links' built files. Caddy serves them on a server (infra/core/compose.yaml mounts this
    // folder read-only into Caddy), so they stay on this host's disk even when state is in S3.
    shares: env.DEVSTUDIO_SHARES || join(env.DEVSTUDIO_DATA || join(HERE, 'data'), 'shares'),
    image: env.DEVSTUDIO_IMAGE || 'ambivo-devstudio-runner:0.1',
    // 'docker': a container per project (the hosted Dev Studio, or a laptop with Docker). 'local': every
    // project runs right here, in its own folder under DEVSTUDIO_PROJECTS (Dev Studio inside the dev container).
    driver: String(env.DEVSTUDIO_DRIVER || 'docker').trim().toLowerCase(),
    projectsRoot: env.DEVSTUDIO_PROJECTS || '/work',
    // The ambivo-devkit plugin folder the assistant loads. The dev container keeps it under plugins/.
    plugin: env.DEVSTUDIO_PLUGIN || '/opt/ambivo-devkit',
    // What the page tells a laptop user to run to sign in to their Ambivo sandbox. Default: the plugin's own CLI.
    loginCommand: env.DEVSTUDIO_LOGIN_COMMAND || '',
    // A project container idle this long is saved and stopped; 0 turns it off. The local driver has no
    // containers, and its preview is used without Dev Studio seeing it, so it is always off there.
    idleMinutes: String(env.DEVSTUDIO_DRIVER || '').trim().toLowerCase() === 'local' ? 0
      : env.DEVSTUDIO_IDLE_MINUTES === undefined ? 30 : Number(env.DEVSTUDIO_IDLE_MINUTES),
    previewDomain: String(env.DEVSTUDIO_PREVIEW_DOMAIN || '').toLowerCase(),
    proxyUrl: env.DEVSTUDIO_PROXY_URL || '',
    network: env.DEVSTUDIO_NETWORK || '',
    allowed: String(env.DEVSTUDIO_ALLOWED_GITHUB || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // GitHub logins that see the Access page and change who may sign in.
    admins: String(env.DEVSTUDIO_ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    kmsKeyId: env.DEVSTUDIO_KMS_KEY_ID || '',
    kmsEndpoint: env.DEVSTUDIO_KMS_ENDPOINT || '',   // tests only: a fake KMS
    region: env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1',
    // Server mode: keep projects, histories, keys and project files in this S3 bucket instead of
    // DEVSTUDIO_DATA only, so a second server could run Dev Studio. Empty: everything stays local.
    s3Bucket: env.DEVSTUDIO_S3_BUCKET || '',
    s3Endpoint: env.DEVSTUDIO_S3_ENDPOINT || '',     // tests only: a fake S3
    sessionSecret: env.DEVSTUDIO_SESSION_SECRET || '',
    sessionHours: Number(env.DEVSTUDIO_SESSION_HOURS || 8),
    // A session in use is renewed for another sessionHours, up to this many days after signing in.
    sessionMaxDays: Number(env.DEVSTUDIO_SESSION_MAX_DAYS || 7),
    // Where partners sign in to their Ambivo sandbox (server mode). Tests point it at a fake.
    ambivoApi: env.DEVSTUDIO_AMBIVO_API || 'https://ingress.ambivo.com/',
    // Who may sign in beyond the floor, read from the Partner Program app in Ambivo (partnersource.mjs).
    partnerProg: partnerProgConfig(env, env.DEVSTUDIO_AMBIVO_API || 'https://ingress.ambivo.com/', env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1'),
    github: {
      appId: env.GITHUB_APP_ID || '',
      clientId: env.GITHUB_APP_CLIENT_ID || '',
      clientSecret: env.GITHUB_APP_CLIENT_SECRET || '',
      slug: env.GITHUB_APP_SLUG || '',
      privateKey: pem(env.GITHUB_APP_PRIVATE_KEY),
      // Overrides for a fake GitHub in tests and the local end-to-end run. Production uses the defaults.
      api: (env.DEVSTUDIO_GITHUB_API || 'https://api.github.com').replace(/\/+$/, ''),
      web: (env.DEVSTUDIO_GITHUB_WEB || 'https://github.com').replace(/\/+$/, ''),
      browserWeb: (env.DEVSTUDIO_GITHUB_BROWSER_WEB || env.DEVSTUDIO_GITHUB_WEB || 'https://github.com').replace(/\/+$/, ''),
    },
  };
  if (!['docker', 'local'].includes(cfg.driver)) throw new Error(`DEVSTUDIO_DRIVER must be docker or local, not ${cfg.driver}`);
  // The local driver runs every project as this process's own user, with no wall between them: one maker only.
  if (serverMode && cfg.driver === 'local') throw new Error('DEVSTUDIO_DRIVER=local is for one maker on their own computer, not server mode');
  if (!serverMode && cfg.s3Bucket) throw new Error('DEVSTUDIO_S3_BUCKET is for server mode only (set DEVSTUDIO_PUBLIC_URL too)');
  if (serverMode) {
    const missing = [];
    if (!cfg.previewDomain) missing.push('DEVSTUDIO_PREVIEW_DOMAIN');
    if (cfg.sessionSecret.length < 32) missing.push('DEVSTUDIO_SESSION_SECRET (32 characters or more)');
    if (!cfg.allowed.length) missing.push('DEVSTUDIO_ALLOWED_GITHUB');
    if (!cfg.github.clientId) missing.push('GITHUB_APP_CLIENT_ID');
    if (!cfg.github.clientSecret) missing.push('GITHUB_APP_CLIENT_SECRET');
    if (!cfg.network) missing.push('DEVSTUDIO_NETWORK');
    if (!cfg.proxyUrl) missing.push('DEVSTUDIO_PROXY_URL');
    // A record saved with the local key file opens only on the server that has that file.
    if (cfg.s3Bucket && !cfg.kmsKeyId) missing.push('DEVSTUDIO_KMS_KEY_ID (DEVSTUDIO_S3_BUCKET is set)');
    if (missing.length) throw new Error(`Server mode (DEVSTUDIO_PUBLIC_URL is set) needs: ${missing.join(', ')}`);
    cfg.secureCookies = publicUrl.startsWith('https://');
  }
  return cfg;
}
