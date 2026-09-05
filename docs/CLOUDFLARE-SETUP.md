# Cloudflare Deployment & Administration Guide - ViewFlare

Follow this guide to bind your database, configure the admin password, set environment variables, and manage your custom domain.

---

## 🚀 1. Database Creation & Bindings

### Create D1 Database (CLI)
```bash
# Create the D1 database binding
npm run db:create

# Initialize the schema tables (project_views, visitor_tracking, usage_stats)
npm run db:init
```

### Bind D1 to Cloudflare Pages (Dashboard)
To allow the worker to write view counts, it must be bound to D1:
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Go to **Workers & Pages** → **viewflare** → **Settings** → **Functions**.
3. Scroll to **"D1 database bindings"** and click **"Add binding"**.
4. Set:
   - **Variable name:** `DB`
   - **D1 database:** Select `cflaircounter-db` from the dropdown list. (That is
     the existing production database. D1 has no rename operation, so it keeps
     the old name even though the project is now ViewFlare - see the migration
     section at the end of this guide.)
5. Click **"Save"**.
6. **Redeploy** the page (Deployments → Retry deployment) to apply the binding.

---

## 🔑 2. Admin Password Configuration

By default, development environments use `admin123`. You must change this on production!

### Set Password in Environment variables:
1. Go to **Settings** → **Environment variables** in your Pages project dashboard.
2. Under **Environment variables**, click **Add variable**.
3. Set the name to `ADMIN_PASSWORD` and enter your secure password as the value.
4. Set another variable `ENABLE_ADMIN` to `true`.
5. Set `ENABLE_ANALYTICS` to `true` (or `false` to save 50%+ on D1 write costs).
6. Click **Save** and **Redeploy** the project.

Alternatively, you can set secrets using the Wrangler CLI:
```bash
npx wrangler pages secret put ADMIN_PASSWORD
```

---

## 🌐 3. Custom Domain Mapping

Map a custom subdomain (e.g. `counter.vkrishna04.me`) to your counter:
1. In your Cloudflare Pages dashboard, go to the **Custom domains** tab.
2. Click **Set up a custom domain**.
3. Enter your domain name (e.g., `counter.vkrishna04.me`).
4. Click **Continue**. Cloudflare will automatically configure DNS records if the domain is on your Cloudflare account.
5. Wait 5-10 minutes for DNS propagation and SSL certificate issuance.

---

## 🔄 Password Recovery & Rotation

- **Recovery:** Passwords are held in Pages environment variables (encrypted at rest), not hashed in SQL. You can view or reset your password directly from the **Environment variables** page of the Cloudflare dashboard.
- **Rotation:** We recommend rotating the `ADMIN_PASSWORD` every 90 days.
```bash
# Rotate CLI secret
npx wrangler pages secret put ADMIN_PASSWORD
npm run deploy
```

---

## 🚚 Migrating the Pages project from `cflaircounter` to `viewflare`

**Read this before the next deploy.** `wrangler.toml` now says `name = "viewflare"`.
Cloudflare has **no rename operation for a Pages project** - changing `name` does not
rename anything, it simply targets a *different* project. The next `wrangler pages deploy`
will therefore create and deploy to a brand-new, empty project called `viewflare`, while
the live `cflaircounter` project (the one `counter.vkrishna04.me` currently points at)
carries on untouched.

Nothing below can be automated from this repository. Do these by hand, in this order.

### What must not change

- **`counter.vkrishna04.me`.** The portfolio and the GitHub profile README badge
  (`counter.vkrishna04.me/api/views/VKrishna04/badge`) both point at it. It must end up
  attached to whichever project is serving traffic. A second hostname may be added as an
  alias, never as a replacement.
- **The D1 database `cflaircounter-db`.** It holds every recorded count. D1 has no rename
  either. Do **not** create a `viewflare-db` and re-bind to it - that would silently start
  the counts from zero. Re-attach the *existing* database.
- **The `project_name` values inside `project_views`.** The portfolio writes counts keyed
  on each project's repo name. Renaming or migrating those rows orphans every count
  already recorded.

### Steps

1. **Rename the GitHub repository first** (`CFlair-Counter` -> `ViewFlare`), if you have
   not already. GitHub redirects the old URLs, so existing clones and links keep working.
2. **Create the new Pages project.** Dashboard -> **Workers & Pages** -> **Create** ->
   **Pages** -> connect the renamed GitHub repo, project name `viewflare`. Build output
   directory `public`, build command `npm run build:worker`.
3. **Re-attach the existing D1 database.** `viewflare` -> **Settings** -> **Functions** ->
   **D1 database bindings** -> **Add binding**: variable name `DB`, database
   **`cflaircounter-db`** (the existing one - not a new database).
4. **Copy the environment variables across.** `ADMIN_PASSWORD`, `ENABLE_ADMIN`,
   `ENABLE_ANALYTICS`, `MAX_PROJECTS`, and `INSTALL_CACHE_TTL` if you set it. Read them off
   the old project's **Environment variables** page; `ADMIN_PASSWORD` must be entered as a
   secret, never committed to `wrangler.toml`.
5. **Set the compatibility date** on the new project (**Settings** -> **Runtime**) to match
   `wrangler.toml`. Dashboard-managed Pages projects take it from their own settings, not
   from the repo.
6. **Deploy and verify on the free subdomain before touching DNS.** Check
   `https://viewflare.pages.dev/health` and confirm a known count is correct, e.g.
   `https://viewflare.pages.dev/api/views/VKrishna04`. If the count reads 0, the D1 binding
   in step 3 is wrong - stop and fix it before continuing.
7. **Move the custom domain.** Only once step 6 passes: on the **old** `cflaircounter`
   project, **Custom domains** -> remove `counter.vkrishna04.me`. Then on `viewflare`,
   **Custom domains** -> **Set up a custom domain** -> `counter.vkrishna04.me`. There will
   be a short window where the hostname 404s; do this at a quiet time.
8. **Verify the public URL.** `https://counter.vkrishna04.me/health` and the profile badge
   `https://counter.vkrishna04.me/api/views/VKrishna04/badge` must both render. GitHub's
   camo proxy caches badge images, so allow time or append a cache-buster when checking.
9. **Retire the old project** only after a few days of the new one serving traffic.

### Things that keep the old name, permanently

| Thing | Why it cannot simply be renamed |
|---|---|
| D1 database `cflaircounter-db` | D1 has no rename API. Renaming means create + export + import, which risks the counts. The binding name (`DB`) is what the code uses, and that is unchanged. |
| `cflaircounter.pages.dev` | Dies with the old project. Nothing in this repo points at it any more, but check any external bookmarks. |
| Existing `project_views.project_name` keys | Written by the portfolio using repo names. Renaming them orphans recorded counts. |
| Old deployment preview URLs (`<hash>.cflaircounter.pages.dev`) | Immutable per-deployment hostnames. They expire with the old project. |
