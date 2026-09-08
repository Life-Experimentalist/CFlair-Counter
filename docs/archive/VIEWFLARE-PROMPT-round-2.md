# ViewFlare round 2: crates.io source, snapshots, public installs display

Paste this whole file as the task. Work in this repository
(V:\Code\ProjectCode\CFlair-Counter, remote Life-Experimentalist/ViewFlare).
The installs aggregator from round 1 is live at counter.vkrishna04.me; this
round extends it. Read INTEGRATION.md and functions/index.ts (installs code
starts near line 1577) before changing anything.

## Ground rules (same as round 1, still binding)

1. Never invent or estimate a number. If a registry call fails, say so in the
   response shape; do not fabricate or carry forward a value silently.
2. Never sum two registries into one figure without carrying the per-source
   breakdown and the mixed-windows labeling that already exists.
3. A stale cached figure is always marked `stale: true`, never passed off as
   fresh.
4. Do not commit secrets. The `ADMIN_PASSWORD = "your-secure-admin-password-here"`
   placeholder in wrangler.toml stays a placeholder. The GitHub Actions
   workflow below reads the password from a repository secret only.
5. Match the existing code style: plain TypeScript on Workers, no framework
   beyond what is already there, same naming and comment conventions.
6. Do not use em dashes anywhere in code comments, docs, or commit messages.

## Deploy invariants (do not touch)

- wrangler.toml `name` stays `cflaircounter` and `database_name` stays
  `cflaircounter-db`. They are deliberately unrenamed so deploys keep hitting
  the existing Pages project and the live D1 database. Do not "fix" them.
- `compatibility_date = "2025-11-05"` stays. Later dates break
  `wrangler pages dev` with the bundled workerd.
- The custom domain counter.vkrishna04.me and every existing route,
  especially `/api/views/*`, must keep working unchanged.

## Part 1: crates.io as a sixth install source

Add `crates` to the supported install sources (`INSTALL_SOURCES`,
`isInstallSource`, the admin PUT validation, the fetch dispatch, INTEGRATION.md
source table, and the `source` column comment in schema.sql).

- Endpoint: `GET https://crates.io/api/v1/crates/{crate}`, read
  `crate.downloads`. This is an all-time figure, so it groups with `github`,
  `vscode` and `openvsx` for the mixed-windows labeling.
- crates.io rejects requests without an identifying User-Agent, and the
  Workers fetch sends none by default. Send something like
  `ViewFlare/1.0 (+https://counter.vkrishna04.me)` on this source's fetch.
- Same per-source cache, TTL, `fetchedAt` and `stale` behaviour as the
  existing five sources.

## Part 2: JSON body on the unconfigured 404

`GET /api/installs/{project}` for a project with no configured sources
currently returns 404 with an empty body, which is indistinguishable from a
typo in the URL. Keep the 404 status but return a JSON body such as
`{"success": false, "error": "No install sources configured for this project"}`
plus a pointer to INTEGRATION.md. Badge and shields.json behaviour is already
correct; leave it.

## Part 3: daily snapshots

Purpose: the rolling-window sources (`npm` last-month, `pypi` last-month via
pypistats) can only be charted if someone records them over time, and
pypistats only retains about 180 days. npm history is recoverable later via
its range endpoint, so this is mostly for pypi and for cheap charting of all
sources. Do not describe it as "history is being lost"; it is not, yet.

Cloudflare Pages Functions have no cron triggers (that is a Workers feature),
so the schedule lives in GitHub Actions:

1. New table `install_snapshots` (day, project_name, source, value, window),
   unique on (day, project_name, source), upsert so re-runs are idempotent.
   Add it to schema.sql and initDatabase like the existing tables.
2. New endpoint `POST /api/admin/installs/snapshot`, authenticated exactly
   like the existing admin PUT (body password, X-Admin-Password, or Bearer).
   It iterates every configured project and source, reuses the existing fetch
   plus cache logic, and upserts one row per project and source for today
   (UTC). Response says how many rows were written and which sources failed.
3. New workflow `.github/workflows/snapshot.yml`: cron `23 2 * * *` plus
   `workflow_dispatch`, one curl step calling that endpoint with the password
   from `secrets.ADMIN_PASSWORD`. Fail the job on a non-200.
4. Read endpoint `GET /api/installs/{project}/history?days=90` returning the
   snapshot rows, per source, oldest first. No charting in this round; just
   the data.

Note in INTEGRATION.md that the repository owner must create the
`ADMIN_PASSWORD` Actions secret by hand; the workflow does not work without
it and must not embed the value.

## Part 4: show install counts on the site

The homepage lists view-counter projects. Add install counts where a project
has sources configured: per-source numbers with their labels (all-time vs
last-month), the aggregate only with the existing "N registries" labeling,
and the stale flag when set. A separate small page or an expandable row both
work; pick whichever fits the existing markup with less new code. Do not
merge install numbers into the view-count figures anywhere.

## Part 5: badge number formatting

Format badge and shields.json messages compactly the way shields.io does
(1234 becomes "1.2k") once a value passes 1000, keeping the exact integer in
the JSON API response. Apply to both the SVG badge and shields.json so the
two never disagree.

## Acceptance

- `wrangler pages dev` runs clean; exercise locally: a crates-configured
  project, the unconfigured 404 body, the snapshot POST (twice, proving
  idempotence), and the history endpoint.
- Existing view-counter routes untouched and still working.
- INTEGRATION.md updated for every new endpoint and the new source.
- Logical commits, push to main, then verify the live endpoints on
  counter.vkrishna04.me after the deploy finishes.
- Report at the end: what shipped, what was verified live, anything skipped.
