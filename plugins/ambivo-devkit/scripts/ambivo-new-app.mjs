#!/usr/bin/env node
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Create a new app from the Ambivo Angular starter carried in this plugin.
//   ambivo-new-app.mjs <folder> --name "Stock Room" --key stockroom
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const starter = join(dirname(fileURLToPath(import.meta.url)), '..', 'starter');
const argv = process.argv.slice(2);
const folder = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const name = opt('name');
const key = opt('key');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!folder || !name || !key) fail('Usage: ambivo-new-app.mjs <folder> --name "<App name>" --key <lowercase key>');
if (!/^[a-z][a-z0-9]{1,23}$/.test(key)) fail('--key must be 2 to 24 lowercase letters or digits, starting with a letter.');
if (!existsSync(starter)) fail(`The starter is missing from the plugin (${starter}).`);
const dest = resolve(folder);
if (existsSync(dest) && readdirSync(dest).length) fail(`${dest} already exists and is not empty.`);

const skip = new Set(['node_modules', 'dist', '.angular', '.DS_Store']);
cpSync(starter, dest, { recursive: true, filter: (src) => !skip.has(basename(src)) });
// The plugin is installed read-only (in Dev Studio it is mounted that way), and cpSync keeps
// file modes, so the new app came out read-only. The app is the developer's to edit.
(function makeWritable(p) {
  const st = statSync(p);
  chmodSync(p, st.mode | (st.isDirectory() ? 0o700 : 0o600));
  if (st.isDirectory()) for (const name of readdirSync(p)) makeWritable(join(p, name));
})(dest);

const pkgPath = join(dest, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = key;
pkg.ambivo = { appKey: key, appName: name, starter: JSON.parse(readFileSync(join(dest, 'src/ambivo/SYNCED_FROM_NX.json'), 'utf8')).nx_commit };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const cfgPath = join(dest, 'public/runtime-config/localhost.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.appName = name;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

console.log(`Created ${dest} from the Ambivo starter.`);
console.log('Next:');
console.log(`  cd ${folder} && npm install && npm start`);
console.log('  Anyone with an Ambivo account can sign in and sees only their own company. To limit it to one company, add "tenantId" to public/runtime-config/<host>.json.');
