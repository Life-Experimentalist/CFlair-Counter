# 📮 Postman Collection Guide

Complete guide for testing the CFlair Counter API using Postman.

---

## 🚀 Quick Start

### 1. Import Collection

**Option A: Import from File**
1. Open Postman
2. Click **Import** button (top left)
3. Select **File** tab
4. Choose `postman-collection.json` from the project root
5. Click **Import**

**Option B: Import from URL** (if hosted on GitHub)
```
https://raw.githubusercontent.com/Life-Experimentalists/CFlair-Counter/main/postman-collection.json
```

### 2. Configure Variables

After importing, configure the collection variables:

1. Click on the **CFlair Counter API** collection
2. Go to the **Variables** tab
3. Update the following variables:

| Variable | Default Value | Description |
|----------|---------------|-------------|
| `baseUrl` | `https://counter.vkrishna04.me` | Your API domain |
| `projectName` | `test-project` | Project identifier for testing |
| `adminPassword` | *(empty)* | Your admin password (set this!) |

#### Available Domains

You can use any of these domains for `baseUrl`:

- **Custom Domain**: `https://counter.vkrishna04.me`
- **Primary Domain**: `https://cflaircounter.pages.dev`
- **Specific Deployment**: `https://7918ecb1.cflaircounter.pages.dev`

Simply change the `baseUrl` variable to switch between domains!

### 3. Set Admin Password

⚠️ **Important:** To use admin endpoints, you must:

1. **Set the password in Cloudflare Dashboard:**
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - Navigate to **Workers & Pages** → **cflaircounter**
   - Go to **Settings** → **Environment variables**
   - Add `ADMIN_PASSWORD` for Production environment

2. **Update the Postman variable:**
   - Set the `adminPassword` collection variable to match

---

## 📁 Collection Structure

The collection is organized into 6 folders:

### 1. Health & Monitoring
- **Health Check** - Verify API is running
- **Root Path** - Access admin dashboard HTML

### 2. View Tracking
- **Track View (POST)** - Main webhook endpoint
- **Track View with Description** - Add project description
- **Track View - Different Project** - Multiple project example

### 3. Statistics
- **Get Project Statistics** - Retrieve view counts
- **Get Non-existent Project** - Test graceful handling

### 4. Badge Generation
- **Generate Badge (Default)** - Default style
- **Badge - Flat Style Blue** - Flat style with blue color
- **Badge - Flat Square Green** - Square style with green
- **Badge - For The Badge Yellow** - Large bold style
- **Badge - Red (High Views)** - Red color option
- **Badge - Custom Hex Color** - Custom hex colors

### 5. Admin
- **Get All Projects Stats (Admin)** - View all projects (requires password)
- **Admin Stats - Wrong Password** - Test authentication

### 6. Rate Limiting
- **Single Request (Check Headers)** - Check rate limit headers
- **Rapid Requests Test** - Test rate limit enforcement

---

## 🧪 Running Tests

### Individual Request

1. Select a request from the collection
2. Click **Send**
3. View response in the **Body** tab
4. Check test results in the **Test Results** tab

### Run Entire Collection

1. Click the **...** menu on the collection
2. Select **Run collection**
3. Choose which folders to run
4. Set iterations (usually 1)
5. Click **Run CFlair Counter API**

### Automated Tests

All requests include automated tests that verify:
- ✅ Status codes (200, 401, 429)
- ✅ Response structure
- ✅ Required fields
- ✅ Rate limit headers
- ✅ Data types

Test results appear in the **Test Results** tab after each request.

---

## 📊 Example Workflows

### Workflow 1: Track and Monitor Views

```
1. Track View (POST) → Creates/increments view count
2. Get Project Statistics → Verify count increased
3. Generate Badge (Default) → See badge with new count
```

### Workflow 2: Test Badge Styles

```
1. Badge - Flat Style Blue → Default GitHub style
2. Badge - Flat Square Green → Square edges
3. Badge - For The Badge Yellow → Large bold style
```

### Workflow 3: Admin Dashboard

```
1. Set adminPassword variable
2. Get All Projects Stats (Admin) → View all projects
3. Check response for totalProjects and totalViews
```

### Workflow 4: Rate Limit Testing

```
1. Single Request (Check Headers) → Note remaining count
2. Open Collection Runner
3. Run "Rapid Requests Test" with 70 iterations
4. Observe 429 errors after 60 requests
```

---

## 🔧 Troubleshooting

### Issue: 404 Not Found

**Problem:** Request returns 404 error

**Solutions:**
- Verify `baseUrl` is correct (no trailing slash!)
- Check project name doesn't have spaces or special characters
- Ensure API is deployed and accessible

### Issue: 401 Unauthorized (Admin Endpoints)

**Problem:** Admin endpoint returns 401

**Solutions:**
- Verify `adminPassword` variable is set in Postman
- Confirm password is set in Cloudflare Dashboard
- Check password matches exactly (case-sensitive!)
- Wait a few seconds after setting password in Dashboard

### Issue: 429 Too Many Requests

**Problem:** Rate limit exceeded

**Solutions:**
- Wait 60 seconds for rate limit to reset
- Check `X-RateLimit-Reset` header for exact reset time
- Use `Retry-After` header to know when to retry
- For testing, use Collection Runner with delays

### Issue: Variables Not Working

**Problem:** `{{baseUrl}}` or `{{projectName}}` not replaced

**Solutions:**
- Click on collection → Variables tab
- Ensure "Current Value" is set (not just "Initial Value")
- Click **Save** after updating variables
- Close and reopen request if needed

---

## 📝 Request Examples

### Track a View

```http
POST https://counter.vkrishna04.me/api/views/my-project
```

**Response:**
```json
{
  "success": true,
  "projectName": "my-project",
  "totalViews": 1,
  "uniqueViews": 0,
  "timestamp": "2025-11-09T16:10:44.156Z"
}
```

### Get Statistics

```http
GET https://counter.vkrishna04.me/api/views/my-project
```

**Response:**
```json
{
  "success": true,
  "projectName": "my-project",
  "totalViews": 5,
  "uniqueViews": 0,
  "description": "My Awesome Project",
  "timestamp": "2025-11-09T16:10:44.156Z"
}
```

### Generate Badge

```http
GET https://counter.vkrishna04.me/api/views/my-project/badge?style=flat-square&color=brightgreen
```

**Response:** SVG image

**Use in Markdown:**
```markdown
![Views](https://counter.vkrishna04.me/api/views/my-project/badge?style=flat-square&color=brightgreen)
```

### Get Admin Stats

```http
POST https://counter.vkrishna04.me/api/admin/stats
Content-Type: application/json

{
  "password": "your-secure-password"
}
```

**Response:**
```json
{
  "success": true,
  "totalProjects": 5,
  "totalViews": 127,
  "projects": [
    {
      "project_name": "project-1",
      "view_count": 42,
      "unique_views": 0,
      "description": "Project Description",
      "created_at": "2025-11-09T16:00:00.000Z"
    }
  ],
  "timestamp": "2025-11-09T16:10:44.156Z"
}
```

---

## 🎨 Badge Style Reference

### Available Styles

| Style | Example | Use Case |
|-------|---------|----------|
| `flat` | Default GitHub style | General use, professional |
| `flat-square` | Square edges | Minimalist, modern |
| `for-the-badge` | Large bold text | Prominent, eye-catching |

### Available Colors

| Color Name | Hex Code | Use Case |
|------------|----------|----------|
| `brightgreen` | #44cc11 | Success, positive |
| `green` | #97ca00 | Good, stable |
| `yellowgreen` | #a4a61d | Warning-ish |
| `yellow` | #dfb317 | Caution |
| `orange` | #fe7d37 | Important |
| `red` | #e05d44 | Critical, urgent |
| `blue` | #007ec6 | Information, default |
| `lightgrey` | #9f9f9f | Inactive, neutral |

**Named Colors:**
- `success` → brightgreen
- `important` → orange
- `critical` → red
- `informational` → blue
- `inactive` → lightgrey

**Custom Hex:**
Use any hex color! Just URL encode the `#`:
```
?color=%23FF5733
```

---

## 🔍 Rate Limit Testing

### Understanding Rate Limits

- **Limit**: 60 requests per minute per IP
- **Window**: 60 seconds (60,000ms)
- **Scope**: Per IP address

### Headers

Every rate-limited request includes these headers:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1699545600000
```

### Testing with Collection Runner

1. Open **Collection Runner**
2. Select **Rapid Requests Test**
3. Configure:
   - Iterations: 70
   - Delay: 0ms
   - Data: None
4. Click **Run**

**Expected Results:**
- Requests 1-60: ✅ 200 OK
- Requests 61-70: ❌ 429 Too Many Requests

### 429 Response

When rate limit is exceeded:

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later."
}
```

Headers:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699545600000
```

---

## 🌍 Environment Setup

### Creating Environments

You can create multiple environments for different domains:

1. Click **Environments** (left sidebar)
2. Click **+** to create new environment
3. Name it (e.g., "Production", "Custom Domain")
4. Add variables:
   - `baseUrl` → Your domain
   - `projectName` → Test project
   - `adminPassword` → Your password

### Example Environments

**Production Environment:**
```
baseUrl: https://counter.vkrishna04.me
projectName: production-test
adminPassword: your-secure-password
```

**Pages.dev Environment:**
```
baseUrl: https://cflaircounter.pages.dev
projectName: pages-test
adminPassword: your-secure-password
```

**Local Development:**
```
baseUrl: http://localhost:8787
projectName: local-test
adminPassword: test-password
```

---

## 📚 Additional Resources

### Documentation
- [QUICK-START.md](QUICK-START.md) - 5-minute setup guide
- [API Reference](docs/api/README.md) - Complete API documentation
- [Integration Guide](docs/guides/INTEGRATION.md) - Integration examples
- [DEPLOYMENT-SUCCESS.md](DEPLOYMENT-SUCCESS.md) - Deployment status

### Live Endpoints
- **Health**: https://counter.vkrishna04.me/health
- **Dashboard**: https://counter.vkrishna04.me/
- **Example Badge**: https://counter.vkrishna04.me/api/views/test-project/badge

### Support
- GitHub Issues: [Report a bug](https://github.com/Life-Experimentalists/CFlair-Counter/issues)
- Documentation: Check the `docs/` directory
- Testing Guide: See [TESTING.md](TESTING.md)

---

## 🎯 Tips & Best Practices

### 1. Use Collection Variables
Always use `{{baseUrl}}` and `{{projectName}}` variables instead of hardcoding URLs. This makes it easy to:
- Switch between domains
- Test different projects
- Share collection with others

### 2. Check Test Results
After each request, check the **Test Results** tab to ensure:
- Status code is correct
- Response structure is valid
- All required fields are present

### 3. Monitor Rate Limits
Watch the `X-RateLimit-Remaining` header to avoid hitting rate limits:
- Add delays between requests in automation
- Use Collection Runner delays for bulk testing

### 4. Save Responses
Save successful responses as examples:
1. Send request
2. Click **Save Response**
3. Choose **Save as example**

This helps document expected responses.

### 5. Use Pre-request Scripts
Add custom logic before requests:
- Generate dynamic project names
- Set timestamps
- Calculate signatures

### 6. Organize with Folders
Keep requests organized:
- Group related endpoints
- Use descriptive names
- Add descriptions

---

## ✅ Checklist

Before running the collection:

- [ ] Collection imported successfully
- [ ] `baseUrl` variable set to correct domain
- [ ] `projectName` variable set
- [ ] `adminPassword` set in Cloudflare Dashboard
- [ ] `adminPassword` variable set in Postman
- [ ] Health endpoint responding (200 OK)
- [ ] All domains resolving correctly

---

**Last Updated**: 2025-11-09
**Collection Version**: 1.0.0
**API Version**: 2.1.0-rate-limited
