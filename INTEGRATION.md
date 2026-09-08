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
| `crates` | `crate` | `https://crates.io/api/v1/crates/{crate}` -> `crate.downloads` | all-time downloads |

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
          "pypi":    "my-package",
          "crates":  "my-crate"
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
  "totalLabel": "installs (4 of 5 registries, mixed windows)",
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
- **`totalLabel`** is the one-line honest description of what `total` covers, and
  it is the same string the badge and `shields.json` use. It reads
  `"installs (all registries)"` only when every configured source answered,
  `"installs (N of M registries)"` when some did not, and appends
  `", mixed windows"` when an all-time count and a rolling window were added
  together. A single headline number is never presented as if it came from one
  place.
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

## Goal 4: Install badges

Two badge-shaped views of the same aggregate. Both call the same resolver as
`GET /api/installs/{project}`, so the SVG, the shields.io JSON and the raw
endpoint can never disagree about the number or about what it covers.

### `GET /api/installs/{project}/badge`

An SVG badge served directly by ViewFlare - no shields.io round-trip.

```markdown
![installs](https://counter.vkrishna04.me/api/installs/MyProject/badge)
```

Query options, identical to the existing view badge:

| Parameter | Values | Default |
|---|---|---|
| `style` | `flat`, `flat-square`, `for-the-badge` | `flat` |
| `color` | a shields colour name (`blue`, `brightgreen`, `orange`, `red`, `lightgrey`, ...) or a hex value written `%23ff0000` | `blue`, or `lightgrey` when there is no number to show |
| `label` | your own left-hand text, truncated to 40 characters | the coverage label below |

```markdown
![installs](https://counter.vkrishna04.me/api/installs/MyProject/badge?style=for-the-badge&color=orange)
```

### `GET /api/installs/{project}/shields.json`

The same figure in
[shields.io endpoint format](https://shields.io/badges/endpoint-badge), for
anyone who would rather keep rendering their badges at shields.io. The `url`
parameter must be URL-encoded:

```markdown
![installs](https://img.shields.io/endpoint?url=https%3A%2F%2Fcounter.vkrishna04.me%2Fapi%2Finstalls%2FMyProject%2Fshields.json)
```

Real response, captured from this worker running locally on 2026-09-05:

```json
{
  "schemaVersion": 1,
  "label": "installs (2 of 3 registries, mixed windows)",
  "message": "359.1M",
  "color": "blue",
  "isError": false,
  "cacheSeconds": 900
}
```

It accepts the same `color` and `label` overrides as the SVG route. `style` does
not apply - shields.io renders the badge, so pass `&style=` to shields.io itself.

### What the label is telling you

The badge shows one number, so the label has to carry the caveats. There are
five states:

| Label | Meaning |
|---|---|
| `installs` | exactly one source is configured and it answered |
| `installs (all registries)` | every configured source answered and the total covers all of them |
| `installs (N of M registries)` | only N of the M configured sources answered; the total covers those N |
| `..., mixed windows` | appended when an all-time count and a rolling last-month figure were added together - the total is real but it is not one comparable number |
| `installs: unavailable` | nothing answered and nothing was cached. `isError: true`, colour `lightgrey`. No number is invented |
| `installs: not configured` | the project has no install sources. `isError: true` |

Passing your own `label=` replaces all of that, including the coverage caveat.
That is your README, so it is allowed - but the honest description then becomes
your responsibility. The exact figure, the per-source breakdown, `fetchedAt` and
any `stale: true` flags always live at `GET /api/installs/{project}`.

### `Cache-Control` on the badge routes

GitHub proxies README images through camo, which refetches them constantly, so
both routes are cacheable. The TTL reflects how confident the answer is:

| Situation | `Cache-Control` |
|---|---|
| every source answered live | `public, max-age=3600, stale-while-revalidate=86400` |
| partial coverage, or any source served stale | `public, max-age=900, stale-while-revalidate=86400` |
| unavailable / not configured | `public, max-age=300, stale-while-revalidate=86400` |

The **view** badge (`/api/views/{project}/badge`) deliberately stays
`no-cache, no-store, must-revalidate, max-age=0`. It is a live counter that can
increment on the same request; caching it would show visitors a stale count.
Install counts move slowly and come from rate-limited upstreams, so the opposite
choice is the right one there.

**Agent Checklist:**
- Keep your integration minimal.
- Never let tracking failures crash the user's application (always catch errors).
- Notify the user once the integration is complete and verify the badge appears properly.
- Never present an install count as live if its source came back `stale: true`,
  and never quote `total` without `coverage` when `complete` is `false`.
- Do not pass a custom `label=` to an install badge unless the user asked for
  one - the default label is what states the coverage.
