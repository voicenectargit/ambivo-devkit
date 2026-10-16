// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Codex (OpenAI's coding agent) as the assistant of a Dev Studio project, beside Claude Code.
//
// Each message runs, in the project's container:
//   codex exec [resume <thread id>] --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox
//              -c developer_instructions=<Dev Studio context> -
// with the prompt on stdin and OPENAI_API_KEY in the environment only. The runner image has Codex's
// settings in /etc/codex/config.toml (the Ambivo MCP server, no telemetry or update checks) and
// CODEX_HOME on the project's session volume, so a thread survives a new container.
//
// Why --dangerously-bypass-approvals-and-sandbox: the container is the boundary, as for Claude Code's
// --dangerously-skip-permissions. Codex's own sandbox (Landlock/seccomp) cannot start in a container with
// every capability dropped and no-new-privileges, and `codex exec resume` takes no --sandbox flag; this
// one flag works for both and never stops to ask (exec has no one to answer).
//
// `codex exec --json` prints one JSON event per line. Recorded from 0.160.0 (test/fixtures/codex-*.jsonl):
//   {"type":"thread.started","thread_id":"<uuid>"}            the id to resume with
//   {"type":"turn.started"}
//   {"type":"item.started"|"item.completed","item":{...}}      agent_message, command_execution,
//                                                              file_change, mcp_tool_call, web_search,
//                                                              reasoning, todo_list, error
//   {"type":"turn.completed","usage":{input_tokens, cached_input_tokens, output_tokens, ...}}
//   {"type":"turn.failed","error":{"message":...}}
//   {"type":"error","message":"Reconnecting... 2/5 (...)"}    retries, not shown
// Usage is the thread's running total: a resumed thread reports the earlier turns too.

export const CODEX_KEY_PURPOSE = 'openai-key';

/** Check an OpenAI API key once before saving it (GET /v1/models). The value is never logged. */
export async function openaiKeyProblem(key, fetchImpl = fetch, log = console.log) {
  const k = String(key || '').trim();
  if (k.startsWith('sk-ant-')) return 'That is an Anthropic key. Paste an OpenAI API key. It starts with sk-.';
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(k)) return 'Paste an OpenAI API key from platform.openai.com. It starts with sk-.';
  try {
    const r = await fetchImpl('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${k}` },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return null;
    let code = '';
    try { code = (await r.json())?.error?.code || ''; } catch {}
    log(`openai key check: HTTP ${r.status} ${code}`);
    if (r.status === 401) return 'OpenAI does not recognise that API key. It may have been deleted, or copied with a missing character.';
    // 403: a restricted key may lack "list models" and still run Codex. Let the run report it.
    return null;
  } catch {
    return null;
  }
}

/** The Codex command line for one message. The prompt goes on stdin ("-"); keys never go here. */
export function codexArgv({ thread, instructions }) {
  const flags = ['--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox',
    '-c', `developer_instructions=${JSON.stringify(instructions)}`];   // a JSON string is a TOML string
  const codex = thread ? ['codex', 'exec', 'resume', ...flags, thread, '-'] : ['codex', 'exec', ...flags, '-'];
  // CODEX_HOME is on the session volume, which starts empty; Codex needs the folder to exist.
  return ['sh', '-c', 'mkdir -p "$CODEX_HOME" && exec "$@"', 'codex', ...codex];
}

/** Extra context for Codex: where the dev kit is, since Codex has no plugin. */
export function codexContext(devStudioContext) {
  return [
    devStudioContext,
    'The Ambivo dev kit is in /opt/ambivo-devkit (read-only). Its scripts are in /opt/ambivo-devkit/scripts;',
    'CLAUDE_PLUGIN_ROOT is set to /opt/ambivo-devkit, so commands written with ${CLAUDE_PLUGIN_ROOT} work as they are.',
    'The ambivo MCP server gives you the Ambivo tools (whoami, entity_data, api_get and others).',
    'The app\'s rules are in /work/app/AGENTS.md once the app exists. Follow them.',
  ].join(' ');
}

/** The first message of a new Codex project: the same steps the Claude path asks for, from AGENTS.md. */
export function codexNewAppPrompt(description) {
  return 'Start a new app. First read /opt/ambivo-devkit/starter/AGENTS.md in full. Follow its "Starting a new app" steps ' +
    'and its rules. When a step says to create the project, run ' +
    '`node /opt/ambivo-devkit/scripts/ambivo-new-app.mjs /work/app --name "<App name>" --key <key>`, then `npm install` in /work/app. ' +
    'Where a step runs ambivo-spec.mjs or ambivo-check.mjs, run them from /opt/ambivo-devkit/scripts. ' +
    'You are talking to a partner through a web page, not a terminal: ask your questions in plain words, ' +
    'a few at a time, then stop and wait for the answers. Create the project in /work/app.\n\n' +
    `The partner's description:\n${description}`;
}

/** `/bin/sh -lc 'npm install'` -> `npm install` */
function bareCommand(cmd) {
  const s = String(cmd || '');
  const m = s.match(/^(?:\/usr)?\/bin\/(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/);
  return m ? m[2] : s;
}

const short = (s) => String(s).slice(0, 140);
const FILE_VERB = { add: 'Write', update: 'Edit', delete: 'Delete' };

/**
 * One `codex exec --json` line as a page event, or null to skip. The tool lines use the short names the
 * page shows for Claude Code (Bash, Write, Edit, and the bare MCP tool name).
 */
export function codexEvent(msg) {
  if (msg.type === 'thread.started') return { kind: 'status', text: 'Working…', thread: msg.thread_id };
  if (msg.type === 'turn.completed') {
    const u = msg.usage || {};
    return { kind: 'done', usage: { input: Number(u.input_tokens) || 0, cached: Number(u.cached_input_tokens) || 0, output: Number(u.output_tokens) || 0 } };
  }
  if (msg.type === 'turn.failed') return { kind: 'done', error: true, text: msg.error?.message || 'The run stopped with an error.' };
  if (msg.type !== 'item.started' && msg.type !== 'item.completed') return null;
  const item = msg.item || {};
  const started = msg.type === 'item.started';
  switch (item.type) {
    case 'agent_message':
      return !started && String(item.text || '').trim() ? { kind: 'assistant', text: String(item.text).trim() } : null;
    case 'command_execution':
      return started ? { kind: 'tool', text: `Bash: ${short(bareCommand(item.command))}` } : null;
    case 'file_change':
      if (started || !Array.isArray(item.changes) || !item.changes.length) return null;
      return { kind: 'tool', text: item.changes.map((c) => `${FILE_VERB[c.kind] || 'Edit'}: ${short(c.path)}`).join('\n') };
    case 'mcp_tool_call': {
      if (!started) return null;
      const a = item.arguments || {};
      const what = a.file_path || a.command || a.path || a.pattern || a.query || a.entity || '';
      return { kind: 'tool', text: `${item.tool}${what ? `: ${short(what)}` : ''}` };
    }
    case 'web_search':
      return started && item.query ? { kind: 'tool', text: `WebSearch: ${short(item.query)}` } : null;
    default:
      return null;   // reasoning, todo_list, and transport notes ("Falling back from WebSockets…")
  }
}

/**
 * Tokens one step used, from the thread's running total. `prev` is what the project saved after its
 * last step ({ thread, total } or undefined).
 */
export function stepTokens(prev, thread, usage) {
  const total = usage.input + usage.output;
  const before = prev && prev.thread === thread ? prev.total : 0;
  return { step: total >= before ? total - before : total, saved: { thread, total } };
}
