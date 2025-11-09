# 🚀 Quick Start Guide - Get Live in 5 Minutes!

## Current Deployment Status

✅ **Deployed!** https://8791d576.cflaircounter.pages.dev
❌ **Database Not Bound** - Needs manual configuration

---

## 🔥 Final Steps to Make It Work

### Step 1: Bind D1 Database (REQUIRED)

1. **Go to Cloudflare Dashboard:**
   ```
   https://dash.cloudflare.com
   ```

2. **Navigate to Your Pages Project:**
   ```
   Workers & Pages → cflaircounter → Settings → Functions
   ```

3. **Add D1 Database Binding:**
   - Scroll down to **"D1 database bindings"**
   - Click **"Add binding"**
   - **Variable name:** `DB` (must be exactly this!)
   - **D1 database:** Select `cflaircounter-db` from dropdown
   - Click **"Save"**

### Step 2: Set Environment Variables

1. **Go to Environment Variables:**
   ```
   Workers & Pages → cflaircounter → Settings → Environment variables
   ```

2. **Add These Variables for Production:**

   | Variable              | Value                    | Description                               |
   | --------------------- | ------------------------ | ----------------------------------------- |
   | `ADMIN_PASSWORD`      | `YourSecurePassword123!` | **CHANGE THIS!** Admin dashboard password |
   | `ENABLE_ADMIN`        | `true`                   | Enable admin panel                        |
   | `ENABLE_ANALYTICS`    | `false`                  | Keep false to save DB queries             |
   | `RATE_LIMIT_REQUESTS` | `60`                     | Max 60 requests per minute per IP         |
   | `RATE_LIMIT_WINDOW`   | `60000`                  | 60 seconds window                         |

3. **Click "Add variable" for each one**

### Step 3: Redeploy

After adding the database binding and environment variables:

1. Go to **Deployments** tab
2. Click **"Retry deployment"** on the latest deployment
3. Wait for deployment to complete (~30 seconds)

---

## ✅ Test Your Deployment

### Test 1: Health Check
```powershell
# Should return 200 OK with JSON
Invoke-WebRequest -Uri "https://8791d576.cflaircounter.pages.dev/health" | Select-Object -ExpandProperty Content
```

**Expected Response:**
```json
{
  "success": true,
  "status": "ok",
  "timestamp": "2025-11-09T...",
  "worker": "cflaircounter-api",
  "version": "2.1.0-rate-limited"
}
```

### Test 2: Track a View (Webhook)
```powershell
# Track a view for "my-project"
$response = Invoke-WebRequest -Method POST -Uri "https://8791d576.cflaircounter.pages.dev/api/views/my-project"
$response.Content
```

**Expected Response:**
```json
{
  "success": true,
  "projectName": "my-project",
  "totalViews": 1,
  "uniqueViews": 0,
  "timestamp": "2025-11-09T..."
}
```

### Test 3: Get Badge
```powershell
# Save badge as SVG
Invoke-WebRequest -Uri "https://8791d576.cflaircounter.pages.dev/api/views/my-project/badge" -OutFile "badge.svg"

# Or open in browser:
start "https://8791d576.cflaircounter.pages.dev/api/views/my-project/badge?style=flat-square&color=brightgreen"
```

### Test 4: Test Rate Limiting
```powershell
# Send 65 requests quickly - should hit rate limit
1..65 | ForEach-Object {
    try {
        $response = Invoke-WebRequest -Method POST -Uri "https://8791d576.cflaircounter.pages.dev/api/views/rate-test" -ErrorAction Stop
        Write-Host "Request $_`: OK" -ForegroundColor Green
    } catch {
        Write-Host "Request $_`: RATE LIMITED" -ForegroundColor Red
        Write-Host $_.Exception.Message
    }
}
```

**Expected:** First 60 requests succeed, then 429 rate limit errors

### Test 5: Admin Dashboard
```powershell
# Open admin dashboard
start "https://8791d576.cflaircounter.pages.dev"

# Click "Admin" button
# Enter your ADMIN_PASSWORD
# Should see statistics dashboard
```

---

## 🎯 Integration Examples

### Simple HTML Webhook (Fire-and-Forget)
```html
<script>
// Track page view
fetch('https://8791d576.cflaircounter.pages.dev/api/views/my-awesome-site', {
    method: 'POST',
    mode: 'no-cors'
}).catch(() => {});

// Display badge
</script>
<img src="https://8791d576.cflaircounter.pages.dev/api/views/my-awesome-site/badge" alt="Views">
```

### GitHub README Badge
```markdown
![Views](https://8791d576.cflaircounter.pages.dev/api/views/github-username-repo/badge?style=flat-square&color=brightgreen&label=visitors)
```

### AI Agent Integration
```javascript
// Track when AI processes a request
async function trackAIUsage(agentName) {
    const response = await fetch(
        `https://8791d576.cflaircounter.pages.dev/api/views/ai-agent-${agentName}`,
        { method: 'POST' }
    );
    const data = await response.json();
    console.log(`Agent ${agentName} usage: ${data.totalViews} calls`);
}

trackAIUsage('gpt-4');
```

---

## 🐛 Troubleshooting

### Error: "Database error"

**Problem:** D1 database not bound

**Solution:**
1. Go to Dashboard → Pages → Settings → Functions
2. Add D1 binding: Variable `DB`, Database `cflaircounter-db`
3. Redeploy

### Error: "405 Method Not Allowed"

**Problem:** Endpoint doesn't exist or wrong method

**Solution:**
- Check you're using POST for `/api/views/:project`
- Check you're using GET for `/api/views/:project` (stats)
- Admin endpoint is POST to `/api/admin/stats` with password in body

### Error: "Unauthorized - Invalid admin password"

**Problem:** ADMIN_PASSWORD not set or incorrect

**Solution:**
1. Go to Dashboard → Pages → Settings → Environment variables
2. Add `ADMIN_PASSWORD` for Production
3. Redeploy

### Error: "Rate limit exceeded"

**Problem:** Too many requests (this is working as designed!)

**Solution:**
- Wait 60 seconds for rate limit to reset
- Check `X-RateLimit-Reset` header for exact reset time
- Increase `RATE_LIMIT_REQUESTS` if needed

---

## 📊 Badge Styles

### Flat (Default)
```
?style=flat&color=blue&label=views
```
![Example](https://img.shields.io/badge/views-1234-blue)

### Flat Square
```
?style=flat-square&color=brightgreen&label=downloads
```
![Example](https://img.shields.io/badge/downloads-5678-brightgreen?style=flat-square)

### For The Badge (Bold)
```
?style=for-the-badge&color=red&label=hits
```
![Example](https://img.shields.io/badge/hits-9999-red?style=for-the-badge)

### Colors Available
- `blue` (default)
- `brightgreen`
- `green`
- `yellow`
- `orange`
- `red`
- `success`
- `important`
- `critical`

---

## 🎉 You're Almost There!

After completing Steps 1-3 above, your counter will be fully functional and ready to use!

**Current Status:**
- ✅ Code deployed
- ✅ Functions compiled
- ✅ Rate limiting active
- ✅ Health endpoint working
- ❌ **D1 database needs binding** ← Do this now!
- ❌ **Environment variables need setting** ← Do this now!

---

## 📞 Need Help?

1. Check full documentation: `./SETUP.md`
2. API reference: `./docs/api/README.md`
3. Integration examples: `./docs/guides/INTEGRATION.md`
4. Testing guide: `./TESTING.md`
5. Database binding guide: `./DATABASE-BINDING.md`

---

**Database ID for reference:**
```
xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Current Deployment URL:**
```
https://8791d576.cflaircounter.pages.dev
```

Go bind that database and you're live! 🚀
