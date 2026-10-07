---
name: ambivo-sample-data
description: Create a few realistic, linked test records in the developer's Ambivo partner sandbox for the record types an app uses (leads, contacts, accounts, vendors, opportunities, tasks, products, orders, invoices, bills, payments and the app's own custom objects), and remove them again. Use after the app brief is approved, when screens need data to show, when the user asks for sample, test, demo or seed data, or asks to clean it up. Only ever in a partner sandbox.
---

# Sample data in the sandbox

Screens are easier to build and check with a few real-looking records behind them. This skill
creates them in the developer's **partner sandbox**, linked the way real records are, and removes
them again.

## The sandbox rule

- Sample data goes **only** into a partner sandbox: a company whose tenant carries
  `meta.partner_sandbox.partner_key`. Never into a client's company, never into any other.
- Check before the first write. `GET /user/admin/tenant` returns `tenant_dict`; a sandbox has
  `tenant_dict.meta.partner_sandbox.partner_key`. If it is missing, stop and say: "You are signed in
  to a company that is not your sandbox. Sign in with your sandbox email to add sample data."
- Never use a real person's details. Emails are at `example.com` with a plus tag
  (`maria+northwind@example.com`). Phone numbers are fictional: 555-0100 to 555-0199 with any area
  code. Company and people names are invented.

## When to offer it

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

<!-- mcp-only -->
## The tools

The plugin's `ambivo` MCP server has two write tools. They check the sandbox rule themselves.

**`sandbox_write`**: `{project_dir, app_key, entity, collection_id?, action?, records}`

- `project_dir`: the app folder (absolute path). `app_key`: the app key, e.g. `stockroom`.
- `entity`: `account` (a vendor is an account with `relationship_type: "vendor"`), `contact`, `lead`,
  `opportunity`, `task`, `product`, `order`, `invoice`, `bill`, `payment`, or `custom` with `collection_id`.
- `action`: `create` (default), `update`, `delete`, or `convert` (a sample lead to a contact).
- `records`: 1 to 50 of `{ref?, id?, fields?, as_ref?}`. `fields` are the record's fields as the
  API takes them inside `payload` (or `data` for custom objects). The tool builds the body.
- **Links:** give a record a `ref` (`"northwind"`). In a later call, write `"@ref:northwind"` wherever
  that record's id goes, at any depth (`"account_id": "@ref:northwind"`,
  `"product_dict_list": [{"product_id": "@ref:support"}]`).
- One entity type a call. Create parents in an earlier call than their children.
- It tags every new record `sample:<app_key>` (custom objects: a `tags` array field, else a
  `[sample:<app_key>]` prefix on a `notes` or `description` field, else nothing) and lists it in
  `<project_dir>/.ambivo/sample-data.json`. Update, delete and convert act only on records listed there.
- It forces off the flags that would notify people or post to the books (below) and refuses values
  whose side effects cannot be turned off. The refusal says why; change the value and call again.
- Limits: 50 records a call, 200 a project. Emails get a short unique tail (`maria+northwind.k3f9@example.com`)
  so they never match an earlier record.

**`sandbox_cleanup`**: `{project_dir, app_key?, dry_run?}` deletes every record the list holds,
children first (custom records, payments, invoices, bills, orders, tasks, opportunities, leads,
contacts, accounts, products), newest first within a type. Records already gone are dropped from
the list; failures stay on it with the reason. Run `dry_run: true` first and show the user the list.

`.ambivo/` is in the starter's `.gitignore`, and `ambivo-bundle` leaves it out.
<!-- /mcp-only -->

## Without the MCP server

Agents without the plugin's MCP server use the same routes with the developer's own token, in the
same order, with the same fields and flags. The sandbox rule still applies: read
`GET /user/admin/tenant` first and stop unless `tenant_dict.meta.partner_sandbox.partner_key` is set.
Write each new id to `.ambivo/sample-data.json` (`{"records": [{"entity", "id", "ref"}]}`) and
delete from that list, children first. Never write a script that deletes by search or by tag.

## The order, and where each parent id goes

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

### 1. Product

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

### 2. Account (customer or vendor)

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

### 3. Contact

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

### 4. Lead

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

### 5. Opportunity

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

### 6. Task

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

### 7. Order

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

### 8. Invoice

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

### 9. Payment (from a customer)

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

### 10. Bill (from a vendor)

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

### Custom objects

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

## Make it look real

- Plausible, invented names: "Northwind Traders", "Maria Lopez", "Harbor Street Café". Mix company
  sizes and countries. Never a real person or a real customer of the partner.
- Vary what the screens filter and sort by: statuses and stages, sources, owners left as the
  developer, amounts across a range, dates in the past (overdue), today and the future.
- Link them the way real work is: a few contacts per account, an opportunity per account, tasks on
  some of them, one order and invoice for a won-looking deal, a part payment on one invoice.
- Emails `name+tag@example.com`. Phones only when the screen shows them, from 555-0100 to 555-0199.
- Keep the counts small. Five good records show a screen better than fifty.

## Side effects, checked in the API code

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

## Where the spec and the API differ

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
