---
name: ambivo-user-guide
description: Write the end-user guide for an Ambivo app (docs/user-guide/USER_GUIDE.md with screenshots), for the people who use it and the admin who sets it up. Use when asked for a user guide, user documentation, a manual or help pages, or when Dev Studio's "User guide" button starts the run.
---

# The user guide

The guide is for the people who use the app every day, and for the admin who sets it up. It is not for
developers. It ships to the client with the app.

## What to write

`docs/user-guide/USER_GUIDE.md`, and its pictures in `docs/user-guide/images/`. Replace both when the
guide is written again.

Read the app first: `docs/APP_BRIEF.md`, `docs/DATA_MODEL.md`, the handoff notes in `docs/phases/`,
`README.md`, the routes in `src/app/app.routes.ts` and the menu in `src/app/shell/nav.ts`. Describe what
the app does today, not what the brief hoped for. When a screen is missing or unfinished, leave it out.

Sections, in this order:

1. **What this app is for.** Two or three sentences. Who uses it and what they get done.
2. **Signing in.** The address, the Ambivo email and password, the code by email, "Remember this device",
   and what to do when the code does not arrive.
3. **One section per task**, named the way the reader thinks of it: "Receive a sample", "Record a flour
   analysis", "Approve a QC batch". Not one section per screen. Each task: when you do it, the numbered
   steps, a screenshot, and what you see when it worked.
4. **Setting up the app** (for the admin): what to do once, in order. The install step, settings, lists,
   who may approve, the stock site. Say who may do each step.
5. **When something goes wrong.** The messages a person can meet, what each one means, and what to do.
6. **Words used in this app.** Only the words a new user would not know, each in one plain sentence.

## Screenshots

Take them with the screenshot tool while the app runs (start `npm start` in the background if nothing
answers on port 4200). Save them in the guide's folder and look at each one:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-screenshot.mjs /samples --out docs/user-guide/images/samples.png
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-screenshot.mjs /samples --phone --out docs/user-guide/images/samples-phone.png
```

Link each one under its step: `![The sample list](images/samples.png)`. One picture for each task is
enough. Add a phone picture where people use the app on a phone. If a page needs data to look right,
use the sandbox's sample records; never invent a screenshot or describe one you did not take.

## How to write

The reader is busy, often on a phone, and may read English as a second language.

1. **Say the plain thing.** No metaphors, no wordplay, no clever endings. "Pick the customer." Not "Tell
   the app who this one belongs to."
2. **Say what is.** Never "not this, but that", and never both. "Only approvers see this button." Not
   "This button is not for everyone, only approvers".
3. **Short sentences.** Under 20 words. No em dashes: use a full stop, or a colon for a list.
4. **Words the reader knows.** No developer words: not "record", "object", "entity", "field",
   "endpoint", "payload", "tenant", "API", "custom object", "sync". Say "sample", "project", "the box",
   "your company". No capitals for emphasis.
5. **Name what the screen names.** Use the exact words on the buttons and menus, in bold: **Save**,
   **Receive a sample**. Never describe a button the screen does not have.
6. **Keep the numbers.** Codes, limits and formats are why people read the guide: "Sample codes look like
   WH-0042", "Up to 10 MB".
7. **No filler.** No "This section explains", no "simply", "just", "easily", "seamlessly", "powerful",
   "robust", "leverage". No praise of the app. Start each section with what the reader does.
8. **Talk to the reader.** "You", present tense, active voice. "Click **Save**." Not "The record can be
   saved by clicking".

## Before you finish

- Every step was checked against the running app, and every picture was looked at.
- No sentence breaks the rules above. Read the guide once only for that.
- Write a short reply: the sections, how many pictures, and anything the guide left out and why.
