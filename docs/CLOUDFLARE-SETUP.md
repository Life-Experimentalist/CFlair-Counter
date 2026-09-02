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
   - **D1 database:** Select `cflaircounter-db` from the dropdown list.
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
