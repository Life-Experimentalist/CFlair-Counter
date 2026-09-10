---
name: viewflare-integration
description: Use when adding view tracking, event tracking, badges, or a computed metric to a project against an existing ViewFlare instance. Covers the POST snippet, badge markdown, dotted project names and the compute endpoint. For deploying an instance in the first place, use viewflare-setup instead.
---

# Wiring ViewFlare into a project

This assumes an instance already exists. If the user needs one, that is the
`viewflare-setup` skill, not this one.

You need one thing to start: the instance domain, for example
`https://viewflare.example.workers.dev` or a custom domain. Ask for it if it is
not obvious from the repository.

## 1. Pick a project identifier

A URL-safe slug for the surface being tracked: `readme-views`, `app-homepage`.

For anything with more than a handful of tracked surfaces, use a dotted name:
`acme.docs.getting-started`, `acme.api.v2`. Then `GET /api/views/acme?rollup=1`
sums the whole tree and returns the per-project breakdown in `members`, and
`/api/views/acme/badge?rollup=1` renders that sum. Rollup is opt-in, so a flat
name behaves exactly as before.

The separator is a dot and not a slash on purpose. Project names are a single
path segment, and `/api/views/:project/badge`, `/history` and `/shields.json`
already occupy the space after the next slash. A project literally named
`acme/badge` would be indistinguishable from the badge of `acme`.

## 2. Count a view

```javascript
fetch('https://[DOMAIN]/api/views/[PROJECT_ID]', { method: 'POST', keepalive: true }).catch(() => {});
```

Swallow the error so a tracking failure cannot break the application, and set a
short timeout away from the browser: `AbortSignal.timeout(3000)` in Node, `-m 3`
for curl, `timeout=3` for requests. `INTEGRATION.md` Goal 2 carries the same
snippet for Node, Python, shell, Go and Rust.

Reading is separate from counting. `GET /api/views/[PROJECT_ID]` never
increments, so it is safe on every render, and `GET /api/views?projects=a,b,c`
reads up to 50 at once instead of making 50 requests.

## 3. Add a badge

```markdown
![Views](https://[DOMAIN]/api/views/[PROJECT_ID]/badge?color=violet&style=flat-square)
```

Styles: `flat`, `flat-square`, `for-the-badge`.

## 4. Record something other than a page view

For a signup, a download or a CLI run, `POST /api/events` with
`{"category": "...", "event": "..."}` and an optional `metadata` object.
`GET /api/metrics` reads the counts back. `INTEGRATION.md` Goal 6 has the full
contract.

## 5. Condense several numbers into one (optional)

`GET /api/compute/[PROJECT_ID]?expr=...` evaluates arithmetic over the numbers
ViewFlare already holds and answers with a single value, plus `/badge` and
`/shields.json` siblings that take the same `expr`.

Variables are `views.total`, `installs.total`, `installs.<source>`,
`events.<category>` and `events.<category>.<name>`.
Operators are `+ - * / %` with parentheses, and the functions are `min`, `max`,
`abs`, `round`, `floor`, `ceil` and `pct(part, whole)`.

A `+` in a URL decodes to a space, so always write it as `%2B`:

```markdown
![Reach](https://[DOMAIN]/api/compute/[PROJECT_ID]/badge?expr=views.total%2Binstalls.total&label=reach)
```

If any input is unavailable the whole metric reports unavailable rather than
substituting a zero, so check `unavailable` and `reason` before using the value.
Never fill a gap with an estimate. `INTEGRATION.md` Goal 7 has the full
contract.

## When a call gets HTML instead of JSON

If a request answers with an HTML page starting `<`, the usual cause is
Cloudflare's Bot Fight Mode on the instance's zone challenging a datacenter IP.
It affects CI runners and server-side callers, not browsers, and it is scored
per request, so it can hit one call and not the next. A `*.workers.dev`
hostname is not on the zone and is not subject to it. Do not work around it in
application code and do not suggest a WAF skip rule, which cannot affect Bot
Fight Mode.

## Working against an instance whose repository you do not have

Every deployment serves `https://[DOMAIN]/llms.txt`, a short plain-text summary
of every endpoint, and `https://[DOMAIN]/openapi.yaml`, the same API as OpenAPI
3.1 with request and response shapes. Read one of those rather than guessing.

`GET /health` returns the instance's `version`. If an endpoint described here
answers 404, check that first: the instance may predate it. The latest version
is `plugins[0].version` in
`https://raw.githubusercontent.com/Life-Experimentalist/ViewFlare/main/.claude-plugin/marketplace.json`,
and upgrading an instance is the `viewflare-setup` skill.

Prefer minimal, non-blocking code when adding tracking to someone's application,
and validate the change when done.
