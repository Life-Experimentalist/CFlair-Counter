# Cloudflare Deployment & Administration Guide - ViewFlare

Follow this guide to bind your database, configure the admin password, set environment variables, and manage your custom domain.

---

## 1. The whole setup, in one command

```bash
npm install && npm run setup
```

`scripts/setup.mjs` checks your Cloudflare login, creates a D1 database named
`viewflare-db` if your account does not have one, writes the returned
`database_id` into `wrangler.toml`, applies `schema.sql`, prompts for the admin
password, deploys, and prints your `*.workers.dev` URL.

It is idempotent. If it stops partway, run it again.

The rest of this section is what that command does, for when you want to do a
step by hand or something failed.

### Database

```bash
npm run db:create   # wrangler d1 create viewflare-db
npm run db:init     # applies schema.sql to the remote database
```

`db:create` prints a `database_id`. Put it in `wrangler.toml` under
`[[d1_databases]]`. That is the entire binding step: the Worker reads its
bindings from `wrangler.toml` at deploy time, so there is nothing to click in
the dashboard and nothing to re-bind after a redeploy. Under Pages this was a
dashboard form that had to be filled in again whenever the project was
recreated.

### Admin password

The password is a secret, not an environment variable. It never goes in
`wrangler.toml`.

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Wrangler prompts you and sends the value straight to Cloudflare. To rotate it,
run the same command again with a new value; a redeploy is not needed for a
secret to take effect. Rotating every 90 days is a reasonable habit.

A secret cannot be read back, by you or by anyone else. If you lose it, set a
new one. There is no recovery, which is the point.

The non-secret settings live in `[vars]` in `wrangler.toml` and are applied by
`npm run deploy`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ENABLE_ADMIN` | `true` | Serve the admin console and admin API at all |
| `ENABLE_ANALYTICS` | `false` | Heavier analytics queries. `false` saves D1 reads |
| `MAX_PROJECTS` | `100` | Cap on distinct tracked projects |

### Custom domain

The `*.workers.dev` URL works immediately and needs no DNS. To use your own
hostname, with the zone already on your Cloudflare account:

```bash
npx wrangler deploy --domains counter.example.com
```

Cloudflare creates the DNS record and issues the certificate; allow a few
minutes for the certificate. The attachment is stored on the Worker, not in the
deploy command, so later plain `npm run deploy` runs keep it. The dashboard
route is still there if you prefer it: Workers & Pages, the **viewflare**
Worker, **Settings**, **Domains & Routes**, **Add**, **Custom domain**.

Pass the hostname as a flag; do not put `routes` in `wrangler.toml`. A fork's
`npm run deploy` would then try to claim your hostname and fail.

---

## 2. Moving an existing Pages deployment to Workers

Relevant if you deployed ViewFlare before version 2.5.0, when it ran on
Cloudflare Pages as a project named `cflaircounter` with a database named
`cflaircounter-db`.

Earlier versions of this guide argued that the Cloudflare names should stay as
they were, on the grounds that Pages has no rename operation and the project
name is not a public surface. Both of those remain true. What changed is that
the deployment target itself moved to Workers, which needs a new Worker either
way. Renaming during a move that was happening regardless costs nothing extra,
so the names now match the product.

D1 has no rename operation either: `wrangler d1` offers `create`, `delete`,
`export`, `execute` and `time-travel`, and nothing that renames. So the database
rename is a copy, and the order matters.

1. **Record a restore point.** `npx wrangler d1 time-travel info cflaircounter-db`
   prints a bookmark you can restore to for 30 days. Keep it.
2. **Create and fill the new database.**
   ```bash
   npx wrangler d1 create viewflare-db
   npx wrangler d1 export cflaircounter-db --remote --output=dump.sql
   npx wrangler d1 execute viewflare-db --remote --file=dump.sql
   ```
   Put the new `database_id` in `wrangler.toml`. Keep `dump.sql` out of the
   repository.
3. **Check the copy before trusting it.** Run the same query against both and
   compare:
   ```bash
   npx wrangler d1 execute <db> --remote --command "SELECT COUNT(*) AS rows, SUM(view_count) AS views FROM project_views"
   ```
4. **Deploy the Worker.** `npm run deploy`. It lands on `*.workers.dev`, which is
   not your zone, so it is reachable regardless of any bot protection on the
   domain. Verify `/health`, a known view count, and that `/_worker.js` returns
   404.
5. **Re-declare the settings.** Pages kept environment variables in the
   dashboard, and a Worker does not inherit them. `[vars]` in `wrangler.toml`
   covers the non-secret ones. Set `ADMIN_PASSWORD` with
   `npx wrangler secret put ADMIN_PASSWORD`. Check the Pages project's
   **Settings, Environment variables** page for anything else you had set.
6. **Move the domain.** Remove the custom domain from the Pages project first,
   then add it to the Worker. The hostname is unreachable in between, so do the
   two steps together. Move it rather than dropping it: every badge already
   published on the internet points at that hostname.
7. **Only then delete the old things**, and only after the domain has been
   answering correctly for a while. Delete the Pages project first, because it
   still holds a binding to the old database, then
   `npx wrangler d1 delete cflaircounter-db`. Both are irreversible.

**The write window.** Anything recorded between the export in step 2 and the
domain move in step 6 lands in the old database and is not in the new one.
There is no way to avoid this with a copy, only to keep it short. Re-running the
import later does not fix it: the rows conflict on their primary keys. If the
gap ran long enough to matter, recreate `viewflare-db` and import a fresh
export rather than layering one import on another.

**What does not change.** The binding name is `DB` in both, which is what the
code reads, so no application code changes. Project names in `project_views`
are untouched, so every existing badge URL keeps working.

## Staying inside the free tier

The free plan gives you 100,000 Worker requests a day, 10ms CPU per invocation,
5,000,000 D1 rows read a day and 100,000 rows written. Three things in the Worker
are tuned for that.

**The schema runs once per isolate.** `initDatabase` used to issue about ten
`CREATE TABLE IF NOT EXISTS` statements on every single request. It now runs at
most once per Worker isolate and every later caller reuses the same promise. The
schema itself is still applied by `npm run db:init`, which is the only place it
needs to happen.

**`usage_stats` is off by default.** It cost one extra D1 write per tracked view
to record numbers the Cloudflare dashboard already reports. Set `TRACK_USAGE` to
`true` if you want the in-database copy back.

**Read routes are served from the Workers cache.** Every unauthenticated GET that
touches D1 goes through `caches.default` first. A hit answers without a single
D1 read. Check the `X-Worker-Cache` response header to see which you got:

```bash
curl -sI "https://your-domain.com/api/views/my-project/badge" | grep -i x-worker-cache
```

TTLs are 60 seconds for views, compute and metrics, 300 seconds for stats,
history and installs. A count can therefore lag by up to a minute, which is the
trade for a README badge that no longer reads D1 on every render.
`?inc=true` always bypasses the cache, because that request is a write.

### The one thing the Worker cannot fix

A cache hit still counts as a Worker invocation. If a badge gets hammered hard
enough to threaten the 100,000/day request limit, move the caching to the edge
so Cloudflare answers without starting the Worker at all. That is a dashboard
setting, not code:

1. Open the zone for your custom domain, then **Caching** then **Cache Rules**.
2. Create a rule matching `(starts_with(http.request.uri.path, "/api/") and ends_with(http.request.uri.path, "/badge"))`.
3. Set **Eligible for cache**, **Edge TTL** to "Use cache-control header if present", and **Browser TTL** to respect origin.

This only works on a zone you control, so it applies to a custom domain and
not to the `*.workers.dev` hostname.
