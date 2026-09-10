<!-- TODO(brand): the header is text-only until the brand art exists. Once
     docs/public/logo.png and docs/public/banner.png are in place, put the
     banner here:
       <p align="center"><img src="docs/public/banner.png" alt="ViewFlare" width="640"></p>
     The prompts that produce them are in docs/BRAND-PROMPTS.md. Do not commit
     the <img> before the files exist - it renders as a broken image on GitHub. -->

# ViewFlare

Serverless, low-cost telemetry counter for projects, docs, and deploy workflows. Runs as a Cloudflare Worker on D1, with a Hono API and SVG badges. Free tier, no credit card.

[![Newman CI](https://github.com/Life-Experimentalist/ViewFlare/actions/workflows/newman.yml/badge.svg)](https://github.com/Life-Experimentalist/ViewFlare/actions/workflows/newman.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE.md)

> **Previously called CFlair-Counter.** Same project, same API, same public URL
> (`https://counter.vkrishna04.me`) - only the name changed. Existing badges and
> integrations keep working unchanged.

## Why This Exists (STAR)

### Situation
Teams need a dead-simple way to track project usage and show view badges across multiple repos without maintaining a custom backend.

### Task
Provide a fast, low-cost telemetry API that can be integrated in minutes and run reliably on a serverless platform.

### Action
This project implements:
- A Cloudflare Worker API for view tracking and stats.
- D1-backed persistence with optional unique-visitor analytics.
- SVG badge generation with style and color customization.
- Admin endpoints for protected project-level operations.
- CI health checks via Postman/Newman.

### Result
You get a production-ready counter service that is:
- Easy to integrate: one `POST` request to increment views.
- Easy to show: one image URL for a live SVG badge.
- Cost-efficient: minimal infra overhead on Cloudflare.
- Automated: CI verifies endpoint behavior continuously.

## Run Your Own

```bash
git clone https://github.com/Life-Experimentalist/ViewFlare.git
cd ViewFlare
npm install && npm run setup
```

`npm run setup` checks your Cloudflare login, creates a D1 database, writes its
id into `wrangler.toml`, applies the schema, prompts for an admin password
through `wrangler secret put` (it never sees the value itself), deploys, and
prints your URL. Every step is idempotent, so re-run it if it stops partway.

The only prerequisite is a free Cloudflare account. If wrangler is not logged in
yet the script says so and stops; `npx wrangler login` fixes it.

A custom domain is optional and is the one step the script does not do: the
`*.workers.dev` URL works immediately. To use your own, go to Workers & Pages,
the `viewflare` Worker, Settings, Domains & Routes.

Then day to day:

```bash
npm run dev      # local instance on http://127.0.0.1:8788
npm run deploy   # build, type-check and ship
```

`docs/CLOUDFLARE-SETUP.md` has the manual version of every step, and the
migration path if you deployed an older version on Cloudflare Pages.

### Warning about bot protection

If you put ViewFlare on a domain with Cloudflare's Bot Fight Mode on, requests
from datacenter IPs can be challenged, and a challenge page arrives at a caller
as HTML where it expected JSON. It is scored on IP reputation and request
signature, so it is intermittent rather than a flat block. That affects CI runners and server-side callers,
not browsers. The `*.workers.dev` hostname is not on your zone, so it is not
subject to it. Bot Fight Mode is zone-level and outside the Ruleset Engine, so a
WAF skip rule cannot exempt a path from it.

## Integration (Fast Path)

### Increment views

```javascript
fetch("https://your-domain.com/api/views/my-project", {
  method: "POST",
  keepalive: true,
}).catch(() => {});
```

### Add a badge

```md
![Views](https://your-domain.com/api/views/my-project/badge?style=flat&color=brightgreen)
```

### CI ping example

```yaml
- name: Increment docs counter
  run: |
    curl -fsS -X POST "https://your-domain.com/api/views/docs-build"
```

## API Endpoints

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/health` | GET | No | Health check |
| `/api/stats` | GET | No | Global stats across projects |
| `/api/views?names=a,b,c` | GET | No | Batch read, up to 50 projects, never increments |
| `/api/views/:project` | GET | No | Get one project's stats, `?rollup=1` to include everything under it |
| `/api/views/:project` | POST | No | Increment project views |
| `/api/views/:project/badge` | GET | No | SVG views badge |
| `/api/views/:project/history` | GET | No | Daily series, `?series=snapshots` for the recorded one |
| `/api/installs/:project` | GET | No | Aggregated install counts across registries |
| `/api/installs/:project/badge` | GET | No | SVG installs badge |
| `/api/installs/:project/shields.json` | GET | No | shields.io endpoint badge |
| `/api/installs/:project/history` | GET | No | Daily install series with change and per-day rate |
| `/api/events` | POST | No | Record a named event |
| `/api/metrics` | GET | No | All-time event rollup, top 100 pairs |
| `/api/compute/:project?expr=` | GET | No | One number from an expression over views, installs and events |
| `/api/compute/:project/badge?expr=` | GET | No | SVG badge of that number |
| `/api/compute/:project/shields.json?expr=` | GET | No | shields.io endpoint badge of that number |
| `/api/admin/stats` | POST | Password | Admin dashboard stats |
| `/api/admin/projects` | GET | Password | Admin project listing |
| `/api/admin/projects/:project` | PUT | Password | Rename or edit a project |
| `/api/views/:project` | DELETE | Password | Delete a project |
| `/api/admin/installs/:project` | PUT | Password | Configure install sources |
| `/api/admin/installs/snapshot` | POST | Password | Record today's snapshot |

`INTEGRATION.md` has the request and response shapes for the installs, history,
snapshot and compute endpoints.

Admin auth can be sent via:
- `X-Admin-Password` header
- `Authorization: Bearer <password>` header
- JSON body `{ "password": "..." }` (for supported POST endpoints)

## SVG Badge Options

`GET /api/views/:projectName/badge`

Query params:
- `style`: `flat` | `flat-square` | `for-the-badge`
- `color`: named color (`blue`, `brightgreen`, `orange`, etc.) or hex (`#00bcd4`)
- `label`: custom left label (max 24 chars)

Examples:

```text
/api/views/my-project/badge
/api/views/my-project/badge?style=flat-square&color=brightgreen
/api/views/my-project/badge?style=for-the-badge&color=%2300bcd4&label=downloads
```

## Computed Metrics

`GET /api/compute/:project?expr=...` evaluates a small arithmetic expression
over the numbers already collected and answers with a single value.

```bash
curl "https://your-domain.com/api/compute/my-project?expr=views.total%2Binstalls.total"
```

```text
/api/compute/my-project/badge?expr=round(pct(views.unique%2Cviews.total),1)&label=unique%20share
/api/compute/my-project/shields.json?expr=views.total%2Finstalls.total
```

- Variables: `views.total`, `views.unique`, `installs.total`,
  `installs.<source>`, `events.<category>`, `events.<category>.<name>`.
- Operators `+ - * / %`, parentheses, and `min`, `max`, `abs`, `round`,
  `floor`, `ceil`, `pct`.
- A `+` in a URL decodes to a space, so write it as `%2B`.
- If any input is unavailable the whole metric reports unavailable. It never
  substitutes a zero.
- `&rollup=1` makes every `views.*` variable sum the whole dotted subtree.

## Hierarchical Project Names

A dot makes a project name a path. `acme.api.docs` sits under `acme.api`, which
sits under `acme`. Nothing about storage changes, the name is still one string
in one column, so every existing name keeps working untouched.

```bash
curl -X POST "https://your-domain.com/api/views/acme.api.docs"
curl "https://your-domain.com/api/views/acme?rollup=1"
```

```md
![All of acme](https://your-domain.com/api/views/acme/badge?rollup=1&label=acme)
```

A rollup answer carries `members`, the per-project breakdown, alongside the sum.
Matching is on whole dotted segments, so `acme_other` is never counted under
`acme`. Rollup is off by default on every route that offers it.

`INTEGRATION.md` Goal 7 has the full contract.

## Install It Into Your Agent

ViewFlare is built so a coding agent can wire it up without being told the API.
Every deployment serves `/llms.txt` (the short version) and `/openapi.yaml` (all
of it), so the file you install into your own project is a short pointer rather
than a copy of the docs that goes stale.

Claude Code gets a plugin carrying two skills: `viewflare-setup`, which deploys
and upgrades your own instance, and `viewflare-integration`, the smaller one
that wires tracking into a project you already have.

```
/plugin marketplace add Life-Experimentalist/ViewFlare
/plugin install viewflare-integration@viewflare
```

Every other harness gets a copy-in rules file from `integrations/agents/`:

| Harness                              | Destination in your repo                         |
| ------------------------------------ | ------------------------------------------------ |
| Codex, Cursor, Windsurf, Antigravity | `AGENTS.md`                                      |
| GitHub Copilot                       | `.github/instructions/viewflare.instructions.md` |
| Amazon Kiro                          | `.kiro/steering/viewflare.md`                    |
| Anything else with a fetch tool      | no file, point it at `/llms.txt`                 |

`AGENTS.md` usually already exists, so append instead of overwriting:

```bash
curl -sL https://raw.githubusercontent.com/Life-Experimentalist/ViewFlare/main/integrations/agents/AGENTS.md >> AGENTS.md
```

`integrations/agents/README.md` has the commands for the other two and explains
the frontmatter each one needs.

## Environment Variables

| Variable              | Required            | Default | Description                    |
| --------------------- | ------------------- | ------- | ------------------------------ |
| `ADMIN_PASSWORD`      | Yes (for admin use) | empty   | Set with `npx wrangler secret put ADMIN_PASSWORD`. It is a secret, never a `[vars]` entry |
| `ENABLE_ADMIN`        | No                  | `true`  | Toggle admin APIs              |
| `ENABLE_ANALYTICS`    | No                  | `false` | Enable unique-visitor tracking |
| `MAX_PROJECTS`        | No                  | `100`   | Soft project cap               |
| `RATE_LIMIT_REQUESTS` | No                  | `60`    | Requests per window            |
| `RATE_LIMIT_WINDOW`   | No                  | `60000` | Rate-limit window in ms        |
| `TRACK_USAGE`         | No                  | `false` | Write a daily row to `usage_stats`. Off because it costs one extra D1 write per view and duplicates the Cloudflare dashboard |
| `TRACK_BREAKDOWN`     | No                  | `false` | Record country and referring host per day in `view_breakdown`, read back with `history?series=breakdown`. Off because it is a second D1 write per view |
| `DEBUG`               | No                  | `false` | Verbose debug logging          |

## Development Commands

```bash
npm run setup      # one-time: create the database and deploy
npm run dev        # local worker on 127.0.0.1:8788
npm run build      # bundle plus type-check
npm run deploy     # build and ship
npm run type-check
npm run test:newman
```

`npm run test:newman` runs against `base_url` from the Postman environment,
which is a deployed instance. To point it at a local one, pass
`--env-var "base_url=http://127.0.0.1:8788"`. CI does exactly that.

## Documentation Map

- `INTEGRATION.md` - integration checklist and automation flow.
- `docs/AI-AGENT-QUICKSTART.md` - give this to coding agents.
- `docs/DEVELOPMENT-GUIDE.md` - development details.
- `docs/CLOUDFLARE-SETUP.md` - deployment, bindings, custom domain, and moving
  an older Pages deployment to Workers.
- `docs/api/README.md` - the OpenAPI spec, and how to generate a client from it.
- `public/openapi.yaml` - OpenAPI 3.1 for every endpoint, served at
  `https://your-domain.com/openapi.yaml`.
- `docs/postman-guide.md` - Postman/Newman collection usage.
- `docs/BRAND-PROMPTS.md` - image-generation prompts for the logo and banner.
- `skills/viewflare-setup/SKILL.md` and `skills/viewflare-integration/SKILL.md`
  - the two Claude Code skills, shipped together as the `viewflare-integration`
  plugin in the `viewflare` marketplace. Install with the two commands under
  [Install It Into Your Agent](#install-it-into-your-agent), or copy the directories into
  `~/.claude/skills/`.
- `integrations/agents/README.md` - the same guidance as a copy-in rules file
  for Codex, Cursor, Windsurf, Antigravity, Copilot and Kiro.
- `public/llms.txt` - served at `https://your-domain.com/llms.txt`, the short
  version of this API for an agent that lands on the deployed instance.

## Security Notes

- `ADMIN_PASSWORD` is a Workers secret, not a variable. It never belongs in
  `wrangler.toml`, and a secret cannot be read back once set, only replaced.
- Rotate admin secrets if exposed.
- Restrict admin endpoint access at the edge where possible.

## License

Apache-2.0. See `LICENSE.md`.
