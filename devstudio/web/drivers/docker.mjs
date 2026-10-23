// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Container driver: Docker on the same host, through the docker CLI.
//
// One container per project, with two volumes:
//   ds-<id>         -> /work              the app's files
//   ds-<id>-claude  -> /home/dev/.claude  Claude Code's session, so a conversation survives the container
//
// Laptop mode: port 4200 (the app's preview) is published on a free laptop port, 127.0.0.1 only.
// Server mode (network set): the container joins the internal project network, publishes no ports,
// and reaches the internet only through the egress proxy. The preview is <container>:4200 on that network.
//
// Every driver offers the same operations, so a second one (Fargate, another host) can replace it:
//   create, ensureRunning, recreate, remove, exec, sh, writeFile, readFile, previewTarget, exportZip, exportTar,
//   hasVolume, exportVolume, importVolume (saving a project to storage and restoring it elsewhere)
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

export const PREVIEW_PORT = 4200;
export const containerName = (id) => `ds-${id}`;
const sessionVolume = (id) => `ds-${id}-claude`;

// What never leaves the project: the zip, the GitHub push and the bundle script skip the same things.
export const EXPORT_EXCLUDES = ['node_modules', 'dist', '.angular', '.git', '.idea', '.vscode', '.DS_Store', 'coverage', '.claude', '.env*', '*.zip'];

// What a saved copy of /work leaves out: things `npm install` and a build make again. Unlike the
// zip it keeps .git (the project's own history), .claude and .env files: it is the project itself.
export const VOLUME_EXCLUDES = ['node_modules', 'dist', '.angular', 'coverage'];
// Where each saved part is mounted, as in a project container (a new volume copies the image's
// owner for that folder, so restored files belong to the dev user).
export const VOLUME_PARTS = { work: { volume: containerName, path: '/work' }, claude: { volume: sessionVolume, path: '/home/dev/.claude' } };

/** A throwaway container from the runner image, with one project volume and nothing else. */
export function volumeHelperArgs(id, part, image, mode) {
  const p = VOLUME_PARTS[part];
  if (!p) throw new Error(`unknown part ${part}`);
  const args = ['run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--label', 'ambivo.devstudio.helper=1'];
  if (mode === 'import') args.push('-i', '-v', `${p.volume(id)}:${p.path}`);
  else args.push('-v', `${p.volume(id)}:${p.path}:ro`);
  args.push('--entrypoint', 'tar', image, '-C', p.path);
  if (mode === 'import') args.push('-xf', '-');
  else args.push('-cf', '-', ...(part === 'work' ? VOLUME_EXCLUDES.map((x) => `--exclude=${x}`) : []), '.');
  return args;
}

/** Settings a project container gets in server mode, so every tool in it goes through the proxy. */
export function proxyEnv(proxyUrl) {
  if (!proxyUrl) return [];
  const noProxy = 'localhost,127.0.0.1,::1';
  return [
    `HTTPS_PROXY=${proxyUrl}`, `HTTP_PROXY=${proxyUrl}`, `https_proxy=${proxyUrl}`, `http_proxy=${proxyUrl}`,
    `NO_PROXY=${noProxy}`, `no_proxy=${noProxy}`,
    'NODE_USE_ENV_PROXY=1', // Node's own fetch (the Ambivo MCP server) honours the proxy only with this
  ];
}

export function createDockerDriver({ network = '', proxyUrl = '', docker = 'docker' } = {}) {
  const run = promisify(execFile);
  const serverMode = !!network;

  async function exists(kind, name) {
    try { await run(docker, [kind, 'inspect', name]); return true; } catch { return false; }
  }

  /** opts.npmCache: the npm cache volume (default ds-npm-cache, shared by projects; app reviews use their own). */
  async function create(id, image, { npmCache = 'ds-npm-cache' } = {}) {
    for (const v of [containerName(id), sessionVolume(id), npmCache]) await run(docker, ['volume', 'create', v]);
    const args = [
      'run', '-d', '--name', containerName(id),
      // 4 GB, plus up to 2 GB of host swap. At 3 GB a live preview, a production build and screenshots
      // together hit the cap; the kernel killed processes and Claude Code (Bun) aborted with exit 134.
      '--memory', '4g', '--memory-swap', '6g', '--cpus', '2', '--pids-limit', '512',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '-v', `${containerName(id)}:/work`,
      '-v', `${sessionVolume(id)}:/home/dev/.claude`,
      '-v', `${npmCache}:/home/dev/.npm`,
      '--label', 'ambivo.devstudio=1',
    ];
    if (serverMode) {
      args.push('--network', network);
      for (const e of proxyEnv(proxyUrl)) args.push('-e', e);
    } else {
      args.push('-p', `127.0.0.1::${PREVIEW_PORT}`);
    }
    args.push(image);
    await run(docker, args);
  }

  /**
   * Make sure the project's container is running before a message runs in it.
   * Returns what it had to do: 'running' | 'started' | 'recreated'.
   * 'recreated' keeps the app's files; the conversation survives only if the session volume exists.
   */
  async function ensureRunning(id, image) {
    const name = containerName(id);
    if (await exists('container', name)) {
      const { stdout } = await run(docker, ['inspect', '-f', '{{.State.Running}}', name]);
      if (stdout.trim() === 'true') return { state: 'running', sessionKept: true };
      await run(docker, ['start', name]);
      return { state: 'started', sessionKept: true };
    }
    const hadSession = await exists('volume', sessionVolume(id));
    await create(id, image);
    return { state: 'recreated', sessionKept: hadSession };
  }

  /**
   * Was the container made from the image `image` names now? A release moves the tag to a new image,
   * with new skills. When either side cannot be read, say yes: never rebuild on a guess.
   */
  async function isCurrent(id, image) {
    try {
      const [{ stdout: have }, { stdout: want }] = await Promise.all([
        run(docker, ['inspect', '-f', '{{.Image}}', containerName(id)]),
        run(docker, ['image', 'inspect', '-f', '{{.Id}}', image]),
      ]);
      return !have.trim() || !want.trim() || have.trim() === want.trim();
    } catch { return true; }
  }

  /** Files and conversation live in volumes and are kept. */
  async function recreate(id, image) {
    await run(docker, ['rm', '-f', containerName(id)]);
    await create(id, image);
  }

  async function remove(id) {
    await run(docker, ['rm', '-f', containerName(id)]).catch(() => {});
    for (const v of [containerName(id), sessionVolume(id)]) await run(docker, ['volume', 'rm', v]).catch(() => {});
  }

  /**
   * Run a command in the container and stream it. Secrets go in `env` (name -> value): the docker CLI
   * gets them in its own environment and passes them by name (-e NAME), so they never appear in argv.
   */
  function exec(id, argv, { env = {}, workdir, interactive = true } = {}) {
    const args = ['exec'];
    if (interactive) args.push('-i');
    if (workdir) args.push('-w', workdir);
    for (const name of Object.keys(env)) args.push('-e', name);
    args.push(containerName(id), ...argv);
    return spawn(docker, args, { env: { ...process.env, ...env } });
  }

  /** A short shell command in the container; resolves with { stdout }. */
  function sh(id, cmd, { detach = false, workdir } = {}) {
    const args = ['exec'];
    if (detach) args.push('-d');
    if (workdir) args.push('-w', workdir);
    args.push(containerName(id), 'sh', '-c', cmd);
    return run(docker, args, { maxBuffer: 1 << 20 });
  }

  /** Write a file into the container (as its dev user), making its folder. The content goes on stdin. */
  function writeFile(id, path, content) {
    return new Promise((resolve, reject) => {
      const child = spawn(docker, ['exec', '-i', containerName(id), 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', path]);
      let err = '';
      child.stderr.on('data', (c) => { err += c; });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`writing ${path}: exit ${code} ${err.slice(-200)}`.trim()))));
      child.stdin.end(content);
    });
  }

  /** A file from the container as a Buffer, or null when it is not there. Small files only (4 MB). */
  async function readFile(id, path) {
    try {
      const { stdout } = await run(docker, ['exec', containerName(id), 'cat', path], { encoding: 'buffer', maxBuffer: 4 << 20 });
      return stdout;
    } catch { return null; }
  }

  /** host:port that reaches the app's preview, or null (laptop: a container made before previews). */
  async function previewTarget(id) {
    if (serverMode) return `${containerName(id)}:${PREVIEW_PORT}`;
    try {
      const { stdout } = await run(docker, ['port', containerName(id), `${PREVIEW_PORT}/tcp`]);
      const m = stdout.match(/:(\d+)\s*$/m);
      return m ? `127.0.0.1:${m[1]}` : null;
    } catch { return null; }
  }

  /** True when something answers on the preview port inside the container. */
  function previewReady(id) {
    return sh(id, `node -e "require('http').get('http://127.0.0.1:${PREVIEW_PORT}',()=>process.exit(0)).on('error',()=>process.exit(1))"`)
      .then(() => true, () => false);
  }

  /** The project's files as a zip stream (child process; read stdout). */
  function exportZip(id) {
    const x = [...EXPORT_EXCLUDES.flatMap((p) => [p, `${p}/*`, `*/${p}`, `*/${p}/*`]), '*.env*']
      .map((p) => `"${p}"`).join(' ');
    return spawn(docker, ['exec', containerName(id), 'sh', '-c', `cd /work && zip -qr - . -x ${x}`]);
  }

  /** The app's files (/work/app, or /work when there is no app folder) as a pax tar stream. */
  function exportTar(id) {
    const x = EXPORT_EXCLUDES.map((p) => `--exclude='${p}'`).join(' ');
    return spawn(docker, ['exec', containerName(id), 'sh', '-c',
      `if [ -d /work/app ]; then cd /work/app; else cd /work; fi; exec tar --format=pax -cf - ${x} .`]);
  }

  /** True when the project's files volume exists on this host. */
  function hasVolume(id) { return exists('volume', containerName(id)); }

  /** A volume ('work' or 'claude') as a plain tar stream (child process; read stdout). Works with the
   *  project container running, stopped or gone, as long as the volume is there. */
  function exportVolume(id, part, image) {
    return spawn(docker, volumeHelperArgs(id, part, image, 'export'));
  }

  /** Unpack a tar stream (write it to stdin) into a volume, creating the volume if needed. */
  function importVolume(id, part, image) {
    return spawn(docker, volumeHelperArgs(id, part, image, 'import'));
  }

  /** True when the project's container exists and is running. */
  async function isRunning(id) {
    try {
      const { stdout } = await run(docker, ['inspect', '-f', '{{.State.Running}}', containerName(id)]);
      return stdout.trim() === 'true';
    } catch { return false; }
  }

  /** Stop the project's container. Its volumes stay; ensureRunning starts it again. */
  async function stop(id) {
    await run(docker, ['stop', '-t', '20', containerName(id)]);
  }

  return { kind: 'docker', serverMode, isRunning, isCurrent, stop, create, ensureRunning, recreate, remove, exec, sh, writeFile, readFile, previewTarget, previewReady, exportZip, exportTar, hasVolume, exportVolume, importVolume };
}
