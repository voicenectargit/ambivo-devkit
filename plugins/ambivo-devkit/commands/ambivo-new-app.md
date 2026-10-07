---
description: Start a new app on the Ambivo API. Asks what the app is for, then creates it from the Ambivo Angular starter.
argument-hint: "[what the app should do]"
---

# New Ambivo app

The user wants a new app built on the Ambivo API. Their description, if any: $ARGUMENTS

Work through these steps in order. Ask questions in plain words, a few at a time, and wait for answers.

**Every question carries your recommendation.** Under each question write `Recommended:` with the answer you
would pick and one short reason, based on what you know so far (the description, the API, the sandbox).
End with: "Reply 'use your recommendations', or tell me only the ones you want different." Never leave a
question without a recommendation; if you truly cannot choose, say what it depends on.
Load the `ambivo-api`, `ambivo-angular-app`, `ambivo-custom-objects`, `ambivo-sample-data` and `ambivo-phased-build` skills before designing.

## 0. Small app or large app?

Decide first, and say which in one line:

- **Small app** (about 5 screens or fewer, about 4 custom objects or fewer, no brief document):
  follow steps 1 to 7 below in this one conversation.
- **Large app** (more screens or objects than that, or the client sent a brief document): build it in
  phases with the `ambivo-phased-build` skill. This conversation is **phase 0**, and it builds no screens:
  1. Read the brief file in full, if there is one (in Dev Studio: `/work/brief/`).
  2. Ask the questions of steps 1 and 2 below, with recommendations. Also ask whether to include a
     Prototype phase, with your recommendation (see that skill).
  3. Create the project (step 4 below), then write `docs/APP_BRIEF.md`, `docs/DATA_MODEL.md` and
     `docs/PHASES.md` in it, as the `ambivo-phased-build` skill says.
  4. Stop and ask the partner to approve phase 0. Steps 5 to 7 happen in the later phases, each in its
     own conversation.

## 1. One client, or many?

Ask first, in these words or close to them: "Will you build this for one client, or offer the same app to
several clients? Either way, each client only ever sees its own data." It changes how the app is built,
never whose data you can see:

- **One client:** built for one company. Its deployment may set `tenantId` in runtime config so only that
  company's people can sign in.
- **Many clients:** the partner will sell it to several companies. Everything that differs between
  companies (sites, picklists, which modules they have) is read from the API at runtime, and the app must
  still work when a company has one site, many sites, or lacks a module.

**Data rule, for both:** while designing and testing you read ONLY the developer's sandbox, through the
`ambivo` MCP tools and the developer's own sign-in. Never ask for, or use, access to a client's real
tenant, and never suggest it. The app itself only ever reads the signed-in person's own tenant: the API
enforces that, and the app must not try to work around it. Never write a tenant id, site code, user id or
record id into the code.

Also ask for the app's name and a short key: lowercase letters only, used to prefix its custom objects
(for example `stockroom`).

## 2. Understand the work

Find out, in the user's own words:

- Who uses it, and on what: a phone on the shop floor, a desk computer, both.
- What they do, step by step, from opening the app to being finished.
- Which Ambivo records it reads, and which it changes. Look each one up with the spec script before
  assuming it exists or how it behaves.
- What the app keeps that Ambivo does not have. That becomes custom objects. The app never gets its own
  database, collections or backend service; every stored thing is a custom object (see that skill).
- Never ask for data from another company, or for a view across companies. Every screen shows one tenant's data.
- Who may see and change what. Does a manager approve anything?
- For many clients: does a company usually work at one site or several? (Ask about the shape of the
  work, not a list of sites.)

Stop asking when you can write the brief. Do not ask what you can find out from the spec.

## 3. Write the brief and get a yes

Write `docs/APP_BRIEF.md` in the new app with: who it is for, one client or many, the screens, the
Ambivo records and the exact endpoints each screen uses, the custom objects (fields, links,
`on_delete`, who sees records), and what is left out. Say plainly that the app has no backend of its own. Show it to the user and wait for approval
before writing app code.

## 4. Create the project

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-new-app.mjs <folder> --name "<App name>" --key <key>
```

This copies the starter, names the app, and writes `public/runtime-config/localhost.json`. Then
`npm install` in the folder. Leave `tenantId` out of that file: the app then works for whoever signs in,
each person seeing only their own company's data. For a one-client app, the deployment's own config may
add `"tenantId"` to limit sign-in to that company.

## 5. Offer sample data

Only when the signed-in company is the developer's partner sandbox (see the `ambivo-sample-data`
skill). Ask, with the record types from the brief and a count:

> Shall I add sample data to your sandbox for: <the record types the app shows>?
> Recommended: yes, <N> of each. The screens then show real-looking, linked records. I tag them
> `sample:<key>` and can remove them all later.

Pick N from 3 to 8. On a yes, create them as that skill says: parents first, each child linked to
its parent's new id. Ambivo's own record types can be added now. The app's custom objects get their
sample records in step 6, once `src/install/install.mjs` has run against the sandbox. Not a sandbox,
or not signed in: skip this step and say why in one line.

## 6. Build it

Follow the skills. Put each feature in `src/app/<feature>/`, its API calls in a `<feature>.api.ts`
service, and its routes in `app.routes.ts` behind `signedInGuard`. If the app has custom objects,
write `src/install/app-objects.json` and `src/install/install.mjs` as the custom objects skill says.

## 7. Check it

```sh
npx ng build
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-check.mjs .
```

Both must pass. Then tell the user how to run it (`npm start`) and that `/ambivo-bundle` packages it.
