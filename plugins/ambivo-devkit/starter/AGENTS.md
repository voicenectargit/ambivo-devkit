# Building on the Ambivo API

Rules for any coding agent working in this app (Codex, Cursor, Claude Code and others).
Generated from the ambivo-devkit plugin skills; do not edit by hand.

Without the plugin:
- Where a step runs `ambivo-spec.mjs`, read the spec instead:
  https://apidocs.ambivo.com/openapi/<spec id> (YAML). Spec ids: https://apidocs.ambivo.com/api/specs
- Where a step runs `ambivo-check.mjs`, run `npm run ambivo:check`.
- To look at a screen, run `npm run ambivo:screenshot -- /route` (needs Chrome or Chromium).
- Specs as of ambivo-api-docs ca16e3c.

---

## Starting a new app

Follow these steps when the user asks for a new app, or when this copy of the starter is still unnamed (package.json has no `ambivo` block).

Work through these steps in order. Ask questions in plain words, a few at a time, and wait for answers.

**Every question carries your recommendation.** Under each question write `Recommended:` with the answer you
would pick and one short reason, based on what you know so far (the description, the API, the sandbox).
End with: "Reply 'use your recommendations', or tell me only the ones you want different." Never leave a
question without a recommendation; if you truly cannot choose, say what it depends on.
Read the rest of this file before designing.

### 0. Small app or large app?

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

### 1. One client, or many?

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

### 2. Understand the work

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

### 3. Write the brief and get a yes

Write `docs/APP_BRIEF.md` in the new app with: who it is for, one client or many, the screens, the
Ambivo records and the exact endpoints each screen uses, the custom objects (fields, links,
`on_delete`, who sees records), and what is left out. Say plainly that the app has no backend of its own. Show it to the user and wait for approval
before writing app code.

### 4. Name the project

You are already in a copy of the starter. Name it:

```sh
npm install
npm run ambivo:name -- --name "<App name>" --key <key>
```

Leave `tenantId` out of `public/runtime-config/localhost.json`: the app then works for whoever signs in, each person seeing only their own company's data. For a one-client app, the deployment's own config may add `"tenantId"` to limit sign-in to that company.

### 5. Offer sample data

Only when the signed-in company is the developer's partner sandbox (see the `ambivo-sample-data`
skill). Ask, with the record types from the brief and a count:

> Shall I add sample data to your sandbox for: <the record types the app shows>?
> Recommended: yes, <N> of each. The screens then show real-looking, linked records. I tag them
> `sample:<key>` and can remove them all later.

Pick N from 3 to 8. On a yes, create them as that skill says: parents first, each child linked to
its parent's new id. Ambivo's own record types can be added now. The app's custom objects get their
sample records in step 6, once `src/install/install.mjs` has run against the sandbox. Not a sandbox,
or not signed in: skip this step and say why in one line.

### 6. Build it

Follow the skills. Put each feature in `src/app/<feature>/`, its API calls in a `<feature>.api.ts`
service, and its routes in `app.routes.ts` behind `signedInGuard`. If the app has custom objects,
write `src/install/app-objects.json` and `src/install/install.mjs` as the custom objects skill says.

### 7. Check it

```sh
npx ng build
npm run ambivo:check
```

Both must pass. Then tell the user how to run it (`npm start`) and how to package it: a zip of the folder without `node_modules`, `dist`, `.angular` and `.env*` files, or a push to their own GitHub repository.

---

## Calling the Ambivo API

Base URL: `https://ingress.ambivo.com/`. In local dev the starter proxies `/api/` to it.
Reference: https://apidocs.ambivo.com (19 OpenAPI specs).

### Look it up before you call it

Never guess a path, a method or a field name. Ambivo routes do not follow one pattern, and a wrong
guess often returns HTTP 200. Use the bundled spec lookup:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-spec.mjs list                       # the 19 specs
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-spec.mjs find stock count           # search all specs
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-spec.mjs find site --spec inventory
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-spec.mjs get GET /user/inventory_item/list
```

`get` prints one operation with its parameters, request body and responses resolved. Read it before
writing the call. If the spec and the API disagree, the API wins: tell the user what you saw.

The plugin's `ambivo` MCP server offers the same lookups live (`find_operation`, `get_operation`,
`list_specs`), plus read-only tools against the developer's sandbox:

- `whoami`: which user and tenant the session belongs to. Check it before reading data.
- `entity_data`: read a few real records, to see their shape before writing screens.
- `api_get`: run a documented, current GET operation to see a real response.

These tools change nothing. Two more, `sandbox_write` and `sandbox_cleanup`, add and remove sample
records, only in a partner sandbox: see the `ambivo-sample-data` skill. The server needs the developer to sign in once, in a terminal (never through you):
`node ${CLAUDE_PLUGIN_ROOT}/mcp/ambivo-mcp.mjs login`. Ask them to run it when a tool says NOT_SIGNED_IN
or SESSION_EXPIRED. Never ask for their password.

### The envelope: HTTP 200 does not mean success

Every JSON response carries `result`:

| `result` | meaning |
|---|---|
| `1` | success |
| `2` | refused. `error_code` (UPPER_SNAKE) says why; the message is in `error` or `error.message` |
| `3` | the user belongs to several tenants and must pick one (sign-in only) |

- Failures come back as **HTTP 200 with `result: 2`**. A wrong method (405) arrives the same way.
- The starter's `ApiService` turns `result: 2` into a thrown `ApiError` (`message`, `code`,
  `attemptsRemaining`, `data`). Every call goes through `ApiService`. Never use `HttpClient` directly.
- In a domain service, check `result === 1` before mapping. Map in the service, not in components.
- Never swallow an error and return an empty list. The screen would then say "nothing here" when the
  real answer is "you may not see this".
- List replies put the array under a key that varies: `data`, `<entity>_list`, the plural entity
  name, or the native key. Read the spec for the exact key.

### Sign-in and tokens

- The starter signs people in (`user/login`, then a code by email when needed). Do not write another sign-in.
- The token is a bearer JWT, added by the starter's interceptor. It lasts 24 hours.
- **Keep the token in memory only.** Never put it in localStorage, sessionStorage or a cookie.
- **Never send `is_mobile: true`.** The API trusts it as sent and gives a 180-day token.
- Every call runs as the signed-in person, inside their tenant. The API filters by tenant itself.
  Never send a `tenant_id` to "choose" a tenant on a data call.
- A 401 means the session ended. The starter sends the person back to sign in.
- Hide what the person may not do with `AuthService.hasAccess(module, privileges)`. It mirrors the
  API's own check. Privileges: `C` create, `R` read, `U` update, `D` delete, `A` all.

### Tenants and sites

- A **tenant** is one client company. Everything a person reads or writes stays inside their tenant.
- A **site** (`site_code`) is a place inside a tenant: a warehouse, a shop, an office. Most inventory,
  workforce and procurement records carry a `site_code`. A site also carries which legal company it
  belongs to, so pass the site, not a separate company id.
- Never hard-code a tenant id, a site code, a user id or any record id in code. Read them from the
  API at runtime, or from runtime config.
- **One tenant only.** An app shows the signed-in person's own tenant and nothing else. Never build a
  screen or a call that combines or compares data across tenants, and never use one tenant's token to
  read another. While designing, read only the developer's sandbox.

### Reading many records: `/entity/data`

One endpoint reads 33 entity types: `GET /entity/data?entity_type=<type>&action=get`. **Always send
`action`**: without it the API answers `unsupported_action`, whatever older copies of the spec say. Use it for lists,
pickers (`action=picklist`), batch reads by id (`action=get_entity_ids`), exports and charts
(`action=aggregate`). `PATCH` updates, `DELETE` deletes.

- **Do not create records through `/entity/data`.** Creating a lead, contact or order starts other
  work: activities, linked records, comments. Use the entity's own create route from the spec.
- Entity type names are not always what you expect: `task` (not `user_task`), `account`, `contact`,
  `lead`, `vendor` (an account with `relationship_type: vendor`). Run
  `ambivo-spec.mjs get GET /entity/data` for the full list.
- `account.relationship_type` has five values: `customer`, `vendor`, `partner`, `prospect`, `other`.
- Filters go in `match_filter_dict` as JSON, sort in `sort_dict` as JSON. Paging is `page_num`/`page_size`.
- **Only the person's own records by default.** A non-admin sees records they own or that were shared
  with them. `tenant_scope=true` widens a picklist to the whole tenant; admins may use it on any
  action. A list that should show "everyone's" records for a non-admin must be designed around this.
- On routes that take `eval_object_id`, ids inside a filter must be written as `"ObjectId('<24-hex>')"`
  strings. A bare hex id quietly matches nothing and the list comes back empty.

### Paging

Newer routes page with `page_num` (starting at 1) and `page_size`, and reply with `total_count`,
`page_num` and `page_size`. Older routes use other names; the spec says which.

- `total_count` is the number of records on **this page**, not the total.
- The real total is a top-level `gross_count`, and it is sent on page 1 only. Keep it from page 1.
- Search routes often page with a `last_id` cursor instead; `page_num` is ignored there.

### The user's id has two names

`GET /user/data` returns the signed-in user in `user_data` with the id in `userid`. The sign-in
replies (`/user/login`, `/user/mfa/verify`) return the user in `user` with the id in `id`. Read
both (`userid ?? id`), or the app has no user id straight after sign-in.

### Values the server reads loosely

These do not fail. They quietly do something else.

- **Booleans:** send JSON `true` and `false`. Some routes treat any non-empty string as true, so the
  string `"false"` turns the option on.
- **Times:** send epoch **seconds**. A millisecond value is read as a date far in the future.
- **Filters:** send `match_filter_dict` as valid JSON. On some list routes a filter the server cannot
  read is dropped, and you get the unfiltered list back with `result: 1`.

### Routes that look like reads but write

`GET /user/lead`, `GET /user/contact` and `GET /user/lead/search` can update the record they return
(they fill in missing owner details). Treat them as reads in the UI, but do not call them in a loop
over many records.

### Leads: four traps that fail silently

Each of these was hit for real. The API answers with success or a bare `result: 2`, and gives no reason.

- **Create needs `email_list` or `phone_list`.** `POST /user/lead` with
  `{"action": "add", "payload": {..., "email_list": [{"email": "a@b.com", "type": "work"}]}}`.
  A plain `email` field is ignored and the add is refused with no message.
- **Update takes `lead_id` at the top level**, next to `action`, not `id` inside `payload`:
  `{"action": "update", "lead_id": "<id>", "payload": {"lead_source": "Google"}}`.
- **`lead_source` must be a value Ambivo knows**, or it is saved as `Unknown` with no error, on create and on
  update. Built-in values: Google, Facebook, Youtube, Reddit, Snapchat, Craigslist, Yelp, Linkedin,
  Incoming-Call, SMS, Referral, Bing, Yahoo, Nextdoor, Unknown, TikTok, Instagram, Billboard Ad.
  A tenant may add its own (marketing sources). Never offer free text for this field: use a picker filled
  from `GET /entity/data?entity_type=marketing_source&action=picklist` plus the built-in values.
- **A lead's created date is always "now".** The API ignores a `timestamp` you send.
- After any write, read the record back and check the fields you set actually changed.

### Inventory and purchase orders: use the current routes only

Older action-style routes still answer but are being removed. **Never call:**

- `POST /user/purchase_order/manage`, `/user/purchase_order/approve`, `/user/purchase_order/picklist`,
  `/user/purchase_order/create_bill`, `/user/purchase_order/create_from_installed_base`
- `POST /user/inventory/place/manage`, `GET /user/inventory/uom`
- any request body that carries `"action": "add" | "get" | "update" | "delete"` on an inventory or
  procurement route

Use the verbed routes instead (`GET /user/purchase_order/list`, `POST /user/purchase_order`,
`PATCH /user/purchase_order/{id}`, `GET /user/inventory_item/list`, `POST /user/inventory_txn` and so on).
Pickers use `GET /entity/data?entity_type=<type>&action=picklist`.
The spec script marks retired operations `[DEPRECATED: do not use]`; their description names the replacement.
Stock changes are movements: `POST /user/inventory_txn`. Movements are never edited or deleted.

### Calling from a browser

Ambivo's firewall refuses browser calls from addresses it does not know, with HTTP 403. In local dev
the proxy hides this. A deployed app on a partner's own domain needs Ambivo to allow that domain
first. If you see a 403 from the firewall, say so; do not try to work around it.

### Tag what the app creates in Ambivo

When the app creates an Ambivo record (an account, contact, lead, opportunity, task, product, order,
inventory item or lot), add the app key to its `tags`: `"tags": ["<app key>"]`, keeping any tags the
user chose. Files carry it as `storefile_app_context`. This is how the app's records are told apart from
everyone else's: the sandbox teardown removes only records with the tag or in the sample-data list. Never
remove the tag on update, and never put another app's key on a record.

### Your own data

When the app needs records Ambivo does not have, use custom objects. See the `ambivo-custom-objects` skill.

---

## Building an Ambivo Angular app

Every app starts from the Ambivo Angular starter. `/ambivo-new-app` copies it. The starter gives:
Angular and Material 20.1.2, Ambivo's theme and fonts, sign-in with Ambivo accounts, an `ApiService`
for every API call, and runtime config per host.

### Never edit these

- `src/ambivo/**`: copied from Ambivo's own code. Changes are lost on the next sync.
- `src/app/core/**` (API client, sign-in, session): change only to fix a bug, and say so.
- The sign-in screens in `src/app/sign-in/`: wording only.

Put the app's pages in `src/app/<feature>/`, its API calls in `src/app/<feature>/<feature>.api.ts`,
and add routes in `src/app/app.routes.ts` with `canActivate: [signedInGuard]`, ABOVE the sign-in layout route.

### Ambivo pieces you can import

Same import paths as Ambivo's own code:

| import | gives |
|---|---|
| `@am/crm/ui/layout` | layout atoms `amSurface`, `amScroll`, `amInset`, `amStack`, `amCluster`, `amPanes`, `amContainer`, `amMeasure`, `amStickyTop`; components `am-header`, `am-toolbar`, `am-selection-bar`, `am-block-status` |
| `@am/shared/ui/common` | `DialogLayout`: `am-dialog-header`, `am-dialog-title`, `am-dialog-close-btn`, `am-dialog-content`, `am-dialog-actions` |
| `@am/shared/ui/overflow-bar` | `am-button-group`, `am-button-group-item`, tabs |
| `@am/shared/utils/rxjs` | `indicate()` for busy flags |
| `@am/shared/utils/resource` | `paginatedResource()` for paged lists |
| `@am/shared/utils/types` | `PaginatedRequest`, `PaginatedResponse` |

Anything else under `@am/...` does not exist outside Ambivo. Do not invent imports; build it in the app.

### Components

- Standalone (do not write `standalone: true`), `ChangeDetectionStrategy.OnPush` on every component.
- `input()` / `output()`, never `@Input()` / `@Output()`. No `@HostBinding` / `@HostListener`; use `host`.
- Signals for state, `computed()` for anything derivable. `linkedSignal` for state that resets when
  its source changes. Never `mutate`.
- Strict types. No `any`; `unknown` when the type is truly unknown.
- One job per component. Inline template while it fits on a screen.

### Look and feel: it must look like Ambivo

A partner app is a front end on Ambivo, like an app built for a marketplace on a larger platform.
People switch between it and Ambivo's own apps all day, so it uses Ambivo's theme, fonts and
components, not its own. The code check (`ambivo-check`) refuses the common ways this goes wrong.

- **Colours: theme tokens only.** Never a hex, `rgb()`, `hsl()` or named colour. The tokens follow
  the light and dark themes.

  | Use | Token |
  |---|---|
  | Brand, links, the main action | `var(--color-primary)`, light tint `var(--color-primary-50)` |
  | Body text, secondary text, faint text | `var(--color-fg-text)`, `var(--color-fg-secondary-text)`, `var(--color-fg-muted)`, `var(--color-fg-ghost)` |
  | Page and surfaces | `var(--color-bg-background)`, `var(--mat-sys-surface)`, `var(--mat-sys-surface-container)` |
  | Hover and highlight | `var(--color-bg-hover)`, `var(--color-bg-highlight)` |
  | Good, bad | `var(--color-success)` (with `-50` and `-contrast`), `var(--mat-sys-error)` |
  | Lines and greys | `var(--mat-sys-outline-variant)`, `var(--color-grey-100)` to `var(--color-grey-900)` |
  | Shadows | `var(--mat-sys-level1)` to `var(--mat-sys-level5)`, never a hand-made `box-shadow` |

  The full list is in `src/ambivo/styles/themes/_light_theme.scss`. Read it; do not copy values out of it.
- **Fonts: Roboto, from the starter.** Never set `font-family`, never load another font. Icons are
  Material Symbols (`<mat-icon>name</mat-icon>`), never another icon set.
- **Text:** Material typography and the starter's text classes (`text-muted`, `text-secondary`,
  `text-small`, `text-bold`, `text-truncate`). No hand-picked font sizes.
- **Components:** Angular Material and the Ambivo pieces listed above (`am-block-status`,
  `am-button-group`, `DialogLayout`...). Never Bootstrap, Tailwind, PrimeNG, ng-zorro, Font Awesome
  or another UI kit, not even for one widget.
- **Spacing and layout:** the layout atoms and the starter's flex and utility classes, not
  hand-written margins.
- **Never edit `src/ambivo/`.** It is copied from Ambivo's own code and is replaced on update. Put
  app styles next to the component that needs them.
- **Branding:** the app's name and logo come from its runtime config (`appName`, `logoUrl`). Do not
  restyle the theme for one client.

### Layout

- Build layout from the atoms, not hand-written flex and margins. When an atom almost fits, use it anyway.
- Empty, error and loading states of a block are `am-block-status`.
- A status (Open, In trials, Approved) is an Angular Material chip: `<mat-chip>` from `MatChipsModule`,
  with an icon as `<mat-icon matChipAvatar>`. The starter's theme styles it. Never build a chip from a
  `span` with your own padding, radius and icon size.
- Native control flow only: `@if`, `@for`, `@switch`. `[class.x]` / `[style.x]`, never `ngClass` / `ngStyle`.
- Action rows are `am-button-group`.
- Filters above a list or report sit in one row (`amCluster`) on a wide screen and wrap on a phone. Never
  stack each filter full width down the page. Show a number and its unit the same way in every column.
- Wide content (tables) scrolls inside its own container. The page never scrolls sideways.
- Icons: `<mat-icon>name</mat-icon>` with Material Symbols names.
- The layout must work on a phone held in one hand. Many users are on the shop floor.

### Checking your screens

Look at what you built before you say a screen is done. With the app running (`npm start` in the
background, or Dev Studio's preview), take a screenshot and read the PNG:

```
npm run ambivo:screenshot -- /samples            # desktop, 1280 wide
npm run ambivo:screenshot -- /samples --phone    # phone, 390 wide
```

It prints where the PNG is (under `.ambivo/screens/`, never shipped). Check the layout, the Ambivo look,
the empty and error states, and the phone width. Pages behind sign-in need `AMBIVO_TOKEN` (the sandbox
session) and the starter's development-only hook in `AuthService`. An app made from an older starter may
not have the hook; add it to the `AuthService` constructor:

```ts
declare const ngDevMode: boolean | undefined;   // above the class
// in the constructor:
if (typeof ngDevMode !== 'undefined' && ngDevMode) {
  (globalThis as any).__ambivoDevSignIn = async (token: string) => {
    this.session.set(token);
    await firstValueFrom(this.refreshUser());
    return true;
  };
}
```

A production build leaves this code out. Never store the token anywhere else.

### Left navigation (apps with several screens)

An app with more than two or three top-level screens gets a left menu. The starter has one ready,
outside the synced folder: `src/app/shell/app-shell.component.ts` (Angular Material `mat-sidenav` with a
`mat-nav-list`, the top bar with the app name and Sign out) and `src/app/shell/nav.ts` (the menu items).
On a wide screen the menu stays open beside the page; on a phone it opens from the menu button and
closes after a tap. It is not used until you wire it in:

1. Make the shell the parent of every signed-in page in `src/app/app.routes.ts`, still ABOVE the sign-in
   layout route:

   ```ts
   {
     path: '',
     component: AppShellComponent,
     canActivate: [signedInGuard],
     children: [
       { path: '', pathMatch: 'full', loadComponent: () => import('./home/home.page').then((m) => m.HomePage) },
       { path: 'projects', title: $localize`Projects`, loadComponent: () => import('./projects/project-list.page').then((m) => m.ProjectListPage) },
     ],
   },
   ```

2. Add one `NAV_ITEMS` entry per top-level screen, in the order people use them: `path`, a
   `$localize`-tagged `label`, a Material Symbols `icon`, and `exact: true` for `/`.
3. Remove the `mat-toolbar` from `home.page.ts`: the shell has the top bar now.

Detail pages (`projects/:id`) are child routes without a menu entry. Keep the menu to one level;
group with headings in `nav.ts` only when it passes about 10 entries. Do not build a second menu
component, and do not put the menu in `src/ambivo/`.

### Dialogs

CDK `Dialog` with `DialogLayout`. Inject `DIALOG_DATA` and `DialogRef`; read the result from `.closed`.
Never `MatDialog`, `MAT_DIALOG_DATA`, `MatDialogRef`, `afterClosed()` or `mat-dialog-*`.
The starter already sets `panelClass: 'am-dialog'`.

### Loading data

Data comes from the Ambivo API only: Ambivo records, or the app's custom objects. Never add a server,
a database or a new API to the app. If a feature needs storage, it is a custom object.

- What a component shows comes from a resource (`rxResource` or `paginatedResource`) whose params come from signals.
- No fetching in `ngOnInit` or the constructor, no manual refresh of everything.
- Expose template data through `computed` guarded by `hasValue()`. `value()` throws in the error state.
- Keep resource params primitive. Gate a lazy fetch with `undefined` params.
- Paged lists use `paginatedResource`.

### Changing data

- Every subscription carries `indicate(this.busy)` and `takeUntilDestroyed(this.destroyRef)`.
- Never write `busy.set(true)` / `busy.set(false)` by hand.
- Disable controls on `computed(() => this.busy() || resource.isLoading())`.
- After a change, reload only the resources that change affected.

### Forms

Reactive forms only. Validation across fields goes in a validator, not in the submit handler.
Never change a `FormControl` from an `effect`.

### Words on screen

- Every visible string is `$localize`-tagged, in templates (`i18n`) and in TypeScript.
- Never build a sentence from pieces. One template string with placeholders.
- Plain words for a shift worker on a phone: short sentences, no jargon, no internal names
  ("tenant", "entity", "payload"). An error says what went wrong and what to do.
- Keep the number: counts, amounts, codes and names belong in the sentence.

### Before you say it is done

```sh
npx ng build                                   # must pass with no errors
npm run ambivo:check   # must report no problems
```

---

## The app's own data: custom objects

### The rule: no backend of your own

An Ambivo app is a front end on the Ambivo API. It never gets its own server, database, Mongo
collections, tables, serverless functions or API service. When a feature needs to store something,
that is a custom object, and the app reads and writes it through the `/custom/object` endpoints.

- Need a list of records, a form, a detail page? A custom object and its data endpoints.
- Need records that point at each other? Linked custom objects (`reference_fields`), below.
- Need files or comments on a record? The custom object files and comments endpoints.
- Need logic to run on the server when a record changes? Ask the user first. Ambivo workflows can run
  on custom object changes; check the workflows spec before promising it.
- Something truly cannot be done with the Ambivo API and custom objects? Stop and tell the user what
  is missing. Do not build a server to work around it.


First check whether Ambivo already has the record type. Leads, contacts, accounts, tasks, products,
inventory items, movements, sites, purchase orders, invoices and bills already exist; use them through
the `ambivo-api` skill. Make a custom object only for what is truly the app's own.

### What a custom object is

A record type the app defines inside one tenant. Its records are checked against a JSON Schema.
Objects can point at each other with `reference_fields`, which gives parent and child records.
Each tenant's records live in their own collection; no other company can see them.

Look up the exact contract before writing code:

```sh
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-spec.mjs get POST /custom/object
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-spec.mjs get POST /custom/object/data
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-spec.mjs get GET /custom/object/data
```

| call | does |
|---|---|
| `GET /custom/object?collection_id=…` | one definition. Missing: `result: 2`, `OBJECT_NOT_FOUND`. Without `collection_id`: the list, in `custom_object_list` |
| `POST /custom/object` | define an object. **Tenant admin only.** Counts against the plan's limits |
| `PUT /custom/object` | change it. **Tenant admin only.** `schema` replaces the whole schema: send every field |
| `POST /custom/object/data` | create: `{ collection_id, data }` → `{ result: 1, id, data }` |
| `GET /custom/object/data` | list: `page_num`, `page_size` (default 30), `match_filter_dict`, `sort_dict`, `search_text` → `data_list`. One record: `&id=…` (an empty `data_list` means missing or not visible). Also `action=get_picklist`, `aggregate`, `export`, `get_schema` |
| `PUT /custom/object/data` | update: `{ collection_id, id, data }` → the whole record, or `RECORD_NOT_FOUND_OR_ACCESS_DENIED` |
| `DELETE /custom/object/data` | `?collection_id=…&id=…`, or `action=delete_many&ids_list=[…]` (skipped ids come back in `not_deleted_ids`) |
| `POST /custom/object/data/comment/manage` | comments: `{ action: add, entity_type: <collection_id>, entity_id, comment }`; also `get`, `update`, `delete` |
| `GET /custom/object/data/files` | files on a record: `match_filter_dict={"entity_type":…,"entity_id":…}` → `file_list` |
| `POST /custom/object/data/import` | bulk import: `import_payload`, `field_mappings_dict` maps **schema field → source column** |

Records come back with `id` (not `_id`) and dates as `"YYYY-MM-DDTHH:MM:SSZ"`.
Never use `/custom/module/*`: those older routes do not apply a custom object's access rules.

### Naming: one tenant may run several apps

- `collection_id` is 4 to 100 lowercase letters, digits or `_`, and must not start with `ambivo`.
  These ids are refused: `lead`, `contact`, `account`, `opportunity`, `task`, `user`, `order`,
  `bill`, `product`, `invoice`, `payment`.
- It must be unique in the tenant. **Prefix every object with the app's key**:
  `stockroom_count`, `stockroom_count_line`. Never a bare `count` or `item`. Use exactly the same id
  on every call.
- Field names: letters, digits and `_`, not starting with `_id`. Types: `string`, `int`, `double`,
  `bool`, `date`, `objectId`, `object`, `array`.
- Set `hosting_apps: ["<app key>"]` and `tags: ["<app key>"]` on every object the app creates, so the
  app can find its own objects and nothing else. `hosting_apps` is also what marks the object as a standalone
  app's object, not part of an Ambivo app such as the CRM.
- Do not copy the output of `agent/schema/generate` into `schema_meta`, and never write the CRM's object format
  there. `schema_meta` holds the definition of objects built *inside* the CRM. An object with `hosting_apps` is
  never also a CRM object. `schema_meta` is yours to leave empty or to use for your own install notes.
- Do not include the system fields (`userid`, `updated_by_userid`, `created_ts`, `updated_ts`,
  `access_dict`). The API adds them.

### Linked objects

Put the link on the child, as a string field holding the parent record's `_id`:

```json
"reference_fields": {
  "count_id": { "target_collection": "stockroom_count", "on_delete": "cascade", "display_field": "name" }
}
```

`on_delete`: `restrict` blocks deleting a parent that has children; `cascade` deletes the children;
`nullify` clears the link; `none` leaves orphans. Pick deliberately and say why in the design.
Create parents before children. To link to an Ambivo record (a product, a site), store its id or
code as a plain field; `reference_fields` only point at custom objects.

### Who may see and change records

Two checks run on every call. **First the object:** `data_access_dict` says who may create (C),
read (R), update (U) and delete (D) records at all, keyed by userid, `*` or `all`. A refusal is
HTTP 403 with an empty body. **Then the record:** a person may act on a record they own, or one whose
`access_dict` gives them (or `*`) that letter. Tenant admins pass both checks.

- **The default `data_access_dict` lets others create records but refuses their reads (403).**
  A shared app (a team counting stock) must set it: `{"*": ["C", "R", "U", "D"]}`.
- `default_access_dict` is copied onto each new record. Set it to who should see records, for example
  `{"*": ["R"]}` so everyone reads and only the owner and admins change. Without it, only the record's
  owner and admins see it.
- To share one record later, update its `data.access_dict`.
- Guests never get the `*` or `all` grants; they reach only records they own or are named on.
- `default_access_dict` can be changed later with `PUT /custom/object`; it applies to new records.

### Traps

- Send JSON booleans and numbers. Text like `"false"` or `"1,200"` is converted, but be exact.
- Send dates as ISO text (`2026-10-03T14:00:00Z`). Epoch seconds are read in the server's time zone.
- A key that is not in the schema is refused: `INVALID_REQUEST_INVALID_KEY_IN_DATA_PAYLOAD`.
- A missing required field fails as "Document failed validation".
- Lists have no `last_id` cursor and no default order: always send `sort_dict`. `gross_count` (the
  real total) comes on page 1 only.
- A schema change never touches existing records. A removed field stays in old records; a renamed
  field is a new field (copy values over with an update); a new type applies to new writes only.
- Deleting a parent with `on_delete: cascade` deletes its children, one level only.
- `file_ids_list` in `data` links files you uploaded; it is not stored as a field. Upload with
  `POST /user/file_upload`, `storefile_file_purpose=store_file`, and
  `storefile_custom_fields={"entity_type":"<collection_id>","entity_id":"<record id>","is_custom_module_entity":true}`.
- A custom object cannot be renamed. Choose the id with care.

### One client or many: the install step

The app never creates its objects while someone is using it. A separate install step does it, run once
per client tenant by that tenant's admin:

- `src/install/app-objects.json`: every object the app needs, in creation order, plus an `app_version`,
  and `core_links`: for each object, the fields that hold an Ambivo record's id and which record. The
  install step does not send it; Dev Studio's data model diagram reads it.

  ```json
  { "app_version": "1.0.0",
    "objects": [ ... ],
    "core_links": { "lab_project": { "customer_account_id": "account", "lead_userid": "user" },
                    "lab_trial": { "stock_txn_ids": "inventory_txn" } } }
  ```

  The record names are `account`, `product`, `user`, `site`, `inventory_txn` and `file`.
- `src/install/install.mjs`: reads the admin token from an environment variable (never from a file),
  checks the tenant has the plan and modules the app needs, then for each object calls
  `GET /custom/object?collection_id=...`: on `OBJECT_NOT_FOUND` it creates it (`POST`), otherwise it
  updates it (`PUT`, with every field). It is safe to run again. It prints what it did.
  It prints the signed-in user and the tenant id, read from the session token's `tenant_id` claim
  (`GET /user/data` does not return the tenant). It takes `--tenant <id>` and refuses to change any other
  tenant, so an admin signed in to the wrong company changes nothing. The README's install command uses it.
  It reads `app-objects.json` next to itself (`new URL('./app-objects.json', import.meta.url)`) and uses
  nothing outside `src/install`: Dev Studio's **Deploy** copies that folder and runs the copy in the
  client's company, with `AMBIVO_TOKEN` set to the client admin's session and `--tenant` set. A step that
  imports `../` cannot be deployed.
- **Single-client app:** run it once for that client.
- **App for many clients:** run it once per client; nothing in it may name one client's sites, ids or
  data. The app reads per-client values (sites, picklists) from the API at runtime.

### Before you say it is done

- Every object has the app prefix, `hosting_apps` and `tags`.
- Each link has a chosen `on_delete`.
- `data_access_dict` lets the app's users read, and `default_access_dict` matches who should see records.
- `install.mjs` was run against the sandbox tenant twice, and the second run changed nothing.

---

## Sample data in the sandbox

Screens are easier to build and check with a few real-looking records behind them. This skill
creates them in the developer's **partner sandbox**, linked the way real records are, and removes
them again.

### The sandbox rule

- Sample data goes **only** into a partner sandbox: a company whose tenant carries
  `meta.partner_sandbox.partner_key`. Never into a client's company, never into any other.
- Check before the first write. `GET /user/admin/tenant` returns `tenant_dict`; a sandbox has
  `tenant_dict.meta.partner_sandbox.partner_key`. If it is missing, stop and say: "You are signed in
  to a company that is not your sandbox. Sign in with your sandbox email to add sample data."
- Never use a real person's details. Emails are at `example.com` with a plus tag
  (`maria+northwind@example.com`). Phone numbers are fictional: 555-0100 to 555-0199 with any area
  code. Company and people names are invented.

### When to offer it

After the brief is approved, before or while you build the first screens. Offer it like every
other question, with a recommendation, for the record types in the brief:

> Shall I add sample data to your sandbox for: accounts, contacts, opportunities, and the app's
> stock counts?
> Recommended: yes, 5 of each. The screens then show real-looking records, linked to each other.
> I tag them `sample:<app key>` and can remove them all later.

- Recommend 3 to 8 records a type. Fewer for parents (accounts, products), more for what the main
  screen lists. Never more than the screens need.
- Only the types the app reads or shows. An app about tasks needs tasks and whatever they point at.
- Never offer it when the signed-in company is not a sandbox.
- Tell the user what you made: the types, the counts, and that cleanup removes exactly those.

### Without the MCP server

Agents without the plugin's MCP server use the same routes with the developer's own token, in the
same order, with the same fields and flags. The sandbox rule still applies: read
`GET /user/admin/tenant` first and stop unless `tenant_dict.meta.partner_sandbox.partner_key` is set.
Write each new id to `.ambivo/sample-data.json` (`{"records": [{"entity", "id", "ref"}]}`) and
delete from that list, children first. Never write a script that deletes by search or by tag.

### The order, and where each parent id goes

Every route below answers HTTP 200; check `result === 1` **and** that the new id is there. The
action-style routes take `{"action": "add", "payload": {...}}`; flags such as
`suppress_automation_triggers` sit next to `action`, never inside `payload`. Ids for update and
delete also sit at the top level (`"lead_id": "..."`). Send booleans as JSON booleans and numbers as numbers.

| # | record | create | new id at | parent ids it takes |
|---|---|---|---|---|
| 1 | product | `POST /product/manage_product` | `data.product_id` | none |
| 2 | account (customer or vendor) | `POST /user/customer/account` | `data.account_id` | none |
| 3 | contact | `POST /user/contact` | `data.id` | `account_id` |
| 4 | lead | `POST /user/lead` | `data.id` | none |
| 4b | lead to contact | `POST /user/lead/convert_to_contact` `{"lead_id"}` | `converted_contact_dict.id` | the lead |
| 5 | opportunity | `POST /user/opportunity` | `data.opportunity_id` | `contact_id` and/or `account_id`; `product_dict_list[].product_id` |
| 6 | task | `POST /user_tasks` (the task itself, no `action`) | `user_task_id` (top level) | `subject_type` + `subject`; `opportunity_id` |
| 7 | order | `POST /user/order/manage` | `data.order_id` | `contact_id` and/or `account_id`, `opportunity_id`, `order_line_list[].product_id` |
| 8 | invoice | `POST /user/invoice/manage` | `data.invoice_id` | `contact_id` and/or `account_id`, `order_id`, `invoice_line_list[].product_id` |
| 9 | payment | `POST /user/payment/manage` | `data.payment_id` | `applied_to_list[].document_id` (an invoice) |
| 10 | bill | `POST /user/bill/manage` | `data.bill_id` | `account_id` (a vendor account), optional `order_id` |
| - | custom record | `POST /custom/object/data` `{collection_id, data}` | `id` | the object's `reference_fields` |

Delete, children first: payments, invoices, bills, orders, tasks, opportunities, leads, contacts,
accounts, products. Each action-style route deletes with `{"action": "delete", "<entity>_id": "<id>"}`
(`account_id`, `contact_id`, `lead_id`, `opportunity_id`, `product_id`, `order_id`, `invoice_id`,
`bill_id`, `payment_id`). Tasks: `DELETE /user_tasks?task_ids=["<id>"]`. Custom records:
`DELETE /custom/object/data?collection_id=<id>&id=<record id>`.

#### 1. Product

Minimal: `name`, unique in the company (inactive products count). `sku` defaults to the name;
`product_type` defaults to `service` (also plain, consumable, subscription, bundle, inventory,
software, property, insurance). Leave out `category_sku`.

```json
{"name": "Support plan, annual", "sku": "SUP-ANNUAL", "product_type": "service", "price": 1200, "description": "Phone and email support"}
```

- `price` comes back as a string (`"1200.0"`).
- A missing `name` is an HTTP 500, not a message.
- Only a company admin can delete a product. For anyone else the reply is `result: 1` with
  `data.deleted: false`. Check `deleted`.
- If the company invoices through Stripe (`tenant_dict.invoicing_system == "stripe"`), every new
  product is also created in Stripe. Make no sample products there.

#### 2. Account (customer or vendor)

Minimal: `name` and an `email_list` or `phone_list`. A vendor is an account with
`relationship_type: "vendor"`; the others are customer (default), partner, prospect, other.

```json
{"name": "Northwind Traders", "relationship_type": "customer", "status": "customer",
 "email_list": [{"email": "ap+northwind@example.com", "type": "work"}], "description": "Wholesale customer"}
```

- Each `email_list` and `phone_list` item must be an object with a `type`. A plain string or an item
  without `type` is dropped, and then the add is refused.
- `source`, when sent, must be a marketing source the company has. Any other value is refused.
- `status`: customer (default), prospect, ex-customer, or a contact status.
- **Deleting an account also deletes every contact and opportunity linked to it.** It is refused while
  a `closed_won` opportunity points at it.

#### 3. Contact

Minimal: `first_name` and `last_name` (or `name`), and `email_list` or `phone_list`.
Parent: `account_id` holds the account's `account_id`; an unknown id is refused.

```json
{"first_name": "Maria", "last_name": "Lopez", "account_id": "<account id>", "status": "open",
 "email_list": [{"email": "maria+northwind@example.com", "type": "work"}], "title": "Buyer"}
```

- Send `skip_duplicate_check: true` next to `action`. Without it, an email that matches a contact
  turns the add into an update of that contact, and its owner gets a bell, push and SMS.
- With no email and no phone the API answers HTTP 500.
- `status`: open, assigned, attempted, contacted, meeting-setup, customer, lost-followup, lost,
  inactive, incorrect, disqualified. A `lead_status` you send is copied to `status`.
- Never send `registered_userid`. Deleting a contact deletes a guest user linked that way.

#### 4. Lead

Minimal: a name (`first_name`, `last_name`) and `email_list` or `phone_list`.

```json
{"first_name": "Ana", "last_name": "Silva", "lead_source": "Referral", "lead_status": "open",
 "email_list": [{"email": "ana+lead1@example.com", "type": "work"}], "description": "Asked for a quote"}
```

- **`email_list`, never `email`.** A plain `email` is ignored and the add is refused with no message.
- **`lead_source`** must be a value Ambivo knows, or it is saved as `Unknown` with no error: Google,
  Facebook, Youtube, Reddit, Snapchat, Craigslist, Yelp, Linkedin, Incoming-Call, SMS, Referral,
  Bing, Yahoo, Nextdoor, Unknown, TikTok, Instagram, Billboard Ad, or one of the company's own
  sources (`GET /entity/data?entity_type=marketing_source&action=picklist`). Vary it across leads.
- **Update** takes `lead_id` at the top level, next to `action`.
- `lead_status`: open, assigned, attempted, contacted, disqualified, incorrect. Never `meeting-setup`:
  it can convert the lead on its own.
- A lead's created date is always "now". To show older leads, vary the status, not the date.
- **Duplicates cannot be switched off for leads.** An email or phone that matches another lead can
  turn the add into an update of that lead, which notifies its owner. An email that matches a
  contact is refused and leaves a comment on that contact. Use unique plus-tagged emails.
- **Convert** (`POST /user/lead/convert_to_contact` with `{"lead_id"}`) makes a contact from the lead.
  The lead stays, marked converted, so delete both. It runs the company's automations for a new
  contact; no flag stops that. It takes no `account_id`; set it on the contact afterwards.

#### 5. Opportunity

Minimal: `name`, `contact_id` or `account_id`, and a product.

```json
{"name": "Northwind renewal 2027", "account_id": "<account id>", "contact_id": "<contact id>",
 "stage": "negotiation_review", "estimated_value_of_sale": 1200, "probability_pcnt": 60,
 "expected_close_date": 1798761600,
 "product_dict_list": [{"product_id": "<product id>", "unit_amount": 1200, "unit_count": 1}],
 "business_need_description": "Renews the support plan"}
```

- Send `suppress_automation_triggers: true` and `page_size: 1` next to `action`.
- Lines use `unit_amount` and `unit_count`. The spec's `price` and `quantity` are ignored.
- `stage`: prospecting, discovery, developing, negotiation_review, contract_pending, draft, or the
  company's own stages. **Never `closed_won` or `closed_lost`**: closing creates an order or runs the
  lost steps. Show closed deals with a custom stage, or leave them out.
- **A name that matches an open opportunity on the same account updates that one.** The reply then
  has no `data.created`. Use a unique name.
- `expected_close_date`: epoch seconds or an ISO date. Mix past (overdue) and future dates.
- There is no `description`; use `business_need_description`.

#### 6. Task

Minimal: `name` and `due_date` (epoch seconds). The body is the task itself.

```json
{"name": "Call Maria about the renewal", "due_date": 1791936000, "subject_type": "opportunity",
 "subject": "<opportunity id>", "opportunity_id": "<opportunity id>", "priority": 2,
 "status": "assigned", "description": "Confirm the seat count"}
```

- The link is `subject_type` (contact, lead, account, opportunity...) plus `subject` (the id). Neither
  is checked, so get them right. Also set `opportunity_id` on opportunity tasks.
- **Leave out `userid`.** A task assigned to someone else sends them a bell, a push and app messages,
  and no flag stops it. Sample tasks belong to the signed-in developer.
- Leave out `create_cal_event` (any value, even `"false"`, creates a calendar event) and
  `notifications_on` (reminders).
- Update: `PATCH /user_tasks` with `user_task_id` in the body.
- Mix overdue, due today and future `due_date`s, and several `status` values.

#### 7. Order

Minimal: `contact_id` or `account_id`.

```json
{"name": "Northwind support order", "account_id": "<account id>", "contact_id": "<contact id>",
 "opportunity_id": "<opportunity id>", "order_type": "sales", "stage": "draft", "order_date": "2026-09-15",
 "order_line_list": [{"product_id": "<product id>", "description": "Support plan", "line_detail_dict": {"qty": 1, "unit_price": 1200}}]}
```

- Send `suppress_automation_triggers: true` next to `action`.
- **`stage` draft or open only.** `fulfilled`, `pending_fulfillment` and `invoiced` book commissions,
  raise an invoice and add installed-base records, with no flag to stop them.
- **Never send `order_num`, `data_source`, `source_id` or `source_realm_id`.** A match turns the add
  into an update of that order.
- Leave out `commissions_list`.
- The reply says `result: 1` even when the order was refused. Check `data.order_id`.
- `product_id` on a line must be a product in the company.

#### 8. Invoice

Minimal: `contact_id` or `account_id`.

```json
{"name": "Northwind support, 2027", "account_id": "<account id>", "contact_id": "<contact id>",
 "order_id": "<order id>", "invoice_type": "sales", "stage": "draft", "invoice_date": "2026-09-20",
 "invoice_due_date": "2026-10-20", "books_accounting_status": "not_required",
 "invoice_line_list": [{"product_id": "<product id>", "description": "Support plan", "line_detail_dict": {"qty": 1, "unit_price": 1200}}]}
```

- **`stage: "draft"` and `books_accounting_status: "not_required"`, always.** Any other stage posts
  to the company's books.
- Never send `invoice_num` or `source_*`: a match updates that invoice. Numbers come from a counter.
- Never call `POST /user/invoice/send`: it emails the customer.
- If the company invoices through Stripe, every invoice is also made in Stripe. Make none there.
- Deleting an invoice runs the company's delete automations; no flag stops that.

#### 9. Payment (from a customer)

Minimal: `amount` above 0, and `payment_type` or an `applied_to_list` of invoices.

```json
{"payment_type": "customer_receipt", "account_id": "<account id>", "amount": 400,
 "payment_date": "2026-09-25", "payment_method": "check", "reference_number": "CHK-1042",
 "status": "pending", "books_accounting_status": "not_required",
 "applied_to_list": [{"document_id": "<invoice id>", "document_type": "invoice", "amount_applied": 400}]}
```

- **`status: "pending"` and `books_accounting_status: "not_required"`, always.** The default status
  is `completed`, which posts to the books.
- Apply less than the invoice total. A payment that settles the invoice moves it to `paid`.
- `payment_method`: cash, check, credit_card, debit_card, bank_transfer, ach, wire, zelle, stripe, paypal, other.
- Deleting a payment does not restore the invoice balance. Delete the invoice too.

#### 10. Bill (from a vendor)

Minimal: `account_id` of a vendor account. Nothing else is checked.

```json
{"account_id": "<vendor account id>", "description": "Shelving for store 2", "memo": "PO 7781",
 "stage": "draft", "transaction_date": "2026-09-10", "due_date": "2026-10-10", "total_amount": 860,
 "currency": "USD", "books_accounting_status": "not_required",
 "line_list": [{"description": "Steel shelving", "quantity": 4, "amount": 860}]}
```

- **`stage: "draft"` and `books_accounting_status: "not_required"`, always.**
- The company needs the Books Pro feature; otherwise the add fails with `BOOKS_REQUIRES_PRO`.
- Dates are `"YYYY-MM-DD"` text here, unlike most routes.
- **No sample bill payments.** A vendor payment (`vendor_payment`, or any payment applied to a bill)
  is sent to QuickBooks when the company is connected, and no flag stops it. Show bills as unpaid.

#### Custom objects

1. Read the object: `GET /custom/object?collection_id=<id>` gives `custom_object.reference_fields`;
   `GET /custom/object/data?action=get_schema&collection_id=<id>` gives the field types and system fields.
2. Order the objects so every `reference_fields` target comes before the object that points at it.
   Create parents, keep their ids, then children. A link to a parent that does not exist is refused
   with `REFERENCE_VALIDATION_FAILED`.
3. Fill every required field. Send only fields in the schema: any other key, `tags` included, is
   refused with `INVALID_KEY_IN_DATA_PAYLOAD`. Leave out `userid`, `created_ts`, `updated_ts`, `access_dict`.
4. Values by type: `string` plausible text, `int` and `double` realistic amounts, `bool` JSON
   booleans, `date` ISO text (`2026-10-03T14:00:00Z`), links as the parent's `id`.
5. Send `suppress_automation_triggers: true` next to `collection_id`. The company's workflows still
   see the new record; a new sandbox has none.

```json
{"collection_id": "stockroom_count_line", "suppress_automation_triggers": true,
 "data": {"count_id": "<stockroom_count id>", "product_name": "Steel shelving", "qty": 4, "counted_at": "2026-10-02T09:30:00Z"}}
```

Deleting a parent whose link has `on_delete: cascade` deletes its children too; `restrict` refuses
it while children exist. Delete children first either way.

### Make it look real

- Plausible, invented names: "Northwind Traders", "Maria Lopez", "Harbor Street Café". Mix company
  sizes and countries. Never a real person or a real customer of the partner.
- Vary what the screens filter and sort by: statuses and stages, sources, owners left as the
  developer, amounts across a range, dates in the past (overdue), today and the future.
- Link them the way real work is: a few contacts per account, an opportunity per account, tasks on
  some of them, one order and invoice for a won-looking deal, a part payment on one invoice.
- Emails `name+tag@example.com`. Phones only when the screen shows them, from 555-0100 to 555-0199.
- Keep the counts small. Five good records show a screen better than fifty.

### Side effects, checked in the API code

| record | turned off by | cannot be turned off |
|---|---|---|
| all action-style creates | `suppress_automation_triggers: true` (lead, contact, account, opportunity, order, invoice, product, custom) | custom records still reach the company's workflows |
| lead | keep `notify_owner_on_new_lead` false, no `registered_userid` | duplicate check (an add can update another lead and notify its owner); the email domain check may add a "(SYS ADDED) WARNING (SPAM?)" comment on example.com addresses |
| contact | `skip_duplicate_check: true` | none found on create; delete removes a linked guest user |
| account | none needed | delete removes linked contacts and opportunities |
| opportunity | open stages only | closed stages create an order or run the lost steps; delete removes its tasks |
| task | leave out `userid`, `create_cal_event`, `notifications_on` | assigning to someone else notifies them |
| product | none needed | Stripe product when the company invoices through Stripe |
| order | draft or open stage, no `commissions_list` | later stages book commissions and raise invoices |
| invoice | draft stage, `books_accounting_status: "not_required"` | Stripe invoice when the company invoices through Stripe; delete automations run |
| bill | draft stage, `books_accounting_status: "not_required"` | none on create |
| payment | `status: "pending"`, `books_accounting_status: "not_required"` | vendor payments go to QuickBooks: never created |

No create route sends email or SMS by itself. `POST /user/invoice/send`, `/messages/send_sms`,
`/user/document/send` and every admin, user, tenant, billing and Stripe route are never used for sample data.

### Where the spec and the API differ

- `POST /user/order/manage`, `POST /user/invoice/manage`, `/user/payment/manage` and
  `/user/payment/apply` are missing from the specs. The workflows spec's `/user/order/{id}` and
  `/user/invoice/{id}` are served by the workflows host, not `ingress.ambivo.com`.
- `POST /user/bill/manage`: the spec puts `bill_id` inside `payload`; the API reads it at the top level.
  The spec leaves out the Books Pro requirement.
- Opportunity: the spec's line keys `quantity` and `price` are ignored (use `unit_count` and
  `unit_amount`); the spec does not say a product is required or that a same-name add updates.
- Contact: the spec's add example uses `"lead_status": "active"`, which the API refuses.
- Account: the spec's address example has no `address` key, so the address is dropped. The spec does
  not say an unknown `source` is refused.
- Task: the reply carries `user_task_id` at the top level; the automations spec puts it under `data`.
- Product: the spec has no `tags` and gives `price` as a number; the API keeps tags and returns
  `price` as text.
- None of the specs mention `suppress_automation_triggers`, `skip_duplicate_check` or
  `books_accounting_status`.
- `DELETE /entity/data` cannot clean up sample data. Lead and contact deletes there fail, and bills,
  payments and custom records are not supported. `action=reset` empties whole record types: never use it.

---

## Building a large app in phases

One conversation is fine for a one-page app. A lab system with 10 custom objects and 20 screens is
not: the conversation runs out of room, costs more with every message, and the partner gets no
checkpoints. So a large app is built in phases. Each phase is one coherent module, built in its own
conversation, checked by the partner in Preview, and approved before the next one starts.

### When to plan phases

Plan phases when any of these is true:

- the app has more than about 5 screens;
- it needs more than about 4 custom objects;
- the client sent a brief document.

Otherwise follow the normal `/ambivo-new-app` steps in one conversation.

### Phase 0: brief and data model

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

### Sizing a phase

- One coherent module: for example "Projects and samples", or "QC batches and approval".
- Finishable in one conversation: about 2 to 5 screens, or one install step. Split anything bigger.
- Reviewable in Preview: the partner can open it, click through it and say yes or no.
- Ends with a working build. Never leave half a screen for the next phase.

### The usual phases

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

#### The Prototype phase

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

### docs/PHASES.md

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

### Starting a phase

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
   npm run ambivo:screenshot -- /samples --phase <id>
   npm run ambivo:screenshot -- /samples --phase <id> --phone
   ```

   Fix what looks wrong (layout, the Ambivo look, empty and error states), build again, and take the
   screenshots again. The partner sees them next to the phase in Dev Studio before approving it.
6. Write the handoff note, then stop.

### The data model is the single source of truth

`docs/DATA_MODEL.md` decides every object, field and link. When a phase needs a change (a new field, a
different `on_delete`), change `docs/DATA_MODEL.md`, change `src/install/app-objects.json` to match
when it exists, and say what changed and why in the handoff note. Never let the code and the data model
disagree. Adding phases or changing later phases means editing `docs/PHASES.md`; say so in the note.

### The handoff note: docs/phases/<id>.md

```markdown
## <Phase title>

### What was built
### Files
### Decisions
### Known gaps
### Screens
One line per screenshot in `.ambivo/screens/<id>/`: the file, and what it shows.
### How to test it in Preview
1. Click Preview, sign in with your sandbox account.
2. Open <menu item>. You should see ...
```

Write the test steps for someone clicking, not reading code.

### Approval

- Only the partner approves a phase: the **Approve phase** button in Dev Studio, or "approved" in a
  terminal. Never mark a phase approved yourself, and never start the next phase without that approval.
- End every phase with: "Phase <title> is ready. Check it in Preview, then click Approve phase."
- While a phase waits for approval the partner can still ask for changes in the same conversation.
  Update the handoff note when you change something.

---

## The user guide

The guide is for the people who use the app every day, and for the admin who sets it up. It is not for
developers. It ships to the client with the app.

### What to write

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

### Screenshots

Take them with the screenshot tool while the app runs (start `npm start` in the background if nothing
answers on port 4200). Save them in the guide's folder and look at each one:

```
npm run ambivo:screenshot -- /samples --out docs/user-guide/images/samples.png
npm run ambivo:screenshot -- /samples --phone --out docs/user-guide/images/samples-phone.png
```

Link each one under its step: `![The sample list](images/samples.png)`. One picture for each task is
enough. Add a phone picture where people use the app on a phone. If a page needs data to look right,
use the sandbox's sample records; never invent a screenshot or describe one you did not take.

### How to write

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

### Before you finish

- Every step was checked against the running app, and every picture was looked at.
- No sentence breaks the rules above. Read the guide once only for that.
- Write a short reply: the sections, how many pictures, and anything the guide left out and why.
