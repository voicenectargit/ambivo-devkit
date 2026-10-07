#!/usr/bin/env node
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Name an app that was copied from the Ambivo Angular starter, in place.
// For agents without the Claude Code plugin; /ambivo-new-app does the same when it copies the starter.
//   node tools/ambivo-name.mjs --name "Stock Room" --key stockroom [folder]
//   npm run ambivo:name -- --name "Stock Room" --key stockroom
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const folder = resolve(argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) || '.');
const name = opt('name');
const key = opt('key');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!name || !key) fail('Usage: npm run ambivo:name -- --name "<App name>" --key <lowercase key>');
if (!/^[a-z][a-z0-9]{1,23}$/.test(key)) fail('--key must be 2 to 24 lowercase letters or digits, starting with a letter.');
const pkgPath = join(folder, 'package.json');
const cfgPath = join(folder, 'public/runtime-config/localhost.json');
const syncedPath = join(folder, 'src/ambivo/SYNCED_FROM_NX.json');
for (const p of [pkgPath, cfgPath, syncedPath]) {
  if (!existsSync(p)) fail(`${p} is missing. Run this in a copy of the Ambivo starter.`);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = key;
pkg.ambivo = { appKey: key, appName: name, starter: JSON.parse(readFileSync(syncedPath, 'utf8')).nx_commit };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.appName = name;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

console.log(`Named the app "${name}" (key ${key}) in ${folder}.`);
console.log('Anyone with an Ambivo account can sign in and sees only their own company.');
console.log('To limit it to one company, add "tenantId" to public/runtime-config/<host>.json.');
