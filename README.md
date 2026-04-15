# CFlair-Counter

Serverless, low-cost telemetry counter for projects, docs, and deploy workflows. Built for Cloudflare Pages + D1 with a lightweight Hono API and SVG badge support.

[![Newman CI](https://github.com/Life-Experimentalist/CFlair-Counter/actions/workflows/newman.yml/badge.svg)](https://github.com/Life-Experimentalist/CFlair-Counter/actions/workflows/newman.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE.md)

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
fetch("https://your-domain.com/api/views/my-project", { method: "POST" });
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

| Endpoint                        | Method | Auth     | Purpose                      |
| ------------------------------- | ------ | -------- | ---------------------------- |
| `/health`                       | GET    | No       | Health check                 |
| `/api/stats`                    | GET    | No       | Global stats across projects |
| `/api/views/:projectName`       | GET    | No       | Get project stats            |
| `/api/views/:projectName`       | POST   | No       | Increment project views      |
| `/api/views/:projectName/badge` | GET    | No       | SVG badge                    |
| `/api/admin/stats`              | POST   | Password | Admin dashboard stats        |
| `/api/admin/projects`           | GET    | Password | Admin project listing        |
| `/api/views/:projectName`       | DELETE | Password | Delete a project             |

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

## Environment Variables

| Variable              | Required            | Default | Description                    |
| --------------------- | ------------------- | ------- | ------------------------------ |
| `ADMIN_PASSWORD`      | Yes (for admin use) | empty   | Password for admin endpoints   |
| `ENABLE_ADMIN`        | No                  | `true`  | Toggle admin APIs              |
| `ENABLE_ANALYTICS`    | No                  | `false` | Enable unique-visitor tracking |
| `MAX_PROJECTS`        | No                  | `100`   | Soft project cap               |
| `RATE_LIMIT_REQUESTS` | No                  | `60`    | Requests per window            |
| `RATE_LIMIT_WINDOW`   | No                  | `60000` | Rate-limit window in ms        |
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
- `docs/DEPLOYMENT.md` - deployment and environment setup.

## Security Notes

- Never commit real `ADMIN_PASSWORD` values.
- Rotate admin secrets if exposed.
- Restrict admin endpoint access at the edge where possible.

## License

Apache-2.0. See `LICENSE.md`.
