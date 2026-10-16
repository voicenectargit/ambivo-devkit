// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Building a large app in phases.
//
// Phase 0, "Brief and data model" (id `brief`), is the first conversation. The assistant writes, in the app:
//   docs/APP_BRIEF.md    who, what, screens, Ambivo records and endpoints, what is left out, open questions
//   docs/DATA_MODEL.md   every custom object and every Ambivo record type used
//   docs/PHASES.md       the phases after phase 0, as one markdown table (format below)
// then stops for approval. Every later phase is a NEW assistant conversation (a new Claude session or
// Codex thread), opened with a fixed prompt (openingPrompt), and ends with a handoff note
// docs/phases/<id>.md. The partner approves each phase with a button; only then can the next start.
//
// docs/PHASES.md format: free text is allowed around ONE table with exactly these columns:
//
//   | id | title | goal | screens | depends_on |
//   |----|-------|------|---------|------------|
//   | objects | Install custom objects | Create the 11 objects in the sandbox | - | - |
//   | samples | Sample data | ... | - | objects |
//   | projects | Projects and samples | ... | Project list; Project detail | samples |
//
//   id          lowercase letters, digits and dashes, starting with a letter, up to 40; unique; not "brief"
//   title       up to 80 characters
//   goal        one sentence, up to 400 characters
//   screens     screen names separated by ";", or "-" for none
//   depends_on  ids of phases ABOVE this one, separated by ",", or "-" for none
// Up to 30 phases. A "|" inside a cell is not allowed.
//
// The project record keeps the state (no file in the container is trusted for it):
//   phases: { active: <id> | null, list: [{ id, title, goal, screens, depends_on, status,
//             session?, codexThread?, codexUsage?, cost, tokens, started?, approved? }] }
// status: not_started | working | waiting (the assistant finished, waiting for the partner) | approved
// The first entry is always phase 0. One phase is active (working or waiting) at a time.

export const PHASE0 = Object.freeze({ id: 'brief', title: 'Brief and data model', goal: 'Read the brief, ask the open questions, and write the app brief, the data model and the phase plan.', screens: [], depends_on: [] });
export const PHASES_FILE = '/work/app/docs/PHASES.md';
export const PHASE_DOCS = ['docs/APP_BRIEF.md', 'docs/DATA_MODEL.md', 'docs/PHASES.md'];
export const handoffFile = (id) => `/work/app/docs/phases/${id}.md`;
export const STATUS_WORDS = { not_started: 'Not started', working: 'Working', waiting: 'Waiting for approval', approved: 'Approved' };
const COLUMNS = ['id', 'title', 'goal', 'screens', 'depends_on'];
const MAX_PHASES = 30;
export const PHASE_ID = /^[a-z][a-z0-9-]{0,39}$/;

export class PhasesError extends Error {}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const none = (v) => v === '' || v === '-' || v === '—';

/**
 * Read docs/PHASES.md. Returns [{ id, title, goal, screens, depends_on }] in table order.
 * Throws PhasesError with a plain sentence (and the line number) when the file does not follow the format.
 */
export function parsePhases(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const head = lines.findIndex((l) => /^\s*\|/.test(l) && cells(l).map((c) => c.toLowerCase()).join(',') === COLUMNS.join(','));
  if (head < 0) throw new PhasesError('docs/PHASES.md has no phase table. It needs a table with the columns id, title, goal, screens and depends_on.');
  if (!/^\s*\|(\s*:?-{3,}:?\s*\|){5}\s*$/.test(lines[head + 1] || '')) throw new PhasesError(`docs/PHASES.md line ${head + 2}: the line under the table header must be |---|---|---|---|---|.`);
  const out = [];
  const seen = new Set();
  for (let i = head + 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
    const at = `docs/PHASES.md line ${i + 1}`;
    const c = cells(lines[i]);
    if (c.length !== 5) throw new PhasesError(`${at}: a row needs 5 cells, this one has ${c.length}. A "|" inside a cell is not allowed.`);
    const [id, title, goal, screens, deps] = c;
    if (!PHASE_ID.test(id)) throw new PhasesError(`${at}: the id "${id}" must be lowercase letters, digits and dashes, starting with a letter.`);
    if (id === PHASE0.id) throw new PhasesError(`${at}: the id "brief" is phase 0. Leave phase 0 out of the table.`);
    if (seen.has(id)) throw new PhasesError(`${at}: the id "${id}" is used twice.`);
    if (!title || title.length > 80) throw new PhasesError(`${at}: the title must have 1 to 80 characters.`);
    if (!goal || goal.length > 400) throw new PhasesError(`${at}: the goal must have 1 to 400 characters.`);
    const depends = none(deps) ? [] : deps.split(',').map((d) => d.trim()).filter(Boolean);
    for (const d of depends) {
      if (d === PHASE0.id) continue;
      if (!seen.has(d)) throw new PhasesError(`${at}: "${id}" depends on "${d}", which is not a phase above it.`);
    }
    seen.add(id);
    out.push({ id, title, goal, screens: none(screens) ? [] : screens.split(';').map((s) => s.trim()).filter(Boolean), depends_on: depends.filter((d) => d !== PHASE0.id) });
    if (out.length > MAX_PHASES) throw new PhasesError(`docs/PHASES.md has more than ${MAX_PHASES} phases. Join small ones.`);
  }
  if (!out.length) throw new PhasesError('docs/PHASES.md has a phase table with no phases in it.');
  return out;
}

/** A new phase state with phase 0. `from`: a record whose conversation becomes phase 0's. */
export function newPhases(status = 'working', from = null) {
  const p0 = { ...PHASE0, screens: [], depends_on: [], status, cost: 0, tokens: 0, started: Date.now() };
  if (from) {
    for (const k of ['session', 'codexThread', 'codexUsage']) if (from[k] !== undefined) p0[k] = from[k];
    p0.cost = from.cost ?? 0;
    p0.tokens = from.tokens ?? 0;
  }
  return { active: PHASE0.id, list: [p0] };
}

/**
 * Bring the plan from docs/PHASES.md into the saved state. Phases keep their status, sessions and cost by
 * id; new ones are added as not started; a phase gone from the file is dropped only if it never started.
 */
export function mergePhases(state, parsed) {
  const old = new Map(state.list.map((p) => [p.id, p]));
  const list = [old.get(PHASE0.id)];
  for (const p of parsed) {
    const was = old.get(p.id);
    list.push(was ? { ...was, title: p.title, goal: p.goal, screens: p.screens, depends_on: p.depends_on } : { ...p, status: 'not_started', cost: 0, tokens: 0 });
    old.delete(p.id);
  }
  old.delete(PHASE0.id);
  for (const p of old.values()) if (p.status !== 'not_started') list.push({ ...p, dropped: true });
  state.list = list;
  return state;
}

export const findPhase = (state, id) => state?.list.find((p) => p.id === id) || null;

/** Why this phase cannot start now, or null. */
export function cannotStart(state, id) {
  const ph = findPhase(state, id);
  if (!ph || ph.dropped) return 'There is no such phase in the plan.';
  if (state.active) return `Finish the phase "${findPhase(state, state.active)?.title}" first: approve it, then start the next one.`;
  if (ph.status !== 'not_started') return ph.status === 'approved' ? 'This phase is approved. Click Reopen to change it.' : 'This phase has started already.';
  if (findPhase(state, PHASE0.id)?.status !== 'approved') return 'Approve the brief and data model first.';
  const waiting = ph.depends_on.map((d) => findPhase(state, d)).filter((d) => d && d.status !== 'approved');
  if (waiting.length) return `Approve these phases first: ${waiting.map((d) => d.title).join(', ')}.`;
  return null;
}

/** What the page shows. */
export function phasesView(state, error) {
  if (!state) return { phased: false };
  const total = state.list.reduce((a, p) => ({ cost: a.cost + (p.cost || 0), tokens: a.tokens + (p.tokens || 0) }), { cost: 0, tokens: 0 });
  return {
    phased: true, active: state.active, error: error || null,
    list: state.list.map(({ session, codexThread, codexUsage, ...p }) => ({ ...p, canStart: !cannotStart(state, p.id) })),
    total,
  };
}

/** Earlier phases whose handoff notes a new phase reads: approved ones, in plan order, without phase 0. */
export const earlierPhases = (state, id) => state.list.filter((p) => p.id !== PHASE0.id && p.id !== id && p.status === 'approved');

/**
 * The first message of a phase's new conversation. `codex`: the rules are in AGENTS.md, not a skill.
 */
export function openingPrompt(state, id, { codex = false } = {}) {
  const ph = findPhase(state, id);
  const notes = earlierPhases(state, id).map((p) => `- docs/phases/${p.id}.md (${p.title})`);
  const rules = codex
    ? 'Follow the rules in /work/app/AGENTS.md, including its section "Building a large app in phases".'
    : 'Follow the ambivo-phased-build skill and the other ambivo-devkit skills.';
  const check = 'node /opt/ambivo-devkit/scripts/ambivo-check.mjs .';
  return [
    `You are starting phase "${ph.title}" (id: ${ph.id}) of this app. This is a new conversation for this phase only.`,
    `Goal of this phase: ${ph.goal}`,
    ph.screens.length ? `Screens in this phase: ${ph.screens.join('; ')}.` : 'This phase has no screens of its own.',
    '',
    'Before you change anything, read these files in /work/app:',
    '- docs/APP_BRIEF.md',
    '- docs/DATA_MODEL.md',
    '- docs/PHASES.md',
    ...(notes.length ? ['and the handoff notes of the earlier phases:', ...notes] : ['No earlier phase has a handoff note yet.']),
    '',
    'Then:',
    `1. Do only this phase. Work that belongs to another phase in docs/PHASES.md waits for that phase.`,
    `2. ${rules}`,
    '3. docs/DATA_MODEL.md is the single source of truth for the data. If this phase needs a change to it, change the file and say why in your handoff note.',
    `4. When the phase is built, run \`npx ng build\` and \`${check}\` in /work/app. Both must pass.`,
    `5. Write docs/phases/${ph.id}.md: what was built, the files, decisions, known gaps, and how to test it in Preview, step by step.`,
    `6. Stop. End your reply with: "Phase ${ph.title} is ready. Check it in Preview, then click Approve phase." Do not start the next phase.`,
  ].join('\n');
}

/** The first message of a new app built in phases: phase 0, with the brief file(s). */
export function phase0Prompt({ description, briefs = [], codex = false }) {
  const files = briefs.map((b) => {
    const file = `/work/brief/${b.name}`;
    if (b.type === 'pdf') return `- ${file}${b.text ? ` (a text copy: /work/brief/${b.text}${codex ? '; read that one' : '; use it if you cannot read the PDF'})` : ''}`;
    if (b.type === 'docx') return `- ${file}: read its text copy, /work/brief/${b.text}`;
    return `- ${file}`;
  });
  const steps = codex
    ? 'First read /opt/ambivo-devkit/starter/AGENTS.md in full. Follow its "Starting a new app" steps for a large app (phase 0) and its section "Building a large app in phases".'
    : 'Start a new app with the ambivo-new-app skill from the ambivo-devkit plugin. It is a large app: follow its phase 0 steps and the ambivo-phased-build skill.';
  return [
    steps,
    'This first conversation is phase 0, "Brief and data model". Do not build screens in it.',
    ...(files.length ? ['', 'The client\'s brief is in these files. Read them in full before you ask anything:', ...files, ''] : []),
    'Ask your open questions in plain words, a few at a time, each with your recommendation, then stop and wait for the answers.',
    codex
      ? 'Then create the project in /work/app with `node /opt/ambivo-devkit/scripts/ambivo-new-app.mjs /work/app --name "<App name>" --key <key>`, and write docs/APP_BRIEF.md, docs/DATA_MODEL.md and docs/PHASES.md in it.'
      : 'Then create the project in /work/app, and write docs/APP_BRIEF.md, docs/DATA_MODEL.md and docs/PHASES.md in it.',
    'Stop there. End your reply with: "Phase 0 is ready. Read the brief, the data model and the phases, then click Approve phase."',
    'You are talking to a partner through a web page, not a terminal.',
    ...(description ? ['', `The partner's description:\n${description}`] : []),
  ].join('\n');
}
