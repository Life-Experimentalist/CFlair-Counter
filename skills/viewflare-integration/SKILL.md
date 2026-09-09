---
name: viewflare_integration
description: Helps the user deploy ViewFlare via Cloudflare Pages, integrate view and event tracking into their codebase, and derive a single computed number from what it collects.
---

# ViewFlare AI Integration & Setup Skill

When the user asks to integrate, deploy, or setup ViewFlare, follow these instructions to automate the process for them. ViewFlare is a 100% free serverless view counter built for Cloudflare Pages and D1.

## Phase 1: Deploying ViewFlare (If the user needs their own instance)
If the user wants you to set up ViewFlare for them from scratch without requiring a credit card:

1. **Fork/Clone**: Instruct the user to fork the ViewFlare repository or clone it locally.
2. **Cloudflare Auth**: Run `npx wrangler login` in the terminal to authenticate the user's free Cloudflare account.
3. **Database Setup**: 
   - Run `npx wrangler d1 create viewflare-db`.
   - Wait for the output to provide a `database_id`.
   - Update `wrangler.toml` by replacing the empty `database_id` under `[[d1_databases]]` with the new ID.
4. **Schema Initialization**: Run `npm run db:init` to build the required tables in D1.
5. **Deployment**: Run `npm run deploy`. 
   - Note the resulting `*.pages.dev` URL provided in the terminal output. This is the user's new API domain.
6. **Secure Admin**: Ensure the user sets an `ADMIN_PASSWORD` securely via the Cloudflare dashboard or Wrangler secrets.

## Phase 2: Integrating ViewFlare into a Codebase
If the user already has an instance or wants to use an existing domain to track views:

1. **Identify the Domain**: Obtain the ViewFlare API domain (e.g., `https://viewflare.pages.dev`).
2. **Determine the Project Identifier**: Create a unique URL-safe slug for the specific page/component being tracked (e.g., `readme-views`, `app-homepage`).
3. **Insert Tracking Logic (Silent POST Request)**:
   - Example (browser JavaScript):
     ```javascript
     fetch('https://[DOMAIN]/api/views/[PROJECT_ID]', { method: 'POST', keepalive: true }).catch(() => {});
     ```
   - Swallow the error so a tracking failure cannot break the main application,
     and set a short timeout away from the browser (`AbortSignal.timeout(3000)`
     in Node, `-m 3` for curl, `timeout=3` for requests).
   - `INTEGRATION.md` Goal 2 carries the same snippet for Node, Python, shell,
     Go and Rust.
   - To record something other than a page view, such as a signup, a download
     or a CLI run, `POST /api/events` with `{"category": "...", "event": "..."}`
     and an optional `metadata` object. `GET /api/metrics` reads the counts
     back. `INTEGRATION.md` Goal 6 has the full contract.
4. **Insert the Badge (Markdown/HTML)**:
   - Example (Markdown):
     ```markdown
     ![Views](https://[DOMAIN]/api/views/[PROJECT_ID]/badge?color=violet&style=flat-square)
     ```
   - Available styles: `flat`, `flat-square`, `for-the-badge`.
5. **Condense Several Numbers Into One (Optional)**:
   - `GET /api/compute/[PROJECT_ID]?expr=...` evaluates arithmetic over the
     numbers ViewFlare already holds and answers with a single value, plus
     `/badge` and `/shields.json` siblings that take the same `expr`.
   - Variables are `views.total`, `views.unique`, `installs.total`,
     `installs.<source>`, `events.<category>` and `events.<category>.<name>`.
     Operators are `+ - * / %` with parentheses, and the functions are `min`,
     `max`, `abs`, `round`, `floor`, `ceil` and `pct(part, whole)`.
   - A `+` in a URL decodes to a space, so always write it as `%2B`:
     ```markdown
     ![Reach](https://[DOMAIN]/api/compute/[PROJECT_ID]/badge?expr=views.total%2Binstalls.total&label=reach)
     ```
   - If any input is unavailable the whole metric reports unavailable rather
     than substituting a zero, so check `unavailable` and `reason` before using
     the value. `INTEGRATION.md` Goal 7 has the full contract.

A deployed instance serves `https://[DOMAIN]/llms.txt`, a short plain-text
summary of every endpoint above, and `https://[DOMAIN]/openapi.yaml`, the same
API as OpenAPI 3.1 with request and response shapes. Read one of those when
working against an instance whose repository you do not have.

Always prioritize minimal, non-blocking code when integrating tracking into the user's applications. Validate your changes when done.
