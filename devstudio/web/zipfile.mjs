// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// A small zip writer (deflate, no zip64): enough for a project's source files, built in memory.
// Used for the client copy of "Download zip", whose files are filtered and rewritten here, outside
// the container. The developer copy is still zipped in the container (drivers/docker.mjs exportZip).
import { deflateRawSync, crc32 } from 'node:zlib';

/** DOS date and time for the zip headers. */
function dos(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** files: [{ path, content: Buffer, mode?: '100755' | '100644' }] -> the zip as a Buffer. */
export function zipFiles(files, when = new Date()) {
  const { time, date } = dos(when);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    const packed = deflateRawSync(data);
    const stored = packed.length >= data.length;
    const body = stored ? data : packed;
    const crc = crc32(data);
    const method = stored ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);   // made by Unix, so the file mode below is read
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((f.mode === '100755' ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// What a client does not need: the agent's rules, the dev kit's tools, the design brief and the phase
// plan with its handoff notes, the dev server's relay, and the package.json scripts that run those tools.
// .ambivo/ holds the partner's sandbox sample-data manifest and seed scripts, with sandbox record ids.
export const CLIENT_LEAVE_OUT = ['AGENTS.md', 'tools/', '.ambivo/', 'docs/APP_BRIEF.md', 'docs/DATA_MODEL.md', 'docs/PHASES.md', 'docs/phases/', 'proxy.conf.json'];
// Outside the app folder: the client's own brief file(s), as uploaded to Dev Studio.
export const CLIENT_LEAVE_OUT_TOP = ['brief/'];
export const CLIENT_SCRIPTS_LEAVE_OUT = ['ambivo:check', 'ambivo:name', 'ambivo:screenshot'];

/**
 * The client copy of a project's files (paths as in the zip). The app's folder is the one with
 * package.json: `app/` in Dev Studio, or the top. Only the copy changes; the project is untouched.
 */
export function clientFiles(files) {
  const pre = files.some((f) => f.path === 'app/package.json') ? 'app/' : '';
  const out = [];
  for (const f of files) {
    if (pre && CLIENT_LEAVE_OUT_TOP.some((x) => f.path.startsWith(x))) continue;
    if (!f.path.startsWith(pre)) { out.push(f); continue; }
    const rel = f.path.slice(pre.length);
    if (CLIENT_LEAVE_OUT.some((x) => (x.endsWith('/') ? rel.startsWith(x) : rel === x))) continue;
    if (rel === 'angular.json') {
      // proxy.conf.json is left out, so `ng serve` must not ask for it.
      try {
        const ng = JSON.parse(f.content.toString('utf8'));
        for (const p of Object.values(ng.projects || {})) delete p?.architect?.serve?.options?.proxyConfig;
        out.push({ ...f, content: Buffer.from(`${JSON.stringify(ng, null, 2)}\n`) });
        continue;
      } catch { /* not JSON: keep it as it is */ }
    }
    if (rel === 'package.json') {
      try {
        const pkg = JSON.parse(f.content.toString('utf8'));
        for (const s of CLIENT_SCRIPTS_LEAVE_OUT) if (pkg.scripts) delete pkg.scripts[s];
        out.push({ ...f, content: Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`) });
        continue;
      } catch { /* not JSON: keep it as it is */ }
    }
    out.push(f);
  }
  return out;
}
