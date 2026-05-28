# CFlair Counter — Comprehensive Upgrade Design
**Date:** 2026-05-28
**Status:** Approved

---

## Overview

CFlair Counter is a Cloudflare Pages + D1 + Hono.js serverless view counter with a vanilla-JS frontend. This upgrade covers four areas: backend API completeness, SVG badge quality, UI polish, and self-hosting/AI-friendliness.

---

## 1. Backend Changes (`functions/index.ts`)

### 1.1 New `PUT /api/admin/projects/:projectName` endpoint

**Purpose:** Full project update — rename, redescribe, and set exact view/unique counts.

**Auth:** `password` in request body (same pattern as `POST /api/admin/stats`).

**Request body:**
```json
{
  "password": "string",
  "newName": "string (optional — renames the project)",
  "description": "string (optional)",
  "viewCount": 0,
  "uniqueViews": 0
}
```

**Behavior:**
- If `newName` is provided and differs from `:projectName`: insert new row copying all data, update with new values, delete old row, move `visitor_tracking` rows to new project name.
- If only description/counts change: UPDATE in place.
- Returns the updated project row.

**Validation:**
- Project name regex: `^[a-zA-Z0-9-_]+$`, max 100 chars
- `viewCount` and `uniqueViews` must be non-negative integers
- `password` must match `ADMIN_PASSWORD` env var

### 1.2 CORS simplification

Replace the allowedOrigins array + conditional logic with `origin: "*"` always. Self-hosted instances on any domain already receive `*` via the fallback — this makes that explicit and removes misleading dead code.

### 1.3 SVG badge text width fix

Replace `rawLabel.length * 6.5 + 10` with a Verdana per-character width lookup table (characters below 128, fallback 7px for others). This prevents text overflow and clipping for labels like `downloads` vs `i`.

The lookup uses approximate pixel widths at font-size 11px in Verdana, derived from standard font metrics. Add a `verdanaWidth(s: string): number` helper function used for both label and value width calculation.

---

## 2. Admin Panel UI (`public/index.html`)

### 2.1 Edit modal — all fields enabled when editing

Currently `project-name`, `project-views`, `project-unique` are disabled during edit. Remove these disabled states. The modal shows all four fields as editable: name, description, view_count, unique_views.

### 2.2 `editProject()` — store original name for rename detection

Set `data-original-name` attribute on `#project-name` input when opening edit modal so `saveProject()` can detect a rename.

### 2.3 `saveProject()` — calls new PUT endpoint

When `currentEditProject` is set:
1. Read all four field values
2. Detect if name changed (compare to `data-original-name`)
3. POST to `PUT /api/admin/projects/:originalName` with full body
4. On success: close modal, refresh admin data, show notification

Remove the "Direct count updates not yet supported" warning code entirely.

---

## 3. UI Polish

### 3.1 Existing pages

- `.card`: add subtle `border-top: 3px solid transparent` that becomes `border-top-color: var(--primary)` on hover (CSS transition)
- `.code-block`: add a "Copy" button in the top-right corner that calls `copyToClipboard(text)`
- Admin projects table: clicking a column header (Project Name, Views, Unique, Updated) sorts the table client-side
- Badge generator Demo page: when "Generate Badge" is clicked, render all 3 styles simultaneously in a grid (flat / flat-square / for-the-badge) each with their own copy-URL button

### 3.2 Responsive nav

On mobile (`< 768px`): collapse nav links into a hamburger menu or wrap to two rows cleanly (the current flex layout breaks on small screens).

---

## 4. New "Setup" Page

A fifth nav item "⚙️ Setup" linking to a new `#setup-page` div.

**Content — wizard card stack:**

Each card is a numbered step:

1. **Fork & Clone** — copy-paste `git clone` + `cd` commands
2. **Install deps** — `npm install`
3. **Create D1 database** — `wrangler d1 create cflaircounter-db` + note to paste the `database_id` into `wrangler.toml`
4. **Configure `wrangler.toml`** — highlight the `database_id` and `ADMIN_PASSWORD` fields with a code block that uses `window.location.origin` placeholder text
5. **Initialize schema** — `npm run db:init`
6. **Deploy** — `npm run deploy`
7. **Add custom domain (optional)** — Cloudflare dashboard path + DNS instructions for both Cloudflare-managed and external DNS

**Auto-fill current origin:** All code examples in the Setup page use `window.location.origin` (injected by JS on page load) so fork users see their own domain in examples, not `counter.vkrishna04.me`.

**"Test your deployment" card at bottom:** A button that fetches `/health` and shows green/red status with latency in ms.

---

## 5. AI / Agent Integration Section (Docs page)

New card in the Docs page: **"🤖 AI & Agent Integration"**

Content:
- Explanation that the API is stateless and REST-ful with no auth required for tracking/reading
- GitHub Actions workflow snippet (POST on push)
- MCP tool definition snippet (for Claude Code / other MCP hosts)
- OpenAPI-style endpoint summary table (method, path, auth, description)
- Link to `/.well-known/api-info.json`

**New static file `public/.well-known/api-info.json`:**
```json
{
  "name": "CFlair Counter API",
  "version": "2.0.0",
  "baseUrl": "auto-detected from origin",
  "endpoints": [
    { "method": "POST", "path": "/api/views/{project}", "auth": "none", "description": "Increment view count" },
    { "method": "GET",  "path": "/api/views/{project}", "auth": "none", "description": "Get view stats" },
    { "method": "GET",  "path": "/api/views/{project}/badge", "auth": "none", "description": "SVG badge" },
    { "method": "GET",  "path": "/api/stats",           "auth": "none", "description": "Global stats" },
    { "method": "GET",  "path": "/health",              "auth": "none", "description": "Health check" },
    { "method": "POST", "path": "/api/admin/stats",     "auth": "password-in-body", "description": "Admin stats + projects list" },
    { "method": "PUT",  "path": "/api/admin/projects/{project}", "auth": "password-in-body", "description": "Update project" },
    { "method": "DELETE", "path": "/api/views/{project}", "auth": "bearer-token", "description": "Delete project" }
  ]
}
```

---

## 6. Architecture & Data Flow

No schema changes required. The `PUT /api/admin/projects/:projectName` endpoint touches `project_views` and `visitor_tracking` (for renames).

```
Browser → Hono worker (functions/index.ts) → D1 Database
                ↓
           public/index.html (static, served by Cloudflare Pages ASSETS)
```

All existing endpoints remain unchanged and backward-compatible.

---

## 7. Files Changed

| File | Change |
|------|--------|
| `functions/index.ts` | Add PUT endpoint, fix CORS, fix SVG width calc |
| `public/index.html` | Admin edit fix, UI polish, Setup page, AI docs section |
| `public/.well-known/api-info.json` | New static file |

---

## 8. Success Criteria

- Admin edit modal saves name/description/counts; API returns updated project; table refreshes
- SVG badges render without text overflow for labels of 1–24 chars
- Setup page shows correct origin URL when loaded from any domain
- All 3 badge styles render in Demo page badge generator
- Code blocks have copy buttons
- `/api/admin/projects/:name` PUT endpoint returns 200 with updated project
- `/.well-known/api-info.json` is served as valid JSON
