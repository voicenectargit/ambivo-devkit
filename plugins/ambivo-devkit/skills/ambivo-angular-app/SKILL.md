---
name: ambivo-angular-app
description: Build or change an Angular app that runs on the Ambivo API, so it looks and behaves like Ambivo's own apps. Use when creating screens, components, forms, dialogs, lists or services in a project made from the Ambivo Angular starter (it has src/ambivo/SYNCED_FROM_NX.json), or when the user asks for an Ambivo-style app. Covers the starter layout, which Ambivo pieces are available, and the coding rules Ambivo's own apps follow.
---

# Building an Ambivo Angular app

Every app starts from the Ambivo Angular starter. `/ambivo-new-app` copies it. The starter gives:
Angular and Material 20.1.2, Ambivo's theme and fonts, sign-in with Ambivo accounts, an `ApiService`
for every API call, and runtime config per host.

## Never edit these

- `src/ambivo/**`: copied from Ambivo's own code. Changes are lost on the next sync.
- `src/app/core/**` (API client, sign-in, session): change only to fix a bug, and say so.
- The sign-in screens in `src/app/sign-in/`: wording only.

Put the app's pages in `src/app/<feature>/`, its API calls in `src/app/<feature>/<feature>.api.ts`,
and add routes in `src/app/app.routes.ts` with `canActivate: [signedInGuard]`, ABOVE the sign-in layout route.

## Ambivo pieces you can import

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

## Components

- Standalone (do not write `standalone: true`), `ChangeDetectionStrategy.OnPush` on every component.
- `input()` / `output()`, never `@Input()` / `@Output()`. No `@HostBinding` / `@HostListener`; use `host`.
- Signals for state, `computed()` for anything derivable. `linkedSignal` for state that resets when
  its source changes. Never `mutate`.
- Strict types. No `any`; `unknown` when the type is truly unknown.
- One job per component. Inline template while it fits on a screen.

## Look and feel: it must look like Ambivo

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

## Layout

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

## Checking your screens

Look at what you built before you say a screen is done. With the app running (`npm start` in the
background, or Dev Studio's preview), take a screenshot and read the PNG:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-screenshot.mjs /samples            # desktop, 1280 wide
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-screenshot.mjs /samples --phone    # phone, 390 wide
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

## Left navigation (apps with several screens)

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

## Dialogs

CDK `Dialog` with `DialogLayout`. Inject `DIALOG_DATA` and `DialogRef`; read the result from `.closed`.
Never `MatDialog`, `MAT_DIALOG_DATA`, `MatDialogRef`, `afterClosed()` or `mat-dialog-*`.
The starter already sets `panelClass: 'am-dialog'`.

## Loading data

Data comes from the Ambivo API only: Ambivo records, or the app's custom objects. Never add a server,
a database or a new API to the app. If a feature needs storage, it is a custom object.

- What a component shows comes from a resource (`rxResource` or `paginatedResource`) whose params come from signals.
- No fetching in `ngOnInit` or the constructor, no manual refresh of everything.
- Expose template data through `computed` guarded by `hasValue()`. `value()` throws in the error state.
- Keep resource params primitive. Gate a lazy fetch with `undefined` params.
- Paged lists use `paginatedResource`.

## Changing data

- Every subscription carries `indicate(this.busy)` and `takeUntilDestroyed(this.destroyRef)`.
- Never write `busy.set(true)` / `busy.set(false)` by hand.
- Disable controls on `computed(() => this.busy() || resource.isLoading())`.
- After a change, reload only the resources that change affected.

## Forms

Reactive forms only. Validation across fields goes in a validator, not in the submit handler.
Never change a `FormControl` from an `effect`.

## Words on screen

- Every visible string is `$localize`-tagged, in templates (`i18n`) and in TypeScript.
- Never build a sentence from pieces. One template string with placeholders.
- Plain words for a shift worker on a phone: short sentences, no jargon, no internal names
  ("tenant", "entity", "payload"). An error says what went wrong and what to do.
- Keep the number: counts, amounts, codes and names belong in the sentence.

## Before you say it is done

```sh
npx ng build                                   # must pass with no errors
node ${CLAUDE_PLUGIN_ROOT}/scripts/ambivo-check.mjs .   # must report no problems
```
