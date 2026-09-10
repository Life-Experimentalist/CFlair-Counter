---
name: viewflare-setup
description: Use when the user wants their own ViewFlare instance deployed, forked, or upgraded. Creates a free Cloudflare Worker and D1 database, applies the schema, sets the admin secret, and checks whether an existing deployment is out of date. For wiring an existing instance into a codebase, use viewflare-integration instead.
---

# Deploying a ViewFlare instance

ViewFlare is a serverless view counter, install-count aggregator and event log
that runs on the Cloudflare free tier. It needs no credit card. This skill
covers standing up an instance and keeping it current. Wiring tracking into a
project is a separate, smaller skill: `viewflare-integration`.

## The whole setup

From a clone of the repository:

```bash
npm install
npm run setup
```

`scripts/setup.mjs` does every step: checks the Cloudflare login, creates a D1
database named `viewflare-db` if the account does not already have one, writes
the returned `database_id` into `wrangler.toml`, applies `schema.sql` to the
remote database, lists the nine settings in the table below and offers to change
any of them before the deploy, prompts for the admin password through
`wrangler secret put`, deploys, and prints the `*.workers.dev` URL.

The settings question defaults to no, and each prompt inside it defaults to the
shipped value, so a user who wants the defaults answers nothing. Off a terminal
the whole question is skipped and the shipped values are used, which keeps the
script usable from CI and from an agent harness.

Two lines rather than one because Windows PowerShell 5.1 has no `&&`.

Every step is idempotent. If it stops partway, run it again rather than
unpicking it by hand.

Two things it does not do, both deliberate:

- It never handles the admin password itself. It hands the terminal to
  `wrangler secret put ADMIN_PASSWORD`, which prompts the user directly. Do not
  offer to type a password for the user, do not put one in `wrangler.toml`, and
  do not read it back out afterwards.
- It does not attach a custom domain, because most instances do not need one.
  The `*.workers.dev` URL works immediately. If the user does want their own
  hostname, and the zone is already on the same Cloudflare account, it is one
  command rather than a dashboard trip:

  ```bash
  npx wrangler deploy --domains counter.example.com
  ```

  That creates the DNS record as well. It has to be a flag rather than a
  `[[routes]]` block in `wrangler.toml`, because a committed hostname would make
  every fork's first deploy try to claim someone else's domain. The attachment
  survives later plain `npm run deploy` runs, so the upgrade path below does not
  drop it.

If `npm run setup` reports that wrangler is not logged in, the fix is
`npx wrangler login`, which opens a browser for the user to approve. Wait for
them; do not try to authenticate on their behalf.

## Configuration

Every variable the code reads is already present in `[vars]` in `wrangler.toml`,
set to the value the code falls back to. There is nothing to add, only values to
change. Step 5 of the setup script prints the list.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ENABLE_ADMIN` | `true` | Serve the admin console and admin API |
| `MAX_PROJECTS` | `1000` | Most projects this instance will create. A new name is refused with a 409 at the cap; the ones that exist keep counting. `0` turns it off |
| `DAILY_WRITE_BUDGET` | `30000` | Tracked requests allowed a day before new views get a 503 and a `Retry-After`. It counts requests, and one recorded view is 2 D1 rows, 3 with `TRACK_BREAKDOWN`, against the free tier's 100,000 rows a day. Reads are never shed. Counts only while `TRACK_USAGE` is `true`. `0` turns it off |
| `RATE_LIMIT_REQUESTS` | `60` | Requests allowed per client IP per window |
| `RATE_LIMIT_WINDOW` | `60000` | That window, in milliseconds |
| `INSTALL_CACHE_TTL` | `21600` | Seconds an install count is reused before repolling |
| `TRACK_USAGE` | `true` | Daily row in `usage_stats`. One extra D1 write per view |
| `TRACK_BREAKDOWN` | `false` | Per-referrer and per-country rows. Another write per view |
| `DEBUG` | `false` | Verbose console logging |

Most of these are safe to change at any time: a wrong value costs a redeploy,
not data. Three are worth a second thought. `RATE_LIMIT_REQUESTS` set high
removes the only thing standing between a script and your write quota.
`TRACK_BREAKDOWN` set to `true` adds a second D1 write to every view, so it
roughly doubles what `DAILY_WRITE_BUDGET` is measuring. And `DEBUG` set to
`true` puts request detail in the logs, which is fine while you are watching
them and untidy if you forget. None of them can lose a count, and the admin
password is never one of these values.

`ENABLE_*` are on unless the value is exactly `"false"`. `TRACK_*` and `DEBUG`
are off unless it is exactly `"true"`. Anything else leaves the default.

Changing one is an edit plus `npm run deploy`. Every command in this skill is
an npm script or a `npx wrangler` call, so it is identical in bash and in
PowerShell, with two exceptions to watch for on Windows. Copying the local-dev
file is `cp` against `Copy-Item`. And Windows PowerShell 5.1, the version that
ships with Windows, has no `&&`, so never join two commands with it: give the
user separate lines, the way the setup block above is written.

Never suggest setting these in the Cloudflare dashboard. `wrangler deploy`
replaces the entire deployed variable list with what is in `wrangler.toml`, so a
dashboard-only variable survives until the next deploy and then disappears with
no error. `wrangler.toml` is the source of truth. Secrets are the exception:
they are stored separately and a deploy does not touch them.

`ADMIN_PASSWORD` is the only secret. For local development `.dev.vars` holds the
same names and is read by `wrangler dev` instead of `[vars]`; copy
`.dev.vars.example` to `.dev.vars`. That file is gitignored and must stay so.

The same rule governs `[observability]`, which turns on log and trace retention.
It is declared in `wrangler.toml` for exactly the reason above: with the block
absent, a deploy switches observability back off.

## When something fails

The script prints the failing wrangler output rather than a summary of it. Read
that output before changing anything. The common causes:

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wrangler is not logged in` | no Cloudflare session | `npx wrangler login` |
| `could not create the database` | a `viewflare-db` already exists under a different account, or the free D1 limit is reached | `npx wrangler d1 list` to see what is there |
| deploy fails on `_worker.js` | the bundle was not built | `npm run build:worker`, then retry |
| admin console returns 401 | `ADMIN_PASSWORD` secret is not set | `npx wrangler secret put ADMIN_PASSWORD` |

## Checking for updates

Three versions can drift apart, and they are checked differently.

**The deployed instance.** `GET https://[DOMAIN]/health` returns a `version`
field. Compare it against the latest release:

```bash
curl -s https://[DOMAIN]/health
curl -s https://raw.githubusercontent.com/Life-Experimentalist/ViewFlare/main/package.json
```

If the deployed `version` is lower than the repository's `version`, the instance
is behind. Upgrading is a pull and a redeploy:

```bash
git pull && npm run deploy
```

That is safe to run against a live instance. The schema uses
`CREATE TABLE IF NOT EXISTS` and the deploy replaces the script, not the data.
Check `/health` again afterwards and confirm the version moved.

**This skill and the plugin.** Compare the installed plugin against the
marketplace:

```bash
curl -s https://raw.githubusercontent.com/Life-Experimentalist/ViewFlare/main/.claude-plugin/marketplace.json
```

Read `plugins[0].version`. If it is ahead of the installed plugin:

```
/plugin marketplace update viewflare
/plugin install viewflare-integration@viewflare
```

**A fork's own copy.** A fork that has diverged will not fast-forward. Say so
plainly rather than forcing it, and offer to show `git log --oneline HEAD..upstream/main`
so the user can decide what to take.

Do not run any of these checks unprompted on every invocation. Check when the
user asks about updates, when they report behaviour that the current version
does not have, or when a deploy has just failed in a way a version gap would
explain.

## Bot protection on a custom domain

If the instance sits on a zone with Cloudflare's Bot Fight Mode turned on,
requests from datacenter IPs can be challenged, and the challenge arrives at
the caller as an HTML page where it expected JSON. Scoring is on IP reputation
and request signature, so it is intermittent and a passing call proves nothing. The usual symptom is
`Unexpected token '<' at 1:1` from a CI job or a server-side caller. Browsers
are unaffected.

Two things worth knowing before suggesting a fix:

- Bot Fight Mode is zone-level and does not run on the Ruleset Engine, so a WAF
  Skip, Bypass or Allow rule cannot exempt a path from it on any plan. Do not
  suggest one.
- The `*.workers.dev` hostname is not on the zone, so it is not subject to it.
  That is the right target for CI and for automated callers.

Do not change application code to route around an edge challenge, and do not
turn off a protection the user chose, unless they ask.

## Ongoing jobs

The nightly install-count snapshot runs as a Cloudflare Cron Trigger, declared
in `wrangler.toml` under `[triggers]` and handled by `scheduled()` in
`functions/index.ts`. It runs inside Cloudflare with the database binding
already in hand, so it never makes a request to its own public hostname and is
unaffected by any bot protection on the zone.

It is deployed by `wrangler deploy` along with everything else. `wrangler deploy`
replaces the deployed trigger list, so removing the `[triggers]` block and
deploying removes the schedule.

To test it locally: `npx wrangler dev --test-scheduled`, then
`curl "http://127.0.0.1:8788/__scheduled?cron=23+2+*+*+*"`.

One limit worth knowing: the free plan allows 50 outbound subrequests per
invocation, and a full sweep makes one fetch per project per install source. The
handler makes a single pass and reports `done: false` rather than looping,
because a loop is what would exceed the ceiling. An instance tracking install
counts for more than about sixteen projects will not finish a sweep in one
night.
