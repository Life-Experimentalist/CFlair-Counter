# Developer & Contributor Guide - ViewFlare

This guide covers everything you need to know to run, test, develop, and optimize **ViewFlare** locally and in production.

---

## 🚀 Development Commands

### Production Deployment
```bash
npm run deploy
```
This script automatically:
1. Bundles the worker backend: `functions/index.ts` → `public/_worker.js` (using `esbuild`)
2. Deploys static assets and functions to Cloudflare Pages.
3. Automatically maps to your custom domain (e.g., `https://counter.vkrishna04.me`).

### Local Development
```bash
npm run dev
```
Runs Wrangler Pages local dev server pointing to the `public/` folder.
*Note: Ensure you have initialized your local D1 database schema to test full D1 bindings locally.*

### Build Worker Only
```bash
npm run build:worker
```

### RunNewman API Tests
```bash
npm run test:newman
```
Runs Newman automated Postman tests to verify view counters, badge configurations, rate limits, and admin endpoints.

---

## 📁 Key File Structure

- [functions/index.ts](../functions/index.ts) - Complete worker backend using the Hono framework.
- [public/index.html](../public/index.html) - Premium landing page and admin panel.
- [schema.sql](../schema.sql) - D1 Database table structure.
- [wrangler.toml](../wrangler.toml) - Cloudflare configuration file.

---

## 🧪 Testing Your Deployment

Use these common `curl` commands (or equivalent PowerShell `Invoke-WebRequest`) to test system features:

### 1. Health Check
```bash
curl https://counter.vkrishna04.me/health
```

### 2. Track a View (Opt-in Auto-Increment)
```bash
curl -X POST https://counter.vkrishna04.me/api/views/test-project
```
*Note: To increment counts via badge loading, explicitly pass the `&inc=true` query parameter: `https://counter.vkrishna04.me/api/views/test-project/badge?inc=true`.*

### 3. Retrieve Stats
```bash
curl https://counter.vkrishna04.me/api/views/test-project
```

### 4. Test Rate Limiting (Sends 65 fast requests in PowerShell)
```powershell
for ($i=1; $i -le 65; $i++) {
    $response = curl -X POST https://counter.vkrishna04.me/api/views/rate-limit-test -s -w "\nStatus: %{http_code}\n"
    Write-Host "Request $i - $response"
    if ($i -gt 60) { Start-Sleep -Milliseconds 100 }
}
```

---

## 💰 Cloudflare Cost & Resource Efficiency

ViewFlare is hyper-optimized to operate completely inside Cloudflare's free tier quotas.

### Cost Analysis (Per 1 Million Webhook Hits):
- **Workers Requests**: Free (well within the 10M monthly free quota)
- **D1 Database Writes**: ~$1.00 - $3.00 (depending on analytics settings)
- **D1 Database Reads**: ~$0.00 - $0.10 (badge rendering utilizes intelligent, lightweight queries)

### Optimization Strategies Implemented:
- **Index Optimization:** Database indexes have been pruned to reduce write costs and D1 transaction logs.
- **Single-Query Increments:** The tracking endpoint uses a single query to track views (1 read + 1 write vs. multiple reads/writes).
- **Environment Toggles:** Turn off granular analytics entirely by setting `ENABLE_ANALYTICS=false` in your env variables, saving 50%+ on D1 write operations.

---

## 📈 Database Auditing & Sizes

Verify database sizes and query counts directly:

```bash
# Get D1 DB size (Free tier limit is 500MB)
npx wrangler d1 execute cflaircounter-db --command "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();" --remote

# List top 10 projects by view count
npx wrangler d1 execute cflaircounter-db --command "SELECT project_name, view_count FROM project_views ORDER BY view_count DESC LIMIT 10" --remote
```
