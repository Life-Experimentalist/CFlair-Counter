# Quick Reference - CFlairCounter Development

## 🚀 Common Commands

### Deploy to Production
```bash
npm run deploy
```
This automatically:
1. Bundles `functions/index.ts` → `public/_worker.js`
2. Deploys to Cloudflare Pages
3. Makes live at https://counter.vkrishna04.me

### Local Development (D1 Binding Issue Known)
```bash
npm run dev
```
**Note**: There's a known issue where D1 is bound but admin panel doesn't show projects locally. Use preview deployments for testing instead.

### Build Worker Only
```bash
npm run build:worker
```

## 📁 Key Files

### Backend
- `functions/index.ts` - Complete Hono API app with all routes
- `public/_worker.js` - Auto-generated bundle (in .gitignore)

### Frontend
- `public/index.html` - Main app with dark mode and stats display
- `public/logo.png` - Light mode logo
- `public/logo-dark.png` - Dark mode logo (user needs to add)

### Configuration
- `wrangler.toml` - Cloudflare configuration
- `package.json` - Build scripts and dependencies
- `.gitignore` - Excludes `public/_worker.js`

## 🔧 Making Changes

### Adding New API Routes
1. Edit `functions/index.ts`
2. Add route: `app.get("/api/your-route", async (c) => { ... })`
3. Run `npm run deploy`

### Updating Frontend
1. Edit `public/index.html`
2. Run `npm run deploy`

### Database Changes
```bash
# Edit schema.sql first, then:
npm run db:migrate
```

## 🐛 Debugging

### Check API Endpoints
```powershell
# Health check
Invoke-WebRequest "https://counter.vkrishna04.me/health" -UseBasicParsing

# Stats
Invoke-WebRequest "https://counter.vkrishna04.me/api/stats" -UseBasicParsing
```

### View Worker Logs
Check Cloudflare Dashboard → Pages → cflaircounter → Functions → Logs

### Test Changes Before Production
Every deployment creates a preview URL:
```
https://[hash].cflaircounter.pages.dev
```
Test there first!

## 📊 API Endpoints

### GET /health
Health check endpoint
```json
{"success": true, "status": "ok", "timestamp": "..."}
```

### GET /api/stats
Global statistics
```json
{
  "success": true,
  "statistics": {
    "totalViews": 9,
    "uniqueViews": 0,
    "totalProjects": 6,
    "analyticsEnabled": false
  }
}
```

### GET /api/views/:project
Get project stats
```json
{"success": true, "projectName": "...", "totalViews": 5, ...}
```

### POST /api/views/:project
Increment view count (returns same as GET)

### GET /api/views/:project/badge
SVG badge (shield.io style)
```
?color=blue&label=views&style=flat
```

### POST /api/admin/stats
Admin panel data (requires password)
```json
{"password": "your-admin-password"}
```

## 🎨 UI Customization

### Changing Colors
Edit `public/index.html`:
- Light mode gradient: `--bg-gradient-start`, `--bg-gradient-end`
- Dark mode: `--dark-bg`, `--dark-card-bg`
- Primary color: `--primary`

### Adding Features
Look for the "Key Features" section in `index.html` around line 200-400

### Modifying Toggle Size
Search for `.switch__label` in `<style>` section (currently 75px × 38px)

## ⚠️ Known Issues

### Local Dev D1 Binding
**Symptom**: Admin panel shows no projects in `npm run dev`
**Status**: Deferred (production works fine)
**Workaround**: Use preview deployments for testing

## 🏗️ Architecture

```
Browser Request → Cloudflare Pages
                      ↓
                  _worker.js (Hono App)
                      ↓
              Route Matching (Hono)
                      ↓
              D1 Database Query
                      ↓
              JSON Response
```

## 📈 Monitoring

- Cloudflare Dashboard: Real-time analytics
- Logs: Functions → View Logs
- Errors: Check browser console on production site

## 🔐 Environment Variables

Set in Cloudflare Dashboard → Pages → Settings → Environment variables:

- `ADMIN_PASSWORD` - Admin panel password
- `ENABLE_ADMIN` - "true" or "false"
- `ENABLE_ANALYTICS` - "true" or "false" (detailed tracking)
- `MAX_PROJECTS` - Maximum projects (default: 100)

## 📚 Documentation

- `PRODUCTION-STATUS.md` - Current production status
- `docs/TROUBLESHOOTING.md` - Comprehensive troubleshooting
- `docs/DEPLOYMENT.md` - Deployment guide
- `docs/ARCHITECTURE.md` - System architecture
- `README.md` - Main documentation

## 💡 Tips

1. **Always test with preview URLs** before promoting to production domain
2. **The _worker.js is auto-generated** - never edit it directly
3. **D1 queries are optimized** - minimal reads/writes to stay in free tier
4. **Admin password** set via Cloudflare Dashboard (not in code)
5. **Dark mode logo** needs to be added by user (logo-dark.png)

---

**Need Help?** Check `docs/TROUBLESHOOTING.md` or `PRODUCTION-STATUS.md`
