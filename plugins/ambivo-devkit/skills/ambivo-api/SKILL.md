---
name: ambivo-api
description: How to call the Ambivo API correctly from an app. Use whenever code calls ingress.ambivo.com or any Ambivo endpoint, adds a data service, reads or writes leads, contacts, accounts, tasks, inventory, purchase orders, custom objects or any other Ambivo record, or when a response looks successful but did nothing. Covers the result envelope, sign-in tokens, tenants and sites, paging, /entity/data, and the spec lookup script.
---

# Calling the Ambivo API

Base URL: `https://ingress.ambivo.com/`. In local dev the starter proxies `/api/` to it.
Reference: https://apidocs.ambivo.com (19 OpenAPI specs).

## Look it up before you call it

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

## The envelope: HTTP 200 does not mean success

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

## Sign-in and tokens

- The starter signs people in (`user/login`, then a code by email when needed). Do not write another sign-in.
- The token is a bearer JWT, added by the starter's interceptor. It lasts 24 hours.
- **Keep the token in memory only.** Never put it in localStorage, sessionStorage or a cookie.
- **Never send `is_mobile: true`.** The API trusts it as sent and gives a 180-day token.
- Every call runs as the signed-in person, inside their tenant. The API filters by tenant itself.
  Never send a `tenant_id` to "choose" a tenant on a data call.
- A 401 means the session ended. The starter sends the person back to sign in.
- Hide what the person may not do with `AuthService.hasAccess(module, privileges)`. It mirrors the
  API's own check. Privileges: `C` create, `R` read, `U` update, `D` delete, `A` all.

## Tenants and sites

- A **tenant** is one client company. Everything a person reads or writes stays inside their tenant.
- A **site** (`site_code`) is a place inside a tenant: a warehouse, a shop, an office. Most inventory,
  workforce and procurement records carry a `site_code`. A site also carries which legal company it
  belongs to, so pass the site, not a separate company id.
- Never hard-code a tenant id, a site code, a user id or any record id in code. Read them from the
  API at runtime, or from runtime config.
- **One tenant only.** An app shows the signed-in person's own tenant and nothing else. Never build a
  screen or a call that combines or compares data across tenants, and never use one tenant's token to
  read another. While designing, read only the developer's sandbox.

## Reading many records: `/entity/data`

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

## Paging

Newer routes page with `page_num` (starting at 1) and `page_size`, and reply with `total_count`,
`page_num` and `page_size`. Older routes use other names; the spec says which.

- `total_count` is the number of records on **this page**, not the total.
- The real total is a top-level `gross_count`, and it is sent on page 1 only. Keep it from page 1.
- Search routes often page with a `last_id` cursor instead; `page_num` is ignored there.

## The user's id has two names

`GET /user/data` returns the signed-in user in `user_data` with the id in `userid`. The sign-in
replies (`/user/login`, `/user/mfa/verify`) return the user in `user` with the id in `id`. Read
both (`userid ?? id`), or the app has no user id straight after sign-in.

## Values the server reads loosely

These do not fail. They quietly do something else.

- **Booleans:** send JSON `true` and `false`. Some routes treat any non-empty string as true, so the
  string `"false"` turns the option on.
- **Times:** send epoch **seconds**. A millisecond value is read as a date far in the future.
- **Filters:** send `match_filter_dict` as valid JSON. On some list routes a filter the server cannot
  read is dropped, and you get the unfiltered list back with `result: 1`.

## Routes that look like reads but write

`GET /user/lead`, `GET /user/contact` and `GET /user/lead/search` can update the record they return
(they fill in missing owner details). Treat them as reads in the UI, but do not call them in a loop
over many records.

## Leads: four traps that fail silently

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

## Inventory and purchase orders: use the current routes only

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

## Calling from a browser

Ambivo's firewall refuses browser calls from addresses it does not know, with HTTP 403. In local dev
the proxy hides this. A deployed app on a partner's own domain needs Ambivo to allow that domain
first. If you see a 403 from the firewall, say so; do not try to work around it.

## Tag what the app creates in Ambivo

When the app creates an Ambivo record (an account, contact, lead, opportunity, task, product, order,
inventory item or lot), add the app key to its `tags`: `"tags": ["<app key>"]`, keeping any tags the
user chose. Files carry it as `storefile_app_context`. This is how the app's records are told apart from
everyone else's: the sandbox teardown removes only records with the tag or in the sample-data list. Never
remove the tag on update, and never put another app's key on a record.

## Your own data

When the app needs records Ambivo does not have, use custom objects. See the `ambivo-custom-objects` skill.
