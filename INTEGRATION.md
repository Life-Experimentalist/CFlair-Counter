# ViewFlare Auto-Integration & Deployment Guide

> **🤖 AI Agents & Coding Assistants**: 
> You have been directed to this file to help the user deploy and/or integrate **ViewFlare**. 
> Read the instructions carefully. ViewFlare is designed to be 100% free using Cloudflare Workers and D1 (no credit card required).

## Goal 1: Auto-Deploying a new ViewFlare Instance for the User
If the user wants you to "setup" or "deploy" ViewFlare for them from scratch:

1. **Fork & Clone**: Have the user fork this repository, or clone it directly if you are running in their workspace.
2. **Run the setup script**: `npm install && npm run setup`. It checks the
   Cloudflare login, creates a `viewflare-db` D1 database, writes the returned
   `database_id` into `wrangler.toml`, applies `schema.sql` to the remote
   database, prompts for the admin password, deploys, and prints the
   `*.workers.dev` URL. Every step is idempotent, so re-run it after a failure
   rather than unpicking it.
3. **If it stops at the login check**: the user runs `npx wrangler login` and
   approves it in a browser. Wait for them. Do not try to authenticate for them.
4. **Never handle the password yourself**. The script hands the terminal to
   `npx wrangler secret put ADMIN_PASSWORD`, which prompts the user directly.
   `ADMIN_PASSWORD` is a Workers secret and never belongs in `wrangler.toml`.
5. **Custom domain (optional)**: the `*.workers.dev` URL works immediately. A
   custom domain is a dashboard step: Workers & Pages, the `viewflare` Worker,
   Settings, Domains & Routes.

### If you put it on a custom domain

Cloudflare's Bot Fight Mode challenges requests from datacenter IPs, and the
challenge reaches the caller as an HTML page where it expected JSON
(`Unexpected token '<' at 1:1`). Browsers are unaffected; CI jobs and
server-side callers are not. The `*.workers.dev` hostname is not on the zone, so
point automated callers there. Bot Fight Mode does not run on the Ruleset
Engine, so a WAF skip rule cannot exempt a path from it.

---

## Goal 2: Integrating ViewFlare into the User's Existing Project
If the user already has a deployed instance of ViewFlare (or is using the public one) and wants you to integrate it into their codebase:

1. **Ask for the Domain**: If the user hasn't provided their ViewFlare domain, ask for it (e.g., `https://counter.vkrishna04.me` or `https://viewflare.your-subdomain.workers.dev`).
2. **Determine the Project Name**: Create a URL-safe slug for the page or component being tracked (e.g., `portfolio-home`, `docs-api`).
3. **Log a View (Code Integration)**:
   - Insert a silent background POST request when the tracked page loads. Treat
     it as fire-and-forget: short timeout, swallowed error, never blocking or
     breaking the thing it is measuring. It needs no headers, no body and no
     API key.
   - **Browser JavaScript**, where `keepalive` lets the request outlive the
     page, which matters because a pageload beacon often fires just as the
     visitor navigates away:
     ```javascript
     fetch('https://[DOMAIN]/api/views/[PROJECT_NAME]', {
       method: 'POST',
       keepalive: true,
     }).catch(() => {});
     ```
   - **Node (server side)**:
     ```javascript
     fetch('https://[DOMAIN]/api/views/[PROJECT_NAME]', {
       method: 'POST',
       signal: AbortSignal.timeout(3000),
     }).catch(() => {});
     ```
   - **Python**:
     ```python
     import requests
     try:
         requests.post('https://[DOMAIN]/api/views/[PROJECT_NAME]', timeout=3)
     except Exception:
         pass
     ```
   - **Shell / CI**, where the `|| true` keeps a failed call from failing the
     step:
     ```bash
     curl -s -o /dev/null -m 3 -X POST "https://[DOMAIN]/api/views/[PROJECT_NAME]" || true
     ```
   - **Go**:
     ```go
     client := &http.Client{Timeout: 3 * time.Second}
     if resp, err := client.Post("https://[DOMAIN]/api/views/[PROJECT_NAME]", "", nil); err == nil {
         resp.Body.Close()
     }
     ```
   - **Rust**, with `ureq = "2"` in `Cargo.toml`:
     ```rust
     let _ = ureq::post("https://[DOMAIN]/api/views/[PROJECT_NAME]")
         .timeout(std::time::Duration::from_secs(3))
         .call();
     ```
   - The response is JSON and carries the new count, so any of these can read
     it back instead of discarding it:
     `{"success": true, "projectName": "...", "totalViews": 2, "uniqueViews": 1}`.
4. **Display a Badge (Markdown / HTML)**:
   - Insert an image pointing to the badge generator endpoint.
   - **Markdown**:
     ```markdown
     ![Views](https://[DOMAIN]/api/views/[PROJECT_NAME]/badge?color=blue&style=flat-square)
     ```
   - *Optional Parameters*: `color` (blue, green, red, purple, etc.), `style` (flat, flat-square, for-the-badge), `label` (custom text).

### Reading many projects at once

A portfolio page listing fifteen projects used to make fifteen requests.
`GET /api/views?names=a,b,c` answers all of them in one. It is strictly
read-only: it never increments, so it is safe to call on every render.

```bash
curl "https://counter.vkrishna04.me/api/views?names=ViewFlare,RanobeGemini,does-not-exist"
```

```json
{
  "success": true,
  "views": { "ViewFlare": 2481, "RanobeGemini": 190 },
  "uniqueViews": { "ViewFlare": 1204, "RanobeGemini": 88 },
  "missing": ["does-not-exist"],
  "requested": 3,
  "found": 2,
  "total": 2671,
  "timestamp": "2026-09-08T04:11:02.310Z"
}
```

- Up to 50 names per request. Names are trimmed and de-duplicated; more than 50
  is a 400 rather than a silent truncation, and so is an empty `names`.
- **A project that has never been recorded comes back in `missing`, not as a
  zero.** A typo in a name cannot pass for a real count of nothing.
- `total` sums only the projects that were found.
- `projects=` is accepted as an alias for `names=`.
- Responses carry `Cache-Control: public, max-age=60`.

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

## Goal 5: History over time

A registry only ever reports what is true right now, and two of the sources
(`npm`, `pypi`) report a rolling last-month window that nothing can reconstruct
afterwards. Charting any of it means writing down what was true each day.

The schedule is a Cloudflare Cron Trigger, declared in `wrangler.toml` under
`[triggers]` and handled by `scheduled()` in `functions/index.ts`. It runs
inside Cloudflare with the D1 binding already in hand, so it never makes a
request to its own public hostname and no admin password is involved. It used to
be a GitHub Actions workflow, which could not reliably reach the site from a
datacenter IP.

### `POST /api/admin/installs/snapshot`

Records one row per project and source for today (UTC), and one row per project
for view counts. Authenticated the same three ways as the other admin routes:
a `password` field in the body, `X-Admin-Password`, or `Authorization: Bearer`.

```bash
curl -X POST https://counter.vkrishna04.me/api/admin/installs/snapshot \
  -H "Content-Type: application/json" \
  -H "X-Admin-Password: YOUR_ADMIN_PASSWORD" \
  -d '{}'
```

```json
{
  "success": true,
  "day": "2026-09-08",
  "projectsScanned": 4,
  "projectsTotal": 4,
  "offset": 0,
  "nextOffset": null,
  "done": true,
  "installRowsWritten": 9,
  "viewRowsWritten": 2,
  "skipped": [
    { "project": "RanobeGemini", "source": "pypi",
      "reason": "cached figure is stale, not recorded as today",
      "error": "pypistats HTTP 429" }
  ],
  "timestamp": "2026-09-08T03:19:18.941Z"
}
```

Three things to know about it:

- **Re-running it is safe.** The unique key is (day, project, source), and the
  write is an upsert. Two runs on the same day leave the same rows. The install
  cache is warm after the first run, so the second is nearly free.
- **A source that could not be read is skipped, not guessed.** A failed fetch
  writes nothing. A *stale* cached figure also writes nothing, because a figure
  from an earlier day stamped with today's date is a fabricated data point. Both
  appear in `skipped` with the upstream error.
- **It walks the project list a page at a time.** One request may only make so
  many outbound fetches, so the endpoint handles up to 20 projects per call and
  returns `nextOffset` when more remain. Send it back as `{"offset": N}` until
  `done` is `true`. The shipped workflow does exactly that.

### `GET /api/installs/{project}/history`

| Query | Default | Meaning |
|---|---|---|
| `days` | `90` | How far back to read, 1 to 365 |
| `bucket` | `day` | `day`, `week` (ISO, Monday-start) or `month` |

```bash
curl "https://counter.vkrishna04.me/api/installs/MyProject/history?days=90&bucket=week"
```

```json
{
  "success": true,
  "project": "MyProject",
  "days": 90,
  "bucket": "week",
  "sources": [
    {
      "source": "crates",
      "label": "crates.io",
      "window": "all-time",
      "summary": {
        "points": 5, "first": 1000000, "last": 1500000,
        "change": 500000, "changePercent": 50.0, "perDay": 17857.14
      },
      "points": [
        { "day": "2026-08-10", "value": 1000000 },
        { "day": "2026-08-17", "value": 1100000 }
      ]
    }
  ],
  "timestamp": "2026-09-08T03:19:34.686Z"
}
```

**Snapshots are gauges, not counters.** Each row is the registry's own running
total on that day, so rolling a week or a month up keeps that bucket's *last*
reading. Summing the days inside a bucket would be meaningless.

`summary` is arithmetic on the returned points and nothing more: `change` is
last minus first, `changePercent` is that over first, and `perDay` divides by
the calendar days between the two. With fewer than two points there is nothing
to compare, so those three are `null` rather than `0`.

Sources are deliberately not summed here. They measure different things over
different windows; `GET /api/installs/{project}` is the endpoint that carries
the labelled aggregate.

### `GET /api/views/{project}/history?series=snapshots`

The default response of this endpoint is unchanged: a visitor-derived daily
count for the last 30 days, from `visitor_tracking`. That table stores one row
per visitor with the *last* visit time, so it is an approximation, not a series.

`series=snapshots` reads the real thing, recorded by the same nightly job:

```bash
curl "https://counter.vkrishna04.me/api/views/MyProject/history?series=snapshots&days=90&bucket=week"
```

```json
{
  "success": true,
  "projectName": "MyProject",
  "series": "snapshots",
  "days": 90,
  "bucket": "day",
  "summary": { "points": 1, "first": 2, "last": 2,
               "change": null, "changePercent": null, "perDay": null },
  "points": [ { "day": "2026-09-08", "value": 2, "uniqueViews": 1 } ]
}
```

It only goes back as far as the first night the job ran.

### `GET /api/views/{project}/history?series=breakdown`

Where the views came from, grouped by country or by referring host, over the
last `days` days (default 30, max 365). `by=country` is the default; `by=referrer`
is the other option. Up to 100 buckets, biggest first.

```bash
curl "https://counter.vkrishna04.me/api/views/MyProject/history?series=breakdown&by=referrer&days=30"
```

```json
{
  "success": true,
  "projectName": "MyProject",
  "series": "breakdown",
  "by": "referrer",
  "days": 30,
  "enabled": true,
  "total": 5,
  "buckets": [
    { "key": "none", "views": 2 },
    { "key": "github.com", "views": 2 },
    { "key": "news.ycombinator.com", "views": 1 }
  ]
}
```

Three things to read carefully:

- `enabled` says whether this instance is recording the breakdown at all. It is
  off unless `TRACK_BREAKDOWN` is `"true"`, because it costs a second D1 write
  on every view. `enabled: false` with an empty `buckets` means nothing was
  recorded, which is not the same as nobody visiting.
- `"key": null` means the signal was missing, not that the value is zero or
  unknown-but-real. For countries that happens under `wrangler dev` and
  wherever Cloudflare does not set `CF-IPCountry`; for referrers it happens when
  a `Referer` was sent but could not be parsed. No country code is ever guessed
  from anything else.
- `"key": "none"` on a referrer breakdown means no `Referer` header arrived. That
  covers genuine direct hits and requests where the browser's referrer policy
  stripped it, and the two cannot be told apart.

Only the host is stored, never the full referring URL, and nothing is stored per
visitor: a row is one day, one project, one country and one host, with a count.
The rollup query parameter does not apply here, so ask for each dotted project
by name.

### Setting the schedule up

`.github/workflows/snapshot.yml` runs at 02:23 UTC daily and on
`workflow_dispatch`. It needs one thing that is not in the repository:

> **The repository owner must create an `ADMIN_PASSWORD` Actions secret by
> hand**, under Settings -> Secrets and variables -> Actions. The workflow reads
> `secrets.ADMIN_PASSWORD` and never embeds the value. Without the secret the
> job fails on its first step with a clear message. The placeholder in
> `wrangler.toml` stays a placeholder.

The job fails on a non-200 from the endpoint. A single dead registry is not a
failure: it lands in `skipped`, gets printed in the job log, and the run stays
green.

---

## Goal 6: Recording named events

The view counter answers "how many". `POST /api/events` answers "what
happened": a signup, a download, a button press, a CLI invocation, a finished
job. Events live in their own table and never touch view counts.

```bash
curl -s -o /dev/null -m 3 -X POST "https://[DOMAIN]/api/events" \
  -H "Content-Type: application/json" \
  -d '{"category":"cli","event":"build_run","metadata":{"version":"1.4.0"}}' || true
```

```json
{
  "success": true,
  "category": "cli",
  "event": "build_run",
  "timestamp": "2026-09-08T04:17:02.959Z"
}
```

What the endpoint accepts:

- `category` and `event` are both required strings of 64 characters or fewer.
  Anything missing, non-string or over-long is a 400, not a quietly dropped
  record. Malformed JSON is a 400 with `"error": "Invalid JSON body"`.
- `metadata` is optional and free-form. It is stored as JSON next to the event.
  It is never indexed, filtered on, or summarised.
- There is no project name here. Group events with `category` instead.
- The caller is recorded as `session_id`: a short non-cryptographic hash of IP
  plus user agent, the same one the view counter uses. The raw IP and user
  agent are not stored. That hash is not salted or rotated, so the same visitor
  on the same browser produces the same value over time.

Same fire-and-forget rules as a view.

```javascript
fetch('https://[DOMAIN]/api/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ category: 'ui', event: 'export_clicked' }),
  keepalive: true,
}).catch(() => {});
```

```python
import requests
try:
    requests.post('https://[DOMAIN]/api/events', timeout=3,
                  json={'category': 'worker', 'event': 'job_finished'})
except Exception:
    pass
```

### Reading the rollup

`GET /api/metrics` returns recorded events grouped by category, then by name,
with a count for each.

```bash
curl "https://[DOMAIN]/api/metrics"
```

```json
{
  "success": true,
  "metrics": { "docs": { "smoke_test": 1 } },
  "timestamp": "2026-09-08T04:17:03.063Z"
}
```

- Counts are **all-time**. This endpoint has no date filter and no window
  parameter, so it is a lifetime total, not a recent one.
- The 100 highest-count category/event pairs are returned. An instance with
  more than 100 distinct pairs will not see the rarest ones here.
- `metadata` never appears in the rollup. It is stored, not aggregated. Read it
  out of D1 directly if you need it.
- Both endpoints are rate limited per IP: 60 requests a minute by default,
  configurable with `RATE_LIMIT_REQUESTS` (a count) and `RATE_LIMIT_WINDOW`
  (milliseconds, so a minute is `60000`). Over the limit is a 429 carrying
  `Retry-After` and `X-RateLimit-*` headers. The count is held in memory on
  the Worker instance serving the request, so treat the limit as approximate
  rather than a global guarantee.

## Goal 7: Computing one number

The other endpoints each answer with their own figure: views here, installs
there, event counts somewhere else. `GET /api/compute/:project` takes an
arithmetic expression over those figures and answers with a single value.

```bash
curl "https://[DOMAIN]/api/compute/computedemo?expr=views.total%2Bevents.cli.build_run"
```

```json
{
  "success": true,
  "project": "computedemo",
  "expression": "views.total+events.cli.build_run",
  "value": 8,
  "formatted": "8",
  "unavailable": false,
  "reason": null,
  "partial": false,
  "stale": false,
  "mixedWindows": false,
  "inputs": [
    {
      "name": "events.cli.build_run",
      "value": 3,
      "scope": "instance",
      "stale": false,
      "partial": false,
      "note": "the event log is not project scoped"
    },
    { "name": "views.total", "value": 5, "scope": "project", "stale": false, "partial": false }
  ],
  "timestamp": "2026-09-09T15:29:56.893Z"
}
```

### Encode the plus sign

A `+` in a URL query string decodes to a space, so `expr=a+b` arrives as
`a b` and is rejected. Write it as `%2B`. The error message says so:

```json
{
  "success": false,
  "error": "Two values with no operator between them. A \"+\" in a URL means a space: write it as %2B."
}
```

`*`, `-`, `/`, `%`, `(`, `)` and `,` are safe to send literally in most
clients, though `%` inside a value is safer as `%25`.

### What an expression can contain

| Part | What is allowed |
| --- | --- |
| Numbers | `5`, `2.5` |
| Operators | `+` `-` `*` `/` `%`, and unary minus |
| Grouping | `( )` |
| Functions | `min`, `max` (1 to 8 arguments), `abs`, `floor`, `ceil`, `round(x)` or `round(x, digits)`, `pct(part, whole)` |
| Variables | the names in the next table |

| Variable | Scope | Value |
| --- | --- | --- |
| `views.total` | this project | Lifetime view count |
| `views.unique` | this project | Distinct visitor hashes |
| `installs.total` | this project | Sum across the configured registries |
| `installs.<source>` | this project | One registry: `vscode`, `openvsx`, `pypi`, `github`, `npm`, `crates` |
| `events.<category>` | whole instance | All events in that category |
| `events.<category>.<name>` | whole instance | One named event |

Event counts are instance wide, not per project: the event log has no project
column, which is why every event input carries a `scope` of `instance` and
says so in its `note`. Views and installs are scoped to the project in the URL.

Identifiers are made of letters, digits, underscores and dots, so a category
or event name containing a hyphen cannot be referenced in an expression.

There is no `eval` behind this. The expression is tokenised and walked by a
recursive descent parser that knows the pieces above and nothing else.
Expressions are capped at 200 characters and 24 levels of nesting. Anything
unrecognised is a 400 that names it:

```json
{ "success": false, "error": "Unknown variable \"views.bogus\". Try views.total or views.unique." }
```

### Unavailable beats a made-up number

If any input an expression reads has no value, the whole metric is
unavailable. It never quietly becomes 0.

```bash
curl "https://[DOMAIN]/api/compute/computedemo?expr=views.total%2Binstalls.total"
```

```json
{
  "success": true,
  "value": null,
  "formatted": "unavailable",
  "unavailable": true,
  "reason": "no value for installs.total",
  "inputs": [
    {
      "name": "installs.total",
      "value": null,
      "scope": "project",
      "stale": false,
      "partial": false,
      "note": "no install sources configured for this project"
    },
    { "name": "views.total", "value": 5, "scope": "project", "stale": false, "partial": false }
  ]
}
```

- A result that is not a finite number is unavailable too, so a divide by zero
  or a `pct(x, 0)` reports `"the expression does not produce a finite number"`
  rather than `Infinity` or `NaN`.
- `partial` is true when `installs.total` was summed from fewer registries than
  are configured. The count is still returned, and `inputs` says how many of
  how many answered.
- `stale` is true when a registry figure came from cache after the upstream
  failed, matching the `stale` flag on `GET /api/installs/:project`.
- `mixedWindows` is true when an all-time registry count was added to a rolling
  window one. Same meaning as on the installs endpoint.

### Badges

Both badge shapes take the same `expr`, so a README badge carries its own
formula in its URL.

```markdown
![Activity](https://[DOMAIN]/api/compute/PROJECT/badge?expr=views.total%2Bevents.cli&label=activity)
```

```text
/api/compute/PROJECT/badge?expr=...&label=...&color=...&style=...
/api/compute/PROJECT/shields.json?expr=...&label=...&color=...
```

```bash
curl "https://[DOMAIN]/api/compute/computedemo/shields.json?expr=round(pct(events.cli.build_fail%2Cevents.cli),1)&label=fail%20rate"
```

```json
{
  "schemaVersion": 1,
  "label": "fail rate",
  "message": "25",
  "color": "blue",
  "isError": false,
  "cacheSeconds": 300
}
```

- `label` defaults to `metric` and carries the caveats the number cannot show:
  `metric (partial)`, `metric (stale)`, `metric (partial, stale, mixed windows)`.
  A label you pass wins, and the caveats are appended to it.
- `style` is `flat`, `flat-square` or `for-the-badge`, same as the other badges.
- `color` defaults to `blue`, or `lightgrey` when the metric is unavailable.
- A broken expression renders as a grey `invalid expression` badge with HTTP
  200, rather than a broken image in someone's README. The JSON endpoint
  answers 400 for the same expression.
- Whole numbers use the compact form (`1.2k`, `3.4M`); a fraction is cut to two
  decimal places.

### Caching and limits

- The JSON endpoint is rate limited per IP like the other read endpoints. The
  two badge shapes are not, for the same reason the view and install badges are
  not: GitHub's camo proxy fetches from a small pool of IPs.
- `Cache-Control` is 300 seconds when the expression reads views or events,
  since those move on every request. An expression that only reads installs
  holds for 3600 seconds, or 900 when the answer was partial or stale, and 300
  when it is unavailable.

### Worked examples

```text
expr=views.total%2Finstalls.total                     views per install
expr=round(pct(views.unique%2Cviews.total),1)         unique share, one decimal
expr=max(views.total%2Cinstalls.total)                whichever is larger
expr=installs.npm%2Binstalls.pypi                     two registries only
expr=round(views.total%2F30)                          rough views per day over a month
expr=events.cli.build_run-events.cli.build_fail       net successful builds
```

## Goal 8: Organising many projects under one name

A dot makes a project name a path. `acme.api.docs` sits under `acme.api`, which
sits under `acme`. Nothing about storage changes: the name is still one string
in one column, created on first use, and every flat name that exists today keeps
working exactly as it did.

The dots only matter when a caller asks for a rollup.

### Recording

Nothing special. Track each surface under its own dotted name.

```bash
curl -X POST "https://your-domain.com/api/views/acme.api.docs"
curl -X POST "https://your-domain.com/api/views/acme.web.landing"
curl -X POST "https://your-domain.com/api/views/acme.cli"
```

### Reading a whole subtree

`?rollup=1` (or `rollup=true`) sums a project with every project below it.

```bash
curl "https://your-domain.com/api/views/acme?rollup=1"
```

```json
{
  "success": true,
  "projectName": "acme",
  "rollup": true,
  "totalViews": 3140,
  "uniqueViews": 902,
  "memberCount": 4,
  "members": [
    { "projectName": "acme",            "totalViews": 12,   "uniqueViews": 8 },
    { "projectName": "acme.api.docs",   "totalViews": 1880, "uniqueViews": 540 },
    { "projectName": "acme.cli",        "totalViews": 402,  "uniqueViews": 121 },
    { "projectName": "acme.web.landing","totalViews": 846,  "uniqueViews": 233 }
  ]
}
```

The parent itself is included whether or not anything was ever tracked against
it directly. `members` is the breakdown, so you get the sum and the parts in one
request rather than one request per project.

Without `rollup` the response is unchanged from what it has always been:
`totalViews`, `uniqueViews`, `description`, `createdAt`, for that one project.

### Badges and computed metrics

Both take the same parameter.

```md
![All of acme](https://your-domain.com/api/views/acme/badge?rollup=1&label=acme)
```

```bash
curl "https://your-domain.com/api/compute/acme?expr=views.total&rollup=1"
```

Under a rollup every `views.*` variable sums the subtree, and the input reports
`"scope": "subtree"` with a note saying how many projects it covered.

### What rollup does not do

- **Installs stay scoped to the one project.** Rolling them up would mean a
  separate registry fan-out for every descendant, which is exactly the cost this
  service is built to avoid. Under a rollup, `installs.total` still reads the
  sources configured for the project in the URL and says so in its `note`.
- **Events are unaffected.** The event log has no project column, so event
  counts are instance wide with or without a rollup.

### Matching rules

Matching is on whole dotted segments. `acme` covers `acme.api` and
`acme.api.docs`, and never `acme_other` or `acmex`. This matters more than it
looks: underscores are legal in a name and are a wildcard in SQL `LIKE`, so the
query uses a range comparison instead, which is also the form that uses the
existing index.

Renaming accepts the same grammar: letters, digits, `-`, `_`, and `.` between
segments, up to 100 characters. `PUT /api/admin/projects/{project}` used to
reject a dot outright, so a hierarchical name could be created but never
renamed. It no longer does.

There is no depth limit beyond the 100-character name cap, but three or four
levels is usually enough to stay readable in a badge label.
