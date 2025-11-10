# CFlair-Counter Integration Guide

This document explains how to integrate CFlair-Counter into another project or service. It is written to be machine-readable and actionable so an agentic AI can follow the steps to add telemetry, badges, and analytics. It covers endpoints, authentication, deployment, build steps, and an "agent checklist" for automation.

## Overview
CFlair-Counter is a small serverless telemetry and view counter service built for Cloudflare Pages (Advanced Mode) + D1. It provides:

- REST API to record and fetch view counts
- Badge generation endpoint (SVG)
- Admin endpoints for exporting and viewing telemetry

Components:
- `functions/index.ts` — TypeScript Hono app (server source)
- `public/index.html` — Frontend UI
- `public/_worker.js` — Bundled worker (build artifact)
- `wrangler.toml` — Cloudflare configuration
- `package.json` — build/deploy scripts

## 1. Quick API Reference

Base URL: `https://<your-pages-domain>/api`

Endpoints:
- `POST /api/views/:projectName` — Increment view count for `projectName`. Body optional.
  - Response: `{ success: true, project: <name>, totalViews: <n>, unique: <n> }`

- `GET /api/views/:projectName` — Get counts for a project.
  - Response: `{ success: true, project: <name>, totalViews: <n>, uniqueViews: <n> }`

- `GET /api/views/:projectName/badge` — Returns an SVG badge. Query params: `color`.

- `GET /api/stats` — Global statistics across projects:
  - Response: `{ success: true, statistics: { totalViews, uniqueViews, totalProjects, analyticsEnabled } }`

- `POST /api/admin/stats` — Admin access (password via JSON body). Returns admin payload.

- Health: `GET /health`

## 2. Integration Steps (manual)

1. Add the dependency and files
   - Clone or add the `functions/` and `public/` directories to your repo.
   - Keep `functions/index.ts` as the worker source.

2. Configure environment
   - Bind a Cloudflare D1 database and use `DB` as the binding in `wrangler.toml`.
   - Add secrets/environment variables in Pages or Wrangler: `ADMIN_PASSWORD`, `ENABLE_ADMIN`, `ENABLE_ANALYTICS`.

3. Build & deploy
   - Build worker: `npm run build:worker` (bundles `functions/index.ts` → `public/_worker.js`).
   - Deploy: `npm run deploy` (runs build then `wrangler pages deploy public`).

4. Frontend integration
   - Use the badge URL or the POST `api/views/:projectName` from any server, client, or CI to record views.

Example JS snippet (record a view):
```js
fetch('https://your.pages.domain/api/views/my-project', { method: 'POST' });
```

Example badge in Markdown:
```md
![Views](https://your.pages.domain/api/views/my-project/badge?color=blue)
```

## 3. Agentic AI Automation Checklist
This checklist is tuned so an agent can programmatically integrate CFlair-Counter into a repository.

Preconditions:
- Agent has repo write access
- Agent has Cloudflare account credentials or an API token with Pages and D1 permissions

Steps for an agent to automate integration:

1. Ensure repository layout
   - Create `functions/` and `public/` folders if missing.
   - Copy `functions/index.ts` into `functions/`.
   - Copy frontend badge or `public/index.html` as optional.

2. Configure `wrangler.toml` (agent should update or create):
   - Set `name` and `main` if needed.
   - Add D1 binding:
     ```toml
     [[d1_databases]]
     binding = "DB"
     database_id = "<ID from Cloudflare>"
     ```
   - Add `pages_build_output_dir = "public"`

3. Update `package.json` scripts (if missing):
   - Add `build:worker` script:
     ```json
     "build:worker": "esbuild functions/index.ts --bundle --format=esm --outfile=public/_worker.js --platform=neutral --conditions=worker"
     ```
   - Add `deploy` script that runs build and `wrangler pages deploy public`.

4. Run local build & verification
   - Run `npm ci` then `npm run build:worker`.
   - Optionally run `wrangler pages dev public` to verify locally (note: D1 local bindings may behave differently).

5. Deploy to preview
   - Run `npm run deploy` and capture the preview URL from wrangler output.
   - Verify: `GET /` returns HTML, `GET /api/stats` returns JSON, `GET /api/views/:projectName/badge` returns SVG.

6. Add telemetry calls to target project
   - Add a small snippet in the target app to POST to `https://<pages-domain>/api/views/<project>` on relevant events (page load, deploy hook, CI run, etc.).

7. Add README and deployment documentation to the target repo
   - Write a short README snippet describing how to use the badge and the API.

## 4. Security and Rate Limiting Notes
- Admin endpoint is protected by `ADMIN_PASSWORD`. Keep this secret out of source control.
- The worker has an in-memory rate limiter (per instance). For production, consider adding Cloudflare rate-limiting rules or a KV-backed rate limiter.

## 5. CI / GitHub Actions Example
Agent can add a simple GitHub Actions workflow `.github/workflows/deploy.yml`:
```yaml
name: Deploy Pages
on:
  push:
    branches: [ main ]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build:worker
      - run: npx wrangler pages deploy public --project-name=cflaircounter
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## 6. Troubleshooting
- If preview/site returns 404 for static files: ensure the worker routes static files via `env.ASSETS.fetch(request)` for `/`, `/index.html`, and known extensions (css/js/png/svg/ico/woff).
- If API returns 404: confirm the Hono app includes the route and the worker forwards non-static requests to `app.fetch(request, env, ctx)`.
- For local D1 issues: some wrangler local dev commands may not exactly replicate Pages preview; use preview deployments for accurate tests.

---

If you'd like, I can now:
- Add `docs/INTEGRATION.md` (done) and also update `README.md` to reference it,
- Add the GitHub Actions workflow in `.github/workflows/deploy.yml` and wire up `wrangler` usage,
- Add `pages_build_output_dir` to `wrangler.toml`.

Tell me which of these you want next and I'll implement it (and run a dry build/test where applicable).