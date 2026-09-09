# AI Agent Quickstart (Comprehensive)

This file is the single handoff document for any coding/automation agent that needs to use or integrate ViewFlare.

## Objective

Integrate and validate ViewFlare as a telemetry microservice that can:
- Increment views via HTTP.
- Serve project and global metrics.
- Generate SVG badges.
- Support protected admin operations.

## System Summary

- Runtime: Cloudflare Pages (Advanced Mode) + Worker.
- API framework: Hono.
- Persistence: Cloudflare D1 (`DB` binding).
- Source entry: `functions/index.ts`.
- Bundled worker output: `public/_worker.js`.

## Required Configuration

### Files

- `wrangler.toml`
- `package.json`
- `schema.sql`
- `functions/index.ts`

### Environment Variables

- `ADMIN_PASSWORD` (required for admin routes)
- `ENABLE_ADMIN` (`true`/`false`, default enabled)
- `ENABLE_ANALYTICS` (`true`/`false`, default disabled)
- `RATE_LIMIT_REQUESTS` (default `60`)
- `RATE_LIMIT_WINDOW` (default `60000` ms)
- `DEBUG` (`true`/`false`)

### D1 Binding

`wrangler.toml` must include:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cflaircounter-db"
database_id = "<real-database-id>"
preview_database_id = "<real-preview-database-id>"
```

## API Contract

Base URL:

```text
https://<your-domain>
```

### Health

- Method: `GET`
- Path: `/health`
- Auth: none
- Expected: `200`

Response shape:

```json
{
  "success": true,
  "status": "ok",
  "timestamp": "...",
  "worker": "viewflare-api",
  "version": "2.0.0"
}
```

### Global Stats

- Method: `GET`
- Path: `/api/stats`
- Auth: none
- Expected: `200`

Response shape:

```json
{
  "success": true,
  "statistics": {
    "totalViews": 0,
    "uniqueViews": 0,
    "totalProjects": 0,
    "analyticsEnabled": false
  },
  "timestamp": "..."
}
```

### Increment Project Views

- Method: `POST`
- Path: `/api/views/:projectName`
- Auth: none
- Body: optional JSON
- Expected: `200`

Example:

```bash
curl -X POST "https://<your-domain>/api/views/my-project"
```

### Get Project Stats

- Method: `GET`
- Path: `/api/views/:projectName`
- Auth: none
- Expected: `200`

### SVG Badge

- Method: `GET`
- Path: `/api/views/:projectName/badge`
- Auth: none
- Expected: `200`, `Content-Type: image/svg+xml`

Query parameters:
- `style`: `flat`, `flat-square`, `for-the-badge`
- `color`: named color or hex (`#RRGGBB` / `#RGB`)
- `label`: text, max 24 chars

Examples:

```text
/api/views/my-project/badge
/api/views/my-project/badge?style=flat-square&color=brightgreen
/api/views/my-project/badge?style=for-the-badge&color=%2300bcd4&label=downloads
```

### Admin Stats

- Method: `POST`
- Path: `/api/admin/stats`
- Auth: password in JSON body
- Expected: `200` with correct password, `401` otherwise

Body:

```json
{ "password": "<admin-password>" }
```

### Admin List Projects

- Method: `GET`
- Path: `/api/admin/projects`
- Auth: required
- Expected: `200` with correct password, `401` otherwise

Accepted auth methods:
- `X-Admin-Password: <password>`
- `Authorization: Bearer <password>`
- `?password=<password>` query string

### Delete Project

- Method: `DELETE`
- Path: `/api/views/:projectName`
- Auth: required
- Expected: `200` success, `401` unauthorized, `404` if missing

## CI and Validation

### Local validation sequence

Run in order:

```bash
npm ci
npm run type-check
npm run build
npm run test:newman:ci -- --env-var "base_url=https://<your-domain>" --env-var "admin_password=<optional>"
```

### GitHub Actions workflow

Workflow file: `.github/workflows/newman.yml`

Behavior:
- Uses `npm ci` for lockfile-safe install.
- Runs Newman collection with runtime env vars.
- Defaults `BASE_URL` to `https://viewflare.pages.dev` when secret is missing.

Required repository secrets:
- `BASE_URL` (optional but recommended)
- `ADMIN_PASSWORD` (optional; if absent, admin-positive tests will expect 401)

## Integration Recipes

### JavaScript (browser or Node)

```javascript
fetch("https://<your-domain>/api/views/my-project", {
  method: "POST",
  keepalive: true,
}).catch(() => {});
```

### Python

```python
import requests
try:
    requests.post("https://<your-domain>/api/views/my-project", timeout=5)
except Exception:
    pass
```

Tracking is fire-and-forget: swallow the error so a failed call cannot break
the page or the job it is measuring. `INTEGRATION.md` Goal 2 carries the same
snippet for shell, Go and Rust, and Goal 6 covers `POST /api/events` for
anything that is not a page view.

### README badge

```md
![Views](https://<your-domain>/api/views/my-project/badge?style=flat&color=blue)
```

### One number out of several

`GET /api/compute/:project?expr=...` evaluates arithmetic over the numbers
already collected and answers with a single value. `/badge` and
`/shields.json` take the same `expr`.

```bash
curl "https://<your-domain>/api/compute/my-project?expr=views.total%2Binstalls.total"
```

```md
![Reach](https://<your-domain>/api/compute/my-project/badge?expr=views.total%2Binstalls.total&label=reach)
```

Variables are `views.total`, `views.unique`, `installs.total`,
`installs.<source>`, `events.<category>` and `events.<category>.<name>`.
Operators are `+ - * / %` with parentheses, plus `min`, `max`, `abs`, `round`,
`floor`, `ceil` and `pct(part, whole)`.

A `+` in a URL query string decodes to a space, so write it as `%2B`. If any
input is unavailable the whole metric reports unavailable rather than
substituting a zero, so read `unavailable` and `reason` before using the value.
`INTEGRATION.md` Goal 7 has the full contract.

## Failure Diagnostics

If CI fails, check in this order:
1. `package-lock.json` is committed and in sync with `package.json`.
2. `npm ci` succeeds locally.
3. `BASE_URL` points to a reachable deployment.
4. Admin password/endpoint expectations match configured secrets.
5. D1 binding IDs are set in `wrangler.toml`.

## Agent Completion Checklist

Mark complete only when all are true:
- [ ] `npm ci` succeeds.
- [ ] Type-check and build succeed.
- [ ] Newman CI run succeeds.
- [ ] Badge endpoint returns valid SVG.
- [ ] Admin endpoints enforce auth correctly.
- [ ] README and docs links are up to date.
- [ ] `https://<your-domain>/llms.txt` is reachable and matches the routes
      the instance actually serves.
- [ ] `https://<your-domain>/openapi.yaml` is reachable and lists every route
      the Worker actually serves.
