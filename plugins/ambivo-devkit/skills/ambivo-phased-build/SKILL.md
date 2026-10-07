---
name: ambivo-phased-build
description: Plan and build a large Ambivo app in phases, one approved phase at a time, each in its own conversation. Use when an app has more than about 5 screens or more than about 4 custom objects, when the client sent a brief document (PDF, Word, Markdown), when docs/PHASES.md exists in the app, or when a message starts a phase ("You are starting phase ..."). Covers phase 0 (brief, data model, phase plan), how to size a phase, the PHASES.md format, the handoff note, and the approval rule.
---

# Building a large app in phases

One conversation is fine for a one-page app. A lab system with 10 custom objects and 20 screens is
not: the conversation runs out of room, costs more with every message, and the partner gets no
checkpoints. So a large app is built in phases. Each phase is one coherent module, built in its own
conversation, checked by the partner in Preview, and approved before the next one starts.

## When to plan phases

Plan phases when any of these is true:

- the app has more than about 5 screens;
- it needs more than about 4 custom objects;
- the client sent a brief document.

Otherwise follow the normal `/ambivo-new-app` steps in one conversation.

## Phase 0: brief and data model

Phase 0 is the first conversation. It builds no screens.

1. Read the brief file in full (in Dev Studio: `/work/brief/`). A `.txt` copy sits next to a DOCX, and
   next to a PDF when the PDF could be converted. Read the PDF itself when you can.
2. Ask the open questions, with a recommendation for each, as `/ambivo-new-app` says. Ask also whether
   to include a **Prototype** phase (below), with your recommendation.
3. Create the project (`ambivo-new-app.mjs`), then write three files in it:
   - `docs/APP_BRIEF.md`: who uses it, one client or many, every screen, the Ambivo records each screen
     reads or changes with the exact endpoints (look each up with the spec script), what is left out,
     and the questions still open for the client.
   - `docs/DATA_MODEL.md`: for each custom object its `collection_id` (with the app prefix), every field
     with its type and whether it is required, `reference_fields` with `on_delete` and why,
     `data_access_dict` and `default_access_dict`. For each Ambivo record type used (products, inventory,
     contacts and so on): the routes the app calls. See the `ambivo-custom-objects` skill.
     Write each object as a heading with its id in backticks, then one field table. Dev Studio draws the
     data model diagram from it, so the partner can check it before approving phase 0:

     ```markdown
     ### `lab_trial`: baking and pasta trials

     | field | type | R | links to | notes |
     |---|---|---|---|---|
     | `trial_no` | string | R | | auto, TR-2026-0001 |
     | `project_id` | string | R | `lab_project` (restrict) | |
     | `customer_account_id` | string | | Ambivo account | |
     | `performed_by_userid` | string | | Ambivo user | |
     ```

     In **links to**: a link to another custom object is its id and its `on_delete`; a field that holds
     an Ambivo record's id is `Ambivo account`, `Ambivo product`, `Ambivo user`, `Ambivo site`,
     `Ambivo stock movement` or `Ambivo file`.
   - `docs/PHASES.md`: the plan, in the format below.
4. Stop. Ask the partner to read the three files and click **Approve phase** (outside Dev Studio: to
   reply "approved").

## Sizing a phase

- One coherent module: for example "Projects and samples", or "QC batches and approval".
- Finishable in one conversation: about 2 to 5 screens, or one install step. Split anything bigger.
- Reviewable in Preview: the partner can open it, click through it and say yes or no.
- Ends with a working build. Never leave half a screen for the next phase.

## The usual phases

For an app with custom objects, plan these, in this order, and add the feature phases in the middle:

| id | title | what it does |
|---|---|---|
| `prototype` | Prototype (optional) | The screens and the left menu with sample data held in the app, no API calls. See below. |
| `shell` | App shell | Wires the left menu (`AppShellComponent`, the `ambivo-angular-app` skill) with every section, a dashboard placeholder and an empty page per section. After a Prototype it is short: the menu and pages exist; it puts `signedInGuard` back on every page and checks sign-in, routes and the phone layout. |
| `objects` | Install custom objects | Writes `src/install/app-objects.json` and `src/install/install.mjs` (the `ambivo-custom-objects` skill) and runs it against the sandbox twice; the second run changes nothing. Needs the Ambivo sandbox sign-in. |
| `samples` | Sample data | Adds linked sample records to the sandbox with the `ambivo-sample-data` skill. |
| (features) | one per module | The real screens, reading and writing through the API. |
| `reports` | Reports | Lists, totals and exports the brief asks for. |
| `handover` | Review and hand-over | Checks every screen against the brief, fixes gaps, updates the README, and asks the partner to share the link and download the client zip. |

In Dev Studio `install.mjs` finds the sandbox session in the `AMBIVO_TOKEN` environment variable (and
the API in `AMBIVO_API_URL` when set). If there is none, ask the partner to sign in to their Ambivo sandbox.

### The Prototype phase

Recommend it when the brief describes many screens, or when the client will likely want to see the
flows before the build. Ask in phase 0, for example:

> Shall I add a Prototype phase first?
> Recommended: yes. You get every screen and the menu with sample data inside the app, so the client can
> click through it from a share link and correct flows and fields before anything is installed.

What it builds:

- The app shell with the left menu (the `ambivo-angular-app` skill, "Left navigation") and every screen
  of the brief, with the real routes, forms and fields from `docs/DATA_MODEL.md`.
- Sample data held in the app: each feature's `<feature>.api.ts` service returns fixed records with
  `of(...)` from a `<feature>.sample.ts` file. No API calls, no custom objects installed.
- It opens without sign-in, so the client can click through the share link with no Ambivo account. The
  prototype's routes leave out `signedInGuard`, the sign-in page is not the start page, and the shell
  shows "Sample data" where the signed-in user's name goes. The `shell` phase puts `signedInGuard` back
  on every page.
- It is the start of the real app shell: the same components, routes and services the real app keeps. Later phases replace the bodies of the
  `.api.ts` methods with real API calls and delete the `.sample.ts` files. Nothing is thrown away.
- Its handoff note lists every `.sample.ts` file still to replace, and says the partner can click
  **Share** to send the link to the client.

## docs/PHASES.md

Free text may come before and after it, but the file has exactly ONE table with these columns, in this order:

```markdown
| id | title | goal | screens | depends_on |
|---|---|---|---|---|
| prototype | Prototype | Every screen and the menu with sample data in the app | Project list; Sample form | - |
| shell | App shell | Left menu with every section, dashboard placeholder | Dashboard | prototype |
| objects | Install custom objects | Create the 11 custom objects in the sandbox | - | - |
| samples | Sample data | Add linked sample records to the sandbox | - | objects |
| projects | Projects and samples | Real project and sample screens | Project list; Project detail; Sample form | objects, samples |
```

- `id`: lowercase letters, digits and dashes, starting with a letter, up to 40. Unique. Not `brief`
  (that is phase 0, which is not in the table).
- `title`: up to 80 characters. `goal`: one sentence.
- `screens`: screen names separated by `;`, or `-` for none.
- `depends_on`: ids of phases ABOVE it, separated by `,`, or `-`. Order the table so this holds.
- No `|` inside a cell. Up to 30 phases.

Dev Studio reads this file after every message and shows the plan. A malformed table is shown to the
partner as an error; fix it at once.

## Starting a phase

A phase starts in a new conversation with a message like "You are starting phase ...". Then:

1. Read `docs/APP_BRIEF.md`, `docs/DATA_MODEL.md`, `docs/PHASES.md` and the handoff notes of the
   earlier phases (`docs/phases/<id>.md`) before changing anything.
2. Do only this phase. Note work for later phases in the handoff note; do not do it.
3. Follow the other skills as usual.
4. Run `npx ng build` and the Ambivo check. Both must pass.
5. Look at every screen this phase built or changed, at desktop and phone width. With the app running
   (start `npm start` in the background if nothing answers on port 4200), take the screenshots into the
   phase's folder and read each PNG:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-screenshot.mjs /samples --phase <id>
   node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-screenshot.mjs /samples --phase <id> --phone
   ```

   Fix what looks wrong (layout, the Ambivo look, empty and error states), build again, and take the
   screenshots again. The partner sees them next to the phase in Dev Studio before approving it.
6. Write the handoff note, then stop.

## The data model is the single source of truth

`docs/DATA_MODEL.md` decides every object, field and link. When a phase needs a change (a new field, a
different `on_delete`), change `docs/DATA_MODEL.md`, change `src/install/app-objects.json` to match
when it exists, and say what changed and why in the handoff note. Never let the code and the data model
disagree. Adding phases or changing later phases means editing `docs/PHASES.md`; say so in the note.

## The handoff note: docs/phases/<id>.md

```markdown
# <Phase title>

## What was built
## Files
## Decisions
## Known gaps
## Screens
One line per screenshot in `.ambivo/screens/<id>/`: the file, and what it shows.
## How to test it in Preview
1. Click Preview, sign in with your sandbox account.
2. Open <menu item>. You should see ...
```

Write the test steps for someone clicking, not reading code.

## Approval

- Only the partner approves a phase: the **Approve phase** button in Dev Studio, or "approved" in a
  terminal. Never mark a phase approved yourself, and never start the next phase without that approval.
- End every phase with: "Phase <title> is ready. Check it in Preview, then click Approve phase."
- While a phase waits for approval the partner can still ask for changes in the same conversation.
  Update the handoff note when you change something.
