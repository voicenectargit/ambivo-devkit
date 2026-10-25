---
name: ambivo-website
description: Build a business website for a client on Ambivo (App Factory CMS) and hand it over: create the site, write and save its pages, preview, publish, hand it to the client's company, and connect the client's own domain. Use when the user asks for a website, a landing site, a company site, pages for a client, or to change, publish, hand over or put a domain on an Ambivo website. Not for Angular apps (ambivo-angular-app).
---

# Websites on Ambivo

A website is a CMS site hosted by Ambivo as static pages on a CDN. Its home is App Factory
(https://apps.ambivo.com): that is where most people build, import and edit websites. This skill is the
path for a developer working in Claude Code: you build the same kind of site with the `website_*`
tools, through App Factory's own API, and the client edits it later in Ambivo's site editor. You write the words and pages yourself, with
the user's own AI key. Never use App Factory's AI design wizard: it spends Ambivo's keys.

## Who pays, and when

- Build in the partner's **sandbox**. Nothing is charged there.
- When the site is **handed over** to the client's company (`website_handover`), Ambivo charges the
  client **$10 once** for the setup and then **$10 a month** for hosting. Say so to the user before
  the handover.
- A company building a site for itself is charged the same at creation.

## Public only on the client's own domain

Until the client connects their own domain the site lives at `<name>.apps.ambivo.com`: a preview,
kept out of search (every page noindex, robots.txt disallows all). It goes public, and into search,
only on the client's domain (`website_domain`). That step needs a company admin of the company that
owns the site, so it usually happens after the handover, by the client.

## Steps

1. Ask what the site is for, who it is for, the pages, the tone, and the contact details. Give your
   recommendation with each question, as `/ambivo-new-app` does.
2. `website_create` (template `web_blank`: home, about, services, contact). Note the `project_id`.
3. `website_settings` with `site_name`, and `logo_url` / `favicon_url` if the user has them. Each
   key you send replaces that whole key (`seo`, `nav`...): read the settings first and send it whole.
4. Read `reference.md` before saving a page. It sits beside this file (`skills/ambivo-website/` in
   the ambivo-devkit plugin) and lists every block type with its exact field names, the page and
   settings fields, navigation, forms, images and limits. Block data is not checked on save: a wrong
   field name is stored and shows nothing.
   For each page, `website_page_get`, change it, then `website_page_save` the whole page back
   (`slug`, `title`, `nav_label`, `show_in_nav`, `status`, `blocks`, `seo`). A field left out is
   reset: no `status` makes the page a draft, no `slug` aims it at the home page. Set `seo.title` and
   `seo.description` on every page. The home page has slug `""`.
   A save that reads back differently is an error: save again, never assume it worked.
5. `website_preview_link` for each page; give the links to the user and ask for changes.
6. `website_publish` only when the user says so. It saves a restore point.
7. Handover: ask the user for the client's company id and the client person's email (they need an
   Ambivo account in that company). Confirm the $10 + $10/month, then `website_handover` with
   `confirm: true`. The client gets an invite to the site editor.
8. Domain: the client (a company admin there) runs `website_domain` `connect` with e.g.
   `www.theirbusiness.com`, adds the one CNAME record it returns, and checks `status` until it says
   the site is live. A bare domain (theirbusiness.com) is served as www; they forward the bare domain
   to www at their registrar.

## Rules

- Write content that is true for the client. Never invent prices, awards, reviews or addresses.
- Keep personal data off public pages unless the client asked for it.
- Never put another company's name, logo or trademarks on a client's site as if it were theirs.
- Anything illegal, deceptive or that imitates another business is refused; Ambivo takes such sites
  down.
