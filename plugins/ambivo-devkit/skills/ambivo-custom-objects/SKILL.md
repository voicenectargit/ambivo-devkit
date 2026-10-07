---
name: ambivo-custom-objects
description: Give an Ambivo app its own data with Ambivo custom objects, including several objects linked to each other. Use when the app needs records Ambivo does not already have (leads, contacts, accounts, tasks, inventory and orders already exist), when designing an app's data model, writing the per-client install step, or reading and writing custom object records, and whenever a feature seems to need its own database, collections, tables or a backend service. Ambivo apps never get their own backend: custom objects are the backend.
---

# The app's own data: custom objects

## The rule: no backend of your own

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

## What a custom object is

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

## Naming: one tenant may run several apps

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

## Linked objects

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

## Who may see and change records

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

## Traps

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

## One client or many: the install step

The app never creates its objects while someone is using it. A separate install step does it, run once
per client tenant by that tenant's admin:

- `src/install/app-objects.json`: the `app_key` (the prefix of every object id, sent as `hosting_apps`), every
  object the app needs, in creation order, plus an `app_version`,
  and `core_links`: for each object, the fields that hold an Ambivo record's id and which record. The
  install step does not send it; Dev Studio's data model diagram reads it.

  ```json
  { "app_key": "lab", "app_version": "1.0.0",
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

## Before you say it is done

- Every object has the app prefix, `hosting_apps` and `tags`. `npm run ambivo:check` refuses an install step without them.
- Each link has a chosen `on_delete`.
- `data_access_dict` lets the app's users read, and `default_access_dict` matches who should see records.
- `install.mjs` was run against the sandbox tenant twice, and the second run changed nothing.
