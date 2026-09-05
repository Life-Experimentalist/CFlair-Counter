# ViewFlare Auto-Integration & Deployment Guide

> **🤖 AI Agents & Coding Assistants**: 
> You have been directed to this file to help the user deploy and/or integrate **ViewFlare**. 
> Read the instructions carefully. ViewFlare is designed to be 100% free using Cloudflare Pages and D1 (no credit card required).

## Goal 1: Auto-Deploying a new ViewFlare Instance for the User
If the user wants you to "setup" or "deploy" ViewFlare for them from scratch:

1. **Fork & Clone**: Have the user fork this repository to their GitHub account, or clone it directly if you are running in their workspace.
2. **Cloudflare Setup (Free)**:
   - Ask the user to log in to Cloudflare and authorize `wrangler` by running `npx wrangler login`.
   - Ask them to run `npx wrangler d1 create viewflare-db` (any name works - put
     whichever name they choose into `database_name` in `wrangler.toml`).
   - Take the `database_id` from the output and update `wrangler.toml` in the `[[d1_databases]]` section.
3. **Initialize DB**: Run `npm run db:init` to create the SQL tables.
4. **Deploy**: Run `npm run deploy`. Cloudflare Pages will build the worker and give you a free `*.pages.dev` domain (e.g., `https://viewflare.pages.dev`).
5. **Secure Admin**: In `wrangler.toml` or via Cloudflare Dashboard, set `ADMIN_PASSWORD` so the user can access their dashboard securely.

---

## Goal 2: Integrating ViewFlare into the User's Existing Project
If the user already has a deployed instance of ViewFlare (or is using the public one) and wants you to integrate it into their codebase:

1. **Ask for the Domain**: If the user hasn't provided their ViewFlare domain, ask for it (e.g., `https://counter.vkrishna04.me` or `https://viewflare.pages.dev`).
2. **Determine the Project Name**: Create a URL-safe slug for the page or component being tracked (e.g., `portfolio-home`, `docs-api`).
3. **Log a View (Code Integration)**:
   - Insert a silent background POST request when the tracked page loads.
   - **JavaScript/TypeScript**:
     ```javascript
     fetch('https://[DOMAIN]/api/views/[PROJECT_NAME]', { method: 'POST' }).catch(console.error);
     ```
   - **Python**:
     ```python
     import requests
     try:
         requests.post('https://[DOMAIN]/api/views/[PROJECT_NAME]', timeout=3)
     except Exception:
         pass
     ```
4. **Display a Badge (Markdown / HTML)**:
   - Insert an image pointing to the badge generator endpoint.
   - **Markdown**:
     ```markdown
     ![Views](https://[DOMAIN]/api/views/[PROJECT_NAME]/badge?color=blue&style=flat-square)
     ```
   - *Optional Parameters*: `color` (blue, green, red, purple, etc.), `style` (flat, flat-square, for-the-badge), `label` (custom text).

---

## Goal 3: Reporting real install / download counts

`GET /api/installs/{project}` reports how many times a project has actually been
installed or downloaded, pulled live from the registries it ships on. It is
entirely separate from the view counter: a project with no install sources
configured is unaffected and every existing endpoint behaves exactly as before.

**Every number comes from a live upstream API response.** Nothing is estimated,
and a cached figure is never passed off as a fresh one.

### Supported sources

| `source` | Identifier (`config`) | Upstream | Reports |
|---|---|---|---|
| `vscode` | `publisher.extension` | Marketplace extension-query API, `statistics` -> `install` | all-time installs |
| `openvsx` | `namespace/extension` | `https://open-vsx.org/api/{namespace}/{extension}` -> `downloadCount` | all-time downloads |
| `pypi` | `package` | **pypistats** `/api/packages/{pkg}/recent` -> `data.last_month` | **downloads in the last month** |
| `github` | `owner/repo` | GitHub releases, summed `assets[].download_count` | all-time asset downloads |
| `npm` | `package` | `https://api.npmjs.org/downloads/point/last-month/{pkg}` -> `downloads` | **downloads in the last month** |

**Why pypistats and not the PyPI JSON API:** the PyPI JSON API has reported its
`downloads` fields as `-1` ("not available") for years. pypistats is the only
source of a real figure, and it publishes rolling windows only - so PyPI and npm
report **the last month**, not a lifetime total. When a windowed source is
combined with an all-time one the response sets `mixedWindows: true`.

### Configuring a project (admin)

```bash
curl -X PUT https://counter.vkrishna04.me/api/admin/installs/MyProject   -H "Content-Type: application/json"   -d '{
        "password": "YOUR_ADMIN_PASSWORD",
        "sources": {
          "vscode":  "publisher.my-extension",
          "openvsx": "publisher/my-extension",
          "github":  "owner/my-project",
          "npm":     "my-package",
          "pypi":    "my-package"
        }
      }'
```

Send `null` (or `""`) for a source to remove it. The password may also be sent as
`X-Admin-Password` or `Authorization: Bearer ...`. Changing a source identifier
drops that source's cached count, since it would otherwise be a count of a
different package.

### Reading the aggregate

```bash
curl https://counter.vkrishna04.me/api/installs/MyProject
```

Real response, captured from this worker running locally against live registries
on 2026-09-05. Note the deliberate partial failure - **this returns HTTP 200, not
a 500**:

```json
{
  "success": true,
  "project": "RanobeGemini",
  "total": 651744386,
  "totalLabel": "installs (all registries)",
  "mixedWindows": true,
  "coverage": "4 of 5 sources",
  "sourcesConfigured": 5,
  "sourcesAnswered": 4,
  "complete": false,
  "sources": [
    { "source": "github",  "label": "GitHub releases",     "id": "cli/cli",
      "measures": "release asset downloads", "window": "all-time",
      "count": 122656575, "fetchedAt": "2026-09-05T22:22:04.008Z",
      "stale": false, "ok": true },
    { "source": "npm",     "label": "npm",                 "id": "hono",
      "measures": "downloads", "window": "last_month",
      "count": 236395449, "fetchedAt": "2026-09-05T22:19:15.000Z",
      "stale": false, "ok": true },
    { "source": "openvsx", "label": "Open VSX",            "id": "ms-python/python",
      "measures": "downloads", "window": "all-time",
      "count": 57323807, "fetchedAt": "2026-09-05T22:19:16.000Z",
      "stale": false, "ok": true },
    { "source": "pypi",    "label": "PyPI",                "id": "requests",
      "measures": "downloads", "window": "last_month",
      "count": null, "fetchedAt": null,
      "stale": false, "ok": false, "error": "pypistats HTTP 429" },
    { "source": "vscode",  "label": "VS Code Marketplace", "id": "ms-python.python",
      "measures": "installs", "window": "all-time",
      "count": 235368555, "fetchedAt": "2026-09-05T22:19:16.000Z",
      "stale": false, "ok": true }
  ],
  "timestamp": "2026-09-05T22:22:04.020Z"
}
```

### How to read the response

- **`total`** is the sum of the sources that answered - the four with
  `ok: true`, not all five. `coverage` says so explicitly. `total` is `null`
  (never `0`) when nothing answered and nothing was cached.
- **`totalLabel`** is `"installs (all registries)"` whenever more than one source
  contributed, so a single headline number is never presented as if it came from
  one place.
- **`mixedWindows: true`** means an all-time count is being added to a rolling
  last-month figure. The total is still returned, but it is not one comparable
  number.
- **`ok: false`** - that source failed and nothing was cached. Its `count` is
  `null` and it is excluded from `total`.
- **`stale: true`** - the upstream failed, so the last successfully cached count
  is being served instead. `fetchedAt` is the time that number was *really*
  fetched, and `error` says why the refresh failed. A stale number is never
  silently substituted for a live one.

### Caching

Each source is cached independently for 6 hours by default, so one dead or
rate-limited upstream cannot take the whole response down. Override with the
`INSTALL_CACHE_TTL` environment variable (seconds, minimum 60). Failures are not
cached - a failed source is retried on the next request.

Caching is not optional politeness here: unauthenticated GitHub allows 60
requests/hour per egress IP and Workers share IPs, and pypistats rate-limits
aggressively (the `429` in the example above is real, not contrived).

**Agent Checklist:**
- Keep your integration minimal.
- Never let tracking failures crash the user's application (always catch errors).
- Notify the user once the integration is complete and verify the badge appears properly.
- Never present an install count as live if its source came back `stale: true`,
  and never quote `total` without `coverage` when `complete` is `false`.
