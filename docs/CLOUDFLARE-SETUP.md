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

## 🚚 The rename, and why Cloudflare is not part of it

**There is no Cloudflare migration.** ViewFlare is the product name. `cflaircounter` is
the Pages project name, and it stays.

Cloudflare Pages has no rename operation — `wrangler pages project` offers only `list`,
`create` and `delete`, and the dashboard has no rename either. Changing `name` in
`wrangler.toml` does not rename a project; it targets a *different* one, so the next
`wrangler pages deploy` would create a brand-new empty project and leave the live one
serving traffic. That is a migration, not a rename, and it would put every recorded view
count at risk for no benefit.

The benefit is nil because **the project name is not a public surface**. Visitors, the
portfolio and the profile badge all reach the service at `counter.vkrishna04.me`, plus the
`me.krishnagsvv.workers.dev` mirror, which points at the same counter. Neither hostname
contains the project name. Nobody outside the Cloudflare dashboard can tell what it is
called.

So the rename is a GitHub and branding change only:

| Renamed | Left alone |
|---|---|
| The GitHub repository, `CFlair-Counter` → `ViewFlare` | The Pages project, `cflaircounter` |
| README, docs, package name, Postman collections | The D1 database, `cflaircounter-db` |
| `.portfolio/project.json` | `counter.vkrishna04.me` and the workers.dev mirror |
| The display name everywhere a human reads it | `project_views.project_name` keys |

### Order of operations

Done as of commit `28e7aa6`. Kept here because it explains why the Cloudflare
names still say `cflaircounter`.

1. **Rename the GitHub repository first** (`CFlair-Counter` → `ViewFlare`), *before*
   pushing. The README badge and `.portfolio/project.json` already point at
   `Life-Experimentalist/ViewFlare`. GitHub redirects an old name to a new one and never
   the reverse, so if these commits land while the repo is still `CFlair-Counter`, both
   links 404 until the rename happens.
2. **Push.**
3. **Nothing on Cloudflare.** The existing project keeps deploying from the renamed repo —
   GitHub's redirect keeps the Pages build connection working. Confirm the next deploy is
   green and `https://counter.vkrishna04.me/health` still answers.

### If you ever do want the project renamed

It is a create-and-move, and it is only worth it if you have a reason beyond tidiness.
Create a new `viewflare` project, bind the **existing** `cflaircounter-db` (never a new
database — that starts the counts at zero), copy the environment variables across with
`ADMIN_PASSWORD` entered as a secret, verify a known count on `viewflare.pages.dev`, and
only then move `counter.vkrishna04.me` across. There is a window where the hostname 404s.
