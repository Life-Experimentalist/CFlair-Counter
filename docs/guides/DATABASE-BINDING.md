# 🚀 Binding D1 Database to Cloudflare Pages

## ✅ Status: Database Created & Schema Initialized

Your D1 Database is ready:
- **Database ID:** `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Database Name:** `cflaircounter-db`
- **Tables Created:** ✅ project_views, visitor_tracking, usage_stats

---

## 📋 Next Steps: Bind Database to Pages

### Method 1: Cloudflare Dashboard (Recommended)

1. **Go to Cloudflare Dashboard:**
   ```
   https://dash.cloudflare.com
   ```

2. **Navigate to Pages:**
   ```
   Workers & Pages → cflaircounter → Settings → Functions
   ```

3. **Scroll to "D1 database bindings"**

4. **Add Binding:**
   - Click **"Add binding"**
   - **Variable name:** `DB` (must match your code!)
   - **D1 database:** Select `cflaircounter-db` from dropdown
   - Click **"Save"**

5. **Redeploy:**
   - Go to **Deployments** tab
   - Click **"Retry deployment"** on the latest deployment
   - OR push a new commit to trigger auto-deploy

---

### Method 2: Wrangler CLI (Alternative)

The binding is already in your `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cflaircounter-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

To deploy with this configuration:

```powershell
# Deploy via Git (recommended for Pages)
git add .
git commit -m "Add D1 database binding"
git push origin main

# OR deploy directly
npx wrangler pages deploy public --project-name=cflaircounter
```

---

## 🔐 Set Environment Variables

After binding the database, set your environment variables:

1. **Go to Pages Settings:**
   ```
   Workers & Pages → cflaircounter → Settings → Environment variables
   ```

2. **Add these variables for Production:**

   | Variable           | Value                    | Notes                 |
   | ------------------ | ------------------------ | --------------------- |
   | `ADMIN_PASSWORD`   | `YourSecurePassword123!` | **CHANGE THIS!**      |
   | `ENABLE_ADMIN`     | `true`                   | Enable admin panel    |
   | `ENABLE_ANALYTICS` | `false`                  | Disable to save costs |
   | `MAX_PROJECTS`     | `100`                    | Max projects to track |

3. **Click "Save" after adding each variable**

4. **Redeploy** (required for env vars to take effect)

---

## ✅ Verification Steps

### 1. Test Health Endpoint

```powershell
# Test your deployment
curl https://cflaircounter.pages.dev/health

# Expected response:
# {
#   "success": true,
#   "status": "ok",
#   "timestamp": "2025-11-09T...",
#   "worker": "cflaircounter-api",
#   "version": "2.0.0"
# }
```

### 2. Test View Tracking

```powershell
# Track a test view
curl -X POST https://cflaircounter.pages.dev/api/views/test-project

# Expected response:
# {
#   "success": true,
#   "projectName": "test-project",
#   "totalViews": 1,
#   "uniqueViews": 0,
#   "timestamp": "2025-11-09T..."
# }
```

### 3. Test Badge Generation

```powershell
# Get badge
curl https://cflaircounter.pages.dev/api/views/test-project/badge -o test-badge.svg

# Open test-badge.svg to see the badge
```

### 4. Test Admin Panel

```powershell
# Open in browser
start https://cflaircounter.pages.dev

# Click "Admin" button and enter password
# You should see the dashboard with statistics
```

---

## 🌐 Custom Domain Setup

After everything works, set up your custom domain:

1. **Go to Pages:**
   ```
   Workers & Pages → cflaircounter → Custom domains
   ```

2. **Add Custom Domain:**
   - Click **"Set up a custom domain"**
   - Enter: `counter.vkrishna04.me`
   - Click **"Continue"**
   - Cloudflare will automatically configure DNS
   - Wait 5-10 minutes for SSL certificate

3. **Verify:**
   ```powershell
   curl https://counter.vkrishna04.me/health
   ```

---

## 🐛 Troubleshooting

### Issue: "Database not found" error

**Solution:**
1. Verify binding in Dashboard: Settings → Functions → D1 database bindings
2. Make sure variable name is exactly `DB` (case-sensitive)
3. Redeploy after adding binding

### Issue: Environment variables not working

**Solution:**
1. Check Dashboard: Settings → Environment variables
2. Ensure they're set for **Production** environment
3. Redeploy after changing variables

### Issue: Functions not deploying

**Solution:**
```powershell
# Ensure functions directory has correct structure
# Should be: functions/[[path]].ts

# Check file exists
ls functions

# Redeploy
npx wrangler pages deploy public --project-name=cflaircounter
```

---

## 📊 Database Queries (Optional)

Check your database status:

```powershell
# List all projects
npx wrangler d1 execute cflaircounter-db --command "SELECT * FROM project_views" --remote

# Check usage stats
npx wrangler d1 execute cflaircounter-db --command "SELECT * FROM usage_stats" --remote

# Count total views
npx wrangler d1 execute cflaircounter-db --command "SELECT SUM(view_count) as total FROM project_views" --remote
```

---

## ✅ Completion Checklist

- [x] D1 Database created (ID: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- [x] Schema initialized (tables created)
- [x] `wrangler.toml` configured with Database ID
- [ ] **D1 binding added in Cloudflare Dashboard** ← YOU ARE HERE
- [ ] Environment variables set (ADMIN_PASSWORD, etc.)
- [ ] Deployment tested (health check passes)
- [ ] Custom domain configured (counter.vkrishna04.me)
- [ ] Admin panel accessible

---

## 🎉 You're Almost Done!

**Current Status:** Database is ready, just need to bind it in Dashboard!

**Next Steps:**
1. Go to Cloudflare Dashboard
2. Pages → cflaircounter → Settings → Functions
3. Add D1 binding: Variable name `DB`, Database `cflaircounter-db`
4. Redeploy
5. Test endpoints
6. Set environment variables
7. Configure custom domain

**Need Help?** See the main [SETUP.md](./SETUP.md) or [DEPLOYMENT.md](./DEPLOYMENT.md) guide.

---

**Questions?** Let me know if you need help with any step!
