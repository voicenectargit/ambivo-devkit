#!/usr/bin/env node
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Look up Ambivo API operations in the specs published at https://apidocs.ambivo.com.
// The plugin carries a JSON copy of every spec (specs/*.json, built by tools/build_plugin.py),
// so this works offline and needs no packages.
//
//   ambivo-spec.mjs list
//   ambivo-spec.mjs find <words...> [--spec <id>] [--limit N]
//   ambivo-spec.mjs get <METHOD> <path> [--spec <id>]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'specs');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function loadSpecs(only) {
  if (!existsSync(root)) fail(`No spec copy at ${root}. Rebuild the plugin with tools/build_plugin.py.`);
  const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
  const ids = only ? [only] : index.specs.map((s) => s.id);
  for (const id of ids) if (!index.specs.find((s) => s.id === id)) fail(`Unknown spec "${id}". Run: list`);
  return {
    index,
    specs: ids.map((id) => ({ id, doc: JSON.parse(readFileSync(join(root, `${id}.json`), 'utf8')) })),
  };
}

function args() {
  const out = { _: [], spec: undefined, limit: 15 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--spec') out.spec = a[++i];
    else if (a[i] === '--limit') out.limit = Number(a[++i]) || 15;
    else out._.push(a[i]);
  }
  return out;
}

function* operations(spec) {
  for (const [path, item] of Object.entries(spec.doc.paths ?? {})) {
    for (const m of METHODS) if (item[m]) yield { path, method: m.toUpperCase(), op: item[m], item };
  }
}

// Resolve local $refs, stopping at cycles and at a fixed depth so output stays readable.
function resolve(node, doc, depth = 0, seen = new Set()) {
  if (Array.isArray(node)) return node.map((n) => resolve(n, doc, depth, seen));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    if (seen.has(node.$ref) || depth > 6) return { $ref: node.$ref };
    const target = node.$ref.slice(2).split('/').reduce((o, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
    return resolve(target, doc, depth + 1, new Set([...seen, node.$ref]));
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(v, doc, depth, seen)]));
}

function isDeprecated(op) {
  return op.deprecated === true || /^\s*deprecated\b/i.test(op.description ?? '') || /^\s*deprecated\b/i.test(op.summary ?? '');
}

const a = args();
const [cmd, ...rest] = a._;

if (cmd === 'list') {
  const { index } = loadSpecs();
  console.log(`Specs from ambivo-api-docs ${index.docs_commit} (copied ${index.built_at})\n`);
  for (const s of index.specs) console.log(`${s.id.padEnd(26)} ${String(s.operations).padStart(4)} ops  ${s.title}`);
} else if (cmd === 'find') {
  if (!rest.length) fail('Usage: find <words...> [--spec id]');
  const words = rest.map((w) => w.toLowerCase());
  const hits = [];
  for (const spec of loadSpecs(a.spec).specs) {
    for (const { path, method, op, item } of operations(spec)) {
      const head = `${method} ${path}`.toLowerCase();
      const text = `${op.summary ?? ''} ${op.operationId ?? ''} ${(op.tags ?? []).join(' ')} ${op.description ?? ''}`.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (head.includes(w)) score += 3;
        else if (text.includes(w)) score += 1;
        else { score = -1; break; }
      }
      if (score > 0) {
        const old = isDeprecated(op) ? '  [DEPRECATED: do not use]' : '';
        // Deprecated operations sort last, so the current route is the first hit.
        const host = ((op.servers ?? item.servers)?.[0]?.url) || '';
        const other = host && !host.includes('ingress.ambivo.com') ? `  [served by ${host}]` : '';
        hits.push({ score: old ? score - 100 : score, line: `${method.padEnd(6)} ${path}  [${spec.id}]  ${op.summary ?? ''}${other}${old}` });
      }
    }
  }
  hits.sort((x, y) => y.score - x.score);
  if (!hits.length) console.log('No operation matches all of those words. Try fewer or different words.');
  for (const h of hits.slice(0, a.limit)) console.log(h.line);
  if (hits.length > a.limit) console.log(`... ${hits.length - a.limit} more. Add words or --spec to narrow.`);
} else if (cmd === 'get') {
  const [method, path] = rest;
  if (!method || !path) fail('Usage: get <METHOD> <path> [--spec id]');
  const found = [];
  for (const spec of loadSpecs(a.spec).specs) {
    const item = spec.doc.paths?.[path];
    const op = item?.[method.toLowerCase()];
    if (op) found.push({ spec, item, op });
  }
  if (!found.length) fail(`No ${method.toUpperCase()} ${path} in the specs. Use "find" to search.`);
  for (const { spec, item, op } of found) {
    const out = resolve(
      {
        spec: spec.id,
        operation: `${method.toUpperCase()} ${path}`,
        // Some operations live on another host (e.g. /kh/* on vectordbapi.ambivo.com). Always call THIS server.
        server: ((op.servers ?? item.servers ?? spec.doc.servers ?? [])[0] || {}).url,
        ...(isDeprecated(op) ? { DEPRECATED: 'Do not use. The description names the replacement.' } : {}),
        summary: op.summary,
        description: op.description,
        parameters: [...(item.parameters ?? []), ...(op.parameters ?? [])],
        requestBody: op.requestBody,
        responses: op.responses,
      },
      spec.doc,
    );
    console.log(JSON.stringify(out, null, 2));
  }
} else {
  fail('Usage: ambivo-spec.mjs list | find <words...> [--spec id] | get <METHOD> <path> [--spec id]');
}
