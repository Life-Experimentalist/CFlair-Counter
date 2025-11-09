# 🧪 Testing Your Deployment

## Quick Test Commands

### 1. Health Check
```powershell
# Test if your service is live
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

### 2. Track a View (Webhook Test)
```powershell
# Simple webhook test
curl -X POST https://cflaircounter.pages.dev/api/views/my-test-project

# Expected response:
# {
#   "success": true,
#   "projectName": "my-test-project",
#   "totalViews": 1,
#   "uniqueViews": 0,
#   "timestamp": "2025-11-09T..."
# }
```

### 3. Get View Count
```powershell
# Retrieve statistics
curl https://cflaircounter.pages.dev/api/views/my-test-project

# Expected response:
# {
#   "success": true,
#   "projectName": "my-test-project",
#   "totalViews": 1,
#   "uniqueViews": 0,
#   "description": null,
#   "createdAt": "2025-11-09T..."
# }
```

### 4. Generate Badge
```powershell
# Get SVG badge (default style)
curl https://cflaircounter.pages.dev/api/views/my-test-project/badge -o badge.svg

# Get flat-square style
curl "https://cflaircounter.pages.dev/api/views/my-test-project/badge?style=flat-square&color=brightgreen" -o badge-flat.svg

# Get for-the-badge style
curl "https://cflaircounter.pages.dev/api/views/my-test-project/badge?style=for-the-badge&color=blue&label=downloads" -o badge-bold.svg
```

### 5. Test Rate Limiting
```powershell
# Test rate limiting (send 65 requests quickly)
for ($i=1; $i -le 65; $i++) {
    $response = curl -X POST https://cflaircounter.pages.dev/api/views/rate-limit-test -s -w "\nStatus: %{http_code}\n"
    Write-Host "Request $i - $response"
    if ($i -gt 60) { Start-Sleep -Milliseconds 100 }
}

# You should see rate limit error after 60 requests:
# {
#   "success": false,
#   "error": "Rate limit exceeded",
#   "retryAfter": 58,
#   "message": "Too many requests. Please wait 58 seconds."
# }
```

---

## Badge Style Examples

### Flat Style (Default)
```markdown
![Views](https://cflaircounter.pages.dev/api/views/my-project/badge)
```
**URL Parameters:**
- `?style=flat` (default)
- `?color=blue` (default) - Options: blue, brightgreen, green, yellow, orange, red
- `?label=views` (default) - Custom text

### Flat-Square Style
```markdown
![Views](https://cflaircounter.pages.dev/api/views/my-project/badge?style=flat-square&color=brightgreen)
```

### For-The-Badge Style (Bold)
```markdown
![Views](https://cflaircounter.pages.dev/api/views/my-project/badge?style=for-the-badge&color=blue)
```

---

## Integration Examples

### HTML (Fire-and-Forget)
```html
<script>
// Track page view
fetch('https://cflaircounter.pages.dev/api/views/my-project', {
    method: 'POST',
    mode: 'no-cors' // Fire-and-forget
}).catch(() => {}); // Ignore errors

// Display badge
<img src="https://cflaircounter.pages.dev/api/views/my-project/badge" alt="Views">
</script>
```

### JavaScript/TypeScript
```javascript
// Track and get response
async function trackView(projectName) {
    try {
        const response = await fetch(
            `https://cflaircounter.pages.dev/api/views/${projectName}`,
            { method: 'POST' }
        );
        const data = await response.json();
        console.log(`Total views: ${data.totalViews}`);
        return data;
    } catch (error) {
        console.error('Failed to track view:', error);
    }
}

trackView('my-awesome-project');
```

### Python
```python
import requests

def track_view(project_name: str) -> dict:
    """Track a project view"""
    url = f"https://cflaircounter.pages.dev/api/views/{project_name}"
    try:
        response = requests.post(url, timeout=5)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error tracking view: {e}")
        return {}

# Usage
result = track_view("my-python-project")
print(f"Total views: {result.get('totalViews', 0)}")
```

### GitHub README.md
```markdown
# My Awesome Project

![Views](https://cflaircounter.pages.dev/api/views/my-awesome-project/badge?style=flat-square&color=brightgreen&label=visitors)
![GitHub Repo Views](https://cflaircounter.pages.dev/api/views/github-myusername-myrepo/badge?style=for-the-badge&color=blue)

<!-- The badge auto-updates as users visit your repo! -->
```

---

## Testing Admin Dashboard

### 1. Set Admin Password First
```powershell
# Via Cloudflare Dashboard:
# Workers & Pages → cflaircounter → Settings → Environment variables
# Add: ADMIN_PASSWORD = "YourSecurePassword123!"
# Then redeploy
```

### 2. Test Admin API
```powershell
# Get admin statistics (POST with password in body)
$body = @{
    password = "YourSecurePassword123!"
} | ConvertTo-Json

curl -X POST https://cflaircounter.pages.dev/api/admin/stats `
    -H "Content-Type: application/json" `
    -d $body

# Expected response:
# {
#   "success": true,
#   "statistics": {
#     "totalViews": 42,
#     "uniqueViews": 15,
#     "totalProjects": 3,
#     "uptime": "99.9%"
#   },
#   "projects": [...],
#   "timestamp": "2025-11-09T..."
# }
```

### 3. Access Admin Dashboard UI
```
1. Open: https://cflaircounter.pages.dev
2. Click "Admin" button in top-right
3. Enter your admin password
4. View statistics, projects, and analytics
```

---

## Common Issues & Solutions

### Issue: "Database not found" Error

**Solution:**
1. Bind D1 database in Dashboard:
   ```
   Workers & Pages → cflaircounter → Settings → Functions → D1 database bindings
   Variable name: DB
   Database: cflaircounter-db
   ```
2. Redeploy

### Issue: Rate Limit Headers Not Showing

**Solution:**
Check environment variables:
```powershell
# Should see:
# X-RateLimit-Limit: 60
# X-RateLimit-Remaining: 59
# X-RateLimit-Reset: 1699564800000

curl -I -X POST https://cflaircounter.pages.dev/api/views/test
```

### Issue: Badge Not Rendering

**Solution:**
```powershell
# Test badge endpoint directly
curl https://cflaircounter.pages.dev/api/views/test/badge -o test.svg

# Open test.svg to verify
# Should be valid SVG image
```

### Issue: Admin Password Not Working

**Solution:**
1. Password must be set in **Cloudflare Dashboard**, not wrangler.toml
2. Go to: Settings → Environment variables
3. Add `ADMIN_PASSWORD` for Production environment
4. **Redeploy** after adding

---

## Performance Testing

### Measure Response Times
```powershell
# Windows PowerShell
Measure-Command {
    curl https://cflaircounter.pages.dev/health
}

# Expected: < 100ms for health check
# Expected: < 300ms for webhook (with DB write)
```

### Load Testing (Optional)
```powershell
# Simple load test - 100 requests
$count = 100
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

for ($i=1; $i -le $count; $i++) {
    curl -X POST https://cflaircounter.pages.dev/api/views/load-test -s | Out-Null
}

$stopwatch.Stop()
$avgTime = $stopwatch.ElapsedMilliseconds / $count
Write-Host "Average response time: $avgTime ms"
```

---

## Monitoring

### Check Cloudflare Analytics
```
Dashboard → Workers & Pages → cflaircounter → Analytics

Monitor:
- Request count
- Error rate
- Response time
- Bandwidth usage
```

### Check D1 Database Size
```powershell
npx wrangler d1 execute cflaircounter-db --command "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();" --remote

# Keep under 500MB free tier limit
```

### Query Recent Views
```powershell
# Top 10 projects
npx wrangler d1 execute cflaircounter-db --command "SELECT project_name, view_count FROM project_views ORDER BY view_count DESC LIMIT 10" --remote

# Total views across all projects
npx wrangler d1 execute cflaircounter-db --command "SELECT SUM(view_count) as total_views FROM project_views" --remote
```

---

## Live Testing Checklist

- [ ] ✅ Health endpoint responds (200 OK)
- [ ] ✅ Webhook creates new project
- [ ] ✅ View counter increments correctly
- [ ] ✅ Badge generates SVG image
- [ ] ✅ Rate limiting works (429 after limit)
- [ ] ✅ Admin password authentication works
- [ ] ✅ Admin dashboard accessible
- [ ] ✅ CORS headers present
- [ ] ✅ Response time < 300ms
- [ ] ✅ Custom domain works (if configured)

---

## 🎉 All Tests Passed?

Congratulations! Your CFlair-Counter is live and ready to track views!

**Next Steps:**
1. Integrate webhook into your projects
2. Add badges to your README files
3. Share your deployment URL
4. Star the repo if you found this useful!

**Questions?** Open an issue or check the documentation:
- [Setup Guide](./SETUP.md)
- [API Documentation](./docs/api/README.md)
- [Integration Guide](./docs/guides/INTEGRATION.md)
