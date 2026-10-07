# Ambivo Angular starter

A standalone Angular app that signs people in with their Ambivo account and
looks like Ambivo's own apps. Start every partner app from here.

- Angular and Material 20.1.2, TypeScript 5.8.3: the same versions as ambivo-nx.
- Ambivo theme, fonts (Roboto, Material Symbols) and `am*` layout atoms, copied from ambivo-nx `dev`.
- Sign-in: email and password, then a code by email when the account uses two-step verification.
  SMS codes are not offered in phase 1.

## Run it

```sh
npm install
npm start            # http://localhost:4200
```

`ng serve` sends `/api/*` to `https://ingress.ambivo.com` through `proxy.conf.json`.
A browser on `localhost` cannot call the API directly: Ambivo's firewall refuses
other origins.

## One build, one config per client

At boot the app reads `runtime-config/<host name>.json`:

```json
{ "apiUrl": "https://ingress.ambivo.com/", "appName": "Stock Room" }
```

Without `tenantId`, anyone with an Ambivo account can sign in, and each person sees only their own
company's data. Add `"tenantId": "<id>"` to limit one address to one company: sign-in then refuses
users from any other tenant. Serve one file per host name.

## Folders

| path | what | edit? |
|---|---|---|
| `src/ambivo/` | theme, styles, layout atoms copied from ambivo-nx | **No.** Run `../tools/sync_from_nx.py` |
| `src/app/core/api/` | `ApiService`: every API call goes through it | Rarely |
| `src/app/core/auth/` | sign-in, session, `hasAccess` | Rarely |
| `src/app/sign-in/` | the sign-in screens | Wording only |
| `src/app/home/` | first page after sign-in | Replace with the app |

## Rules the code depends on

- **The API answers failures with HTTP 200 and `result: 2`.** `ApiService` turns that into a thrown
  `ApiError`. Never call `HttpClient` directly for Ambivo.
- **The session token lives in memory only.** Never put it in localStorage, sessionStorage or a cookie.
  A page reload means signing in again.
- **`is_mobile` is always `false`.** The API trusts it as sent, and `true` buys a 180-day token.
- **`hasAccess()` mirrors the API's `has_module_access`.** Use it to hide what the API would refuse.
- Password reset uses Ambivo's own reset page. The API refuses reset links on other domains.

## Keeping in step with ambivo-nx

```sh
../tools/sync_from_nx.py --check   # exit 1 if nx dev has moved on, or nx stopped calling a sign-in endpoint
../tools/sync_from_nx.py           # copy again; the commit is recorded in src/ambivo/SYNCED_FROM_NX.json
```
