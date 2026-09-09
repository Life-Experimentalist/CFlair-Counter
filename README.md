<!-- TODO(brand): the header is text-only until the brand art exists. Once
     docs/public/logo.png and docs/public/banner.png are in place, put the
     banner here:
       <p align="center"><img src="docs/public/banner.png" alt="ViewFlare" width="640"></p>
     The prompts that produce them are in docs/BRAND-PROMPTS.md. Do not commit
     the <img> before the files exist - it renders as a broken image on GitHub. -->

# ViewFlare

Serverless, low-cost telemetry counter for projects, docs, and deploy workflows. Built for Cloudflare Pages + D1 with a lightweight Hono API and SVG badge support.

[![Newman CI](https://github.com/Life-Experimentalist/ViewFlare/actions/workflows/newman.yml/badge.svg)](https://github.com/Life-Experimentalist/ViewFlare/actions/workflows/newman.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
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

## Quick Start

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure `wrangler.toml`

Make sure `[[d1_databases]]` has valid IDs:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cflaircounter-db"
database_id = "<your-d1-database-id>"
preview_database_id = "<your-preview-d1-database-id>"
```

### 3. Run locally

```bash
npm run dev
```

### 4. Deploy

```bash
npm run deploy
```

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
| `/api/views/:project` | GET | No | Get one project's stats |
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

`INTEGRATION.md` Goal 7 has the full contract.

## Environment Variables

| Variable              | Required            | Default | Description                    |
| --------------------- | ------------------- | ------- | ------------------------------ |
| `ADMIN_PASSWORD`      | Yes (for admin use) | empty   | Password for admin endpoints   |
| `ENABLE_ADMIN`        | No                  | `true`  | Toggle admin APIs              |
| `ENABLE_ANALYTICS`    | No                  | `false` | Enable unique-visitor tracking |
| `MAX_PROJECTS`        | No                  | `100`   | Soft project cap               |
| `RATE_LIMIT_REQUESTS` | No                  | `60`    | Requests per window            |
| `RATE_LIMIT_WINDOW`   | No                  | `60000` | Rate-limit window in ms        |
| `TRACK_USAGE`         | No                  | `false` | Write a daily row to `usage_stats`. Off because it costs one extra D1 write per view and duplicates the Cloudflare dashboard |
| `DEBUG`               | No                  | `false` | Verbose debug logging          |

## Development Commands

```bash
npm run dev
npm run build
npm run type-check
npm run test:newman
npm run test:newman:ci
```

## Documentation Map

- `INTEGRATION.md` - integration checklist and automation flow.
- `docs/AI-AGENT-QUICKSTART.md` - give this to coding agents.
- `docs/DEVELOPMENT-GUIDE.md` - development details.
- `docs/CLOUDFLARE-SETUP.md` - deployment, bindings, custom domain, and the
  CFlair-Counter -> ViewFlare Pages migration steps.
- `docs/api/README.md` - the OpenAPI spec, and how to generate a client from it.
- `public/openapi.yaml` - OpenAPI 3.1 for every endpoint, served at
  `https://your-domain.com/openapi.yaml`.
- `docs/postman-guide.md` - Postman/Newman collection usage.
- `docs/BRAND-PROMPTS.md` - image-generation prompts for the logo and banner.
- `skills/viewflare-integration/SKILL.md` - Claude Code skill. Copy the
  `skills/viewflare-integration` directory into `~/.claude/skills/` to have an
  agent wire ViewFlare into a project for you.
- `public/llms.txt` - served at `https://your-domain.com/llms.txt`, the short
  version of this API for an agent that lands on the deployed instance.

## Security Notes

- Never commit real `ADMIN_PASSWORD` values.
- Rotate admin secrets if exposed.
- Restrict admin endpoint access at the edge where possible.

## License

Apache-2.0. See `LICENSE.md`.
