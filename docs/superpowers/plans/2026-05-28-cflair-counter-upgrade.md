# CFlair Counter Comprehensive Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix admin edit-count, improve SVG badge text sizing, simplify CORS, polish UI, add a self-hosting setup wizard, and add AI/agent-friendly documentation.

**Architecture:** All backend logic lives in `functions/index.ts` (Hono on Cloudflare Pages). The frontend is a single `public/index.html`. A new `public/.well-known/api-info.json` static file describes the API for AI discovery. No schema changes are needed.

**Tech Stack:** Hono 4.x, Cloudflare Pages, D1 (SQLite), esbuild, TypeScript, vanilla JS.

---

## File Map

| File | Role |
|------|------|
| `functions/index.ts` | Hono worker — add PUT endpoint, fix CORS, fix SVG widths |
| `public/index.html` | Frontend — fix admin modal, polish UI, add Setup page & AI docs |
| `public/.well-known/api-info.json` | New static file — machine-readable API description |

---

## Task 1: Fix SVG Badge Text Width (backend)

**Files:**
- Modify: `functions/index.ts` (lines ~370–531, badge endpoint)

### Step 1a — Add Verdana character-width lookup table

Open `functions/index.ts`. Add this lookup table and helper just **before** the `app.get("/api/views/:projectName/badge", ...)` handler (around line 370):

```typescript
// Approximate Verdana character widths at 11px (px values)
const VERDANA_11: Record<string, number> = {
  ' ': 3, '!': 4, '"': 5, '#': 7, '$': 6, '%': 8, '&': 8, "'": 3,
  '(': 4, ')': 4, '*': 6, '+': 7, ',': 4, '-': 4, '.': 4, '/': 5,
  '0': 6, '1': 6, '2': 6, '3': 6, '4': 6, '5': 6, '6': 6, '7': 6,
  '8': 6, '9': 6, ':': 4, ';': 4, '<': 7, '=': 7, '>': 7, '?': 5,
  '@': 9, 'A': 7, 'B': 7, 'C': 7, 'D': 7, 'E': 6, 'F': 6, 'G': 7,
  'H': 7, 'I': 3, 'J': 4, 'K': 7, 'L': 6, 'M': 8, 'N': 7, 'O': 8,
  'P': 6, 'Q': 8, 'R': 7, 'S': 6, 'T': 6, 'U': 7, 'V': 7, 'W': 9,
  'X': 7, 'Y': 6, 'Z': 7, '[': 4, '\\': 5, ']': 4, '^': 7, '_': 5,
  '`': 5, 'a': 6, 'b': 6, 'c': 5, 'd': 6, 'e': 6, 'f': 4, 'g': 6,
  'h': 6, 'i': 3, 'j': 3, 'k': 6, 'l': 3, 'm': 9, 'n': 6, 'o': 6,
  'p': 6, 'q': 6, 'r': 4, 's': 5, 't': 5, 'u': 6, 'v': 6, 'w': 8,
  'x': 6, 'y': 6, 'z': 5,
};

const verdanaWidth = (s: string): number => {
  let w = 0;
  for (const c of s) w += VERDANA_11[c] ?? 7;
  return w;
};
```

### Step 1b — Replace hardcoded width calculation in the badge handler

Find these two lines inside the badge handler (around line 423):
```typescript
const labelWidth = Math.max(rawLabel.length * 6.5 + 10, 40);
const valueWidth = Math.max(valueTextRaw.length * 7 + 10, 30);
```

Replace with:
```typescript
const labelWidth = Math.max(verdanaWidth(rawLabel) + 12, 40);
const valueWidth = Math.max(verdanaWidth(valueTextRaw) + 12, 30);
```

### Step 1c — Build and verify

```powershell
npm run build:worker
```

Expected: no TypeScript errors, `public/_worker.js` updated.

```powershell
npm run dev
```

Open `http://localhost:8788/api/views/test-project/badge` and `http://localhost:8788/api/views/test-project/badge?label=downloads&color=brightgreen` in browser. Text should be fully visible without clipping or overflow.

Also test a narrow label:
```
http://localhost:8788/api/views/x/badge?label=i
```

### Step 1d — Commit
```powershell
git add functions/index.ts
git commit -m "fix: use Verdana character-width table for accurate SVG badge sizing"
```

---

## Task 2: Simplify CORS (backend)

**Files:**
- Modify: `functions/index.ts` (lines ~131–159, CORS middleware)

### Step 2a — Replace the CORS origin function with a static wildcard

Find the current `cors()` call:
```typescript
app.use(
    "*",
    cors({
        origin: (origin) => {
            const allowedOrigins = [
                "https://cflaircounter.pages.dev",
                "https://counter.vkrishna04.me",
                "http://localhost:8788",
                "http://127.0.0.1:8788",
            ];
            return origin &&
                allowedOrigins.some((allowed) => origin.startsWith(allowed))
                ? origin
                : "*";
        },
        ...
    }),
);
```

Replace the `origin` field only (keep all other fields):
```typescript
app.use(
    "*",
    cors({
        origin: "*",
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: [
            "Content-Type",
            "Authorization",
            "X-Requested-With",
            "X-Admin-Password",
        ],
        maxAge: 86400,
        credentials: false,
    }),
);
```

Note: `PUT` is added to `allowMethods` for the new endpoint.

### Step 2b — Build and verify

```powershell
npm run build:worker
```

Expected: no errors.

### Step 2c — Commit
```powershell
git add functions/index.ts
git commit -m "fix: simplify CORS to allow all origins, add PUT to allowed methods"
```

---

## Task 3: Add PUT /api/admin/projects/:projectName Endpoint (backend)

**Files:**
- Modify: `functions/index.ts` (add after the DELETE endpoint, around line 848)

### Step 3a — Add the PUT endpoint

Insert this block **before** the `export default` at the bottom of `functions/index.ts`:

```typescript
// Admin: Update a project — rename, change description, set view/unique counts
app.put("/api/admin/projects/:projectName", async (c) => {
    const originalName = c.req.param("projectName");
    if (!originalName || originalName.length > 100) {
        return c.json({ error: "Invalid project name" }, 400);
    }

    try {
        const body = await c.req.json();
        const { password, newName, description, viewCount, uniqueViews } = body;

        const adminPassword = c.env.ADMIN_PASSWORD;
        const enableAdmin = c.env.ENABLE_ADMIN !== "false";

        if (!enableAdmin) {
            return c.json({ success: false, error: "Admin functionality is disabled" }, 403);
        }
        if (!password || password !== adminPassword) {
            return c.json({ success: false, error: "Unauthorized - Invalid admin password" }, 401);
        }

        const targetName: string = (newName || originalName).trim();
        if (!/^[a-zA-Z0-9-_]+$/.test(targetName) || targetName.length > 100) {
            return c.json({ error: "Invalid project name format" }, 400);
        }
        if (viewCount !== undefined && (!Number.isInteger(viewCount) || viewCount < 0)) {
            return c.json({ error: "viewCount must be a non-negative integer" }, 400);
        }
        if (uniqueViews !== undefined && (!Number.isInteger(uniqueViews) || uniqueViews < 0)) {
            return c.json({ error: "uniqueViews must be a non-negative integer" }, 400);
        }

        await initDatabase(c.env.DB);

        // Verify project exists
        const current = await c.env.DB.prepare(
            "SELECT project_name, view_count, unique_views, description, created_at FROM project_views WHERE project_name = ?"
        ).bind(originalName).first();

        if (!current) {
            return c.json({ success: false, error: "Project not found" }, 404);
        }

        const finalViews = viewCount !== undefined ? viewCount : Number(current.view_count);
        const finalUnique = uniqueViews !== undefined ? uniqueViews : Number(current.unique_views);
        const finalDesc = description !== undefined ? description : (current.description as string | null);

        if (targetName !== originalName) {
            // Rename: insert new row, migrate visitor_tracking, delete old
            await c.env.DB.prepare(
                `INSERT INTO project_views (project_name, view_count, unique_views, description, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
            ).bind(targetName, finalViews, finalUnique, finalDesc, current.created_at).run();

            await c.env.DB.prepare(
                "UPDATE visitor_tracking SET project_name = ? WHERE project_name = ?"
            ).bind(targetName, originalName).run();

            await c.env.DB.prepare(
                "DELETE FROM project_views WHERE project_name = ?"
            ).bind(originalName).run();
        } else {
            // Update in place
            await c.env.DB.prepare(
                `UPDATE project_views
                 SET view_count = ?, unique_views = ?, description = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE project_name = ?`
            ).bind(finalViews, finalUnique, finalDesc, originalName).run();
        }

        await trackUsage(c.env.DB);

        const updated = await c.env.DB.prepare(
            "SELECT project_name, view_count, unique_views, description, created_at, updated_at FROM project_views WHERE project_name = ?"
        ).bind(targetName).first();

        return c.json({
            success: true,
            projectName: updated?.project_name,
            totalViews: updated?.view_count,
            uniqueViews: updated?.unique_views,
            description: updated?.description,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error("Update project error:", error);
        return c.json({ success: false, error: "Failed to update project" }, 500);
    }
});
```

### Step 3b — Build
```powershell
npm run build:worker
```
Expected: no TypeScript errors.

### Step 3c — Test the new endpoint manually

```powershell
npm run dev
```

In a second terminal, create a test project and then update it:

```powershell
# Create test project
Invoke-WebRequest -Method POST -Uri "http://localhost:8788/api/views/test-edit" | Select-Object -ExpandProperty Content

# Update description and view count
$body = '{"password":"","description":"Updated desc","viewCount":42,"uniqueViews":10}'
Invoke-WebRequest -Method PUT -Uri "http://localhost:8788/api/admin/projects/test-edit" -Body $body -ContentType "application/json" | Select-Object -ExpandProperty Content
```

Expected response:
```json
{"success":true,"projectName":"test-edit","totalViews":42,"uniqueViews":10,"description":"Updated desc","timestamp":"..."}
```

Test rename:
```powershell
$body = '{"password":"","newName":"test-renamed","viewCount":42}'
Invoke-WebRequest -Method PUT -Uri "http://localhost:8788/api/admin/projects/test-edit" -Body $body -ContentType "application/json" | Select-Object -ExpandProperty Content
```

Expected: `"projectName":"test-renamed"` in response.

Test 401:
```powershell
$body = '{"password":"wrong"}'
Invoke-WebRequest -Method PUT -Uri "http://localhost:8788/api/admin/projects/test-renamed" -Body $body -ContentType "application/json" | Select-Object -ExpandProperty Content
```

Expected: `{"success":false,"error":"Unauthorized - Invalid admin password"}` with HTTP 401.

### Step 3d — Commit
```powershell
git add functions/index.ts
git commit -m "feat: add PUT /api/admin/projects/:name endpoint for full project updates"
```

---

## Task 3b: Add `escapeHtml` Helper to Frontend (XSS prevention)

**Files:**
- Modify: `public/index.html` (JavaScript section, near top of `<script>`)

### Step 3b-1 — Add helper function

Any content from API responses (project descriptions, names) that is injected via `innerHTML` must be escaped. Add this function near the top of the `<script>` block, just after the variable declarations:

```javascript
function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
```

### Step 3b-2 — Use `escapeHtml` in `generateProjectsTable()`

When the `generateProjectsTable` function is updated in Task 7, ensure every value from the API is escaped. The row template must use:

```javascript
const safeProjectName = escapeHtml(projectName);
const safeDescription = escapeHtml(description);
const safeUpdated = escapeHtml(updated);

html += `
    <tr>
        <td><strong>${safeProjectName}</strong></td>
        <td>${views.toLocaleString()}</td>
        <td>${unique.toLocaleString()}</td>
        <td>${safeDescription}</td>
        <td>${safeUpdated}</td>
        <td style="text-align: center; white-space: nowrap;">
            <button onclick="showBadgeLinks('${safeProjectName}')"
                class="btn btn-secondary"
                style="padding: 0.25rem 0.5rem; font-size: 0.85rem; margin: 0 0.25rem;"
                title="Get Badge &amp; Links">🎨</button>
            <button onclick="editProject('${safeProjectName}', ${views}, ${unique}, '${safeDescription.replace(/'/g, "\\'")}')"
                class="btn btn-secondary"
                style="padding: 0.25rem 0.5rem; font-size: 0.85rem; margin: 0 0.25rem;"
                title="Edit Project">✏️</button>
            <button onclick="incrementProjectViews('${safeProjectName}')"
                class="btn btn-secondary"
                style="padding: 0.25rem 0.5rem; font-size: 0.85rem; margin: 0 0.25rem;"
                title="Add View Count">➕</button>
            <button onclick="deleteProject('${safeProjectName}')"
                class="btn btn-secondary"
                style="padding: 0.25rem 0.5rem; font-size: 0.85rem; margin: 0 0.25rem; background: #dc3545;"
                title="Delete Project">🗑️</button>
        </td>
    </tr>
`;
```

Note: `views` and `unique` are numbers (from `Number()` coercion) and `updated` is a formatted date string — these are safe after `escapeHtml`. The `onclick` attribute uses the escaped name for display but `encodeURIComponent` handles URL-encoding in the actual API calls.

### Step 3b-3 — Use `escapeHtml` in `showBadgeLinks()`

The `showBadgeLinks` function builds HTML with `projectName` from the admin table. Since project names are already validated as `[a-zA-Z0-9-_]+` on the server, they are inherently safe. However, for defense-in-depth, wrap in `escapeHtml` where used in HTML attributes and text content within that function.

### Step 3b-4 — Commit
```powershell
git add public/index.html
git commit -m "fix: add escapeHtml helper to prevent XSS from API response content"
```

---

## Task 4: Fix Admin Edit Modal — Enable All Fields (frontend)

**Files:**
- Modify: `public/index.html` (JavaScript section, `editProject` and `showAddProjectModal` functions)

### Step 4a — Fix `editProject()` to enable all fields and track original name

Find the current `editProject` function (around line 2685) and replace it entirely:

```javascript
function editProject(name, views, unique, description) {
    currentEditProject = name;
    document.getElementById("project-modal-title").textContent = "✏️ Edit Project";
    const nameInput = document.getElementById("project-name");
    nameInput.value = name;
    nameInput.disabled = false;
    nameInput.dataset.originalName = name;
    document.getElementById("project-description").value =
        description === "—" ? "" : description;
    document.getElementById("project-views").value = views;
    document.getElementById("project-views").disabled = false;
    document.getElementById("project-unique").value = unique;
    document.getElementById("project-unique").disabled = false;
    document.getElementById("save-project-btn").textContent = "💾 Update Project";
    document.getElementById("project-modal").classList.add("active");
}
```

### Step 4b — Fix `showAddProjectModal()` to clear originalName

Find the current `showAddProjectModal` function (around line 2660) and add one line to clear `dataset.originalName`:

```javascript
function showAddProjectModal() {
    currentEditProject = null;
    document.getElementById("project-modal-title").textContent = "➕ Add New Project";
    const nameInput = document.getElementById("project-name");
    nameInput.value = "";
    nameInput.disabled = false;
    nameInput.dataset.originalName = "";
    document.getElementById("project-description").value = "";
    document.getElementById("project-views").value = "0";
    document.getElementById("project-views").disabled = false;
    document.getElementById("project-unique").value = "0";
    document.getElementById("project-unique").disabled = false;
    document.getElementById("save-project-btn").textContent = "💾 Save Project";
    document.getElementById("project-modal").classList.add("active");
}
```

### Step 4c — Verify visually

Open `http://localhost:8788`, click Admin, log in, click the edit button (✏️) on a project. All four fields — Project Name, Description, View Count, Unique Views — should now be editable.

---

## Task 5: Fix `saveProject()` to Call PUT Endpoint (frontend)

**Files:**
- Modify: `public/index.html` (JavaScript section, `saveProject` function)

### Step 5a — Replace `saveProject()` entirely

Find the current `saveProject` function (around line 2704) and replace it with:

```javascript
async function saveProject() {
    const nameInput = document.getElementById("project-name");
    const name = nameInput.value.trim();
    const description = document.getElementById("project-description").value.trim();
    const views = parseInt(document.getElementById("project-views").value) || 0;
    const unique = parseInt(document.getElementById("project-unique").value) || 0;

    if (!name) {
        showNotification("❌ Project name is required", "error");
        return;
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
        showNotification("❌ Invalid project name format", "error");
        return;
    }

    setLoading(true);

    try {
        if (currentEditProject) {
            const originalName = nameInput.dataset.originalName || currentEditProject;
            const body = {
                password: adminPassword,
                description: description || null,
                viewCount: views,
                uniqueViews: unique,
            };
            if (name !== originalName) body.newName = name;

            const response = await fetch(
                `${API_BASE}/api/admin/projects/${encodeURIComponent(originalName)}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                }
            );
            const data = await response.json();

            if (data.success) {
                showNotification(`✅ Project "${name}" updated!`, "success");
                hideProjectModal();
                refreshAdminData();
            } else {
                showNotification(`❌ ${data.error || "Failed to update project"}`, "error");
            }
        } else {
            const response = await fetch(
                `${API_BASE}/api/views/${encodeURIComponent(name)}`,
                { method: "POST" }
            );
            const data = await response.json();

            if (data.success) {
                showNotification(`✅ Project "${name}" created!`, "success");
                hideProjectModal();
                refreshAdminData();
            } else {
                showNotification("❌ Failed to create project", "error");
            }
        }
    } catch (error) {
        showNotification("❌ Error saving project", "error");
    } finally {
        setLoading(false);
    }
}
```

### Step 5b — Test edit flow

In browser at `http://localhost:8788`:
1. Open Admin → log in
2. Click ✏️ on a project
3. Change the description to something new
4. Change the view count to a specific number (e.g., 99)
5. Click "Update Project"
6. Table should refresh showing the new values

Test rename:
1. Click ✏️ on a project
2. Change the name field
3. Save — new name should appear in the table, old name gone

### Step 5c — Commit
```powershell
git add public/index.html
git commit -m "fix: admin edit modal now supports renaming and direct count updates via PUT endpoint"
```

---

## Task 6: UI Polish — Card Hover Borders & Code Block Copy Buttons (frontend)

**Files:**
- Modify: `public/index.html` (CSS section and JavaScript section)

### Step 6a — Add card top-border hover effect to CSS

Find the `.card` rule (around line 258) and add the new border transition properties:

```css
.card {
    background: var(--card-bg);
    border-radius: 16px;
    padding: 2rem;
    margin: 2rem 0;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-top: 3px solid transparent;
    transition: background 0.3s ease, border-top-color 0.3s ease;
}

.card:hover {
    border-top-color: var(--primary);
}
```

### Step 6b — Add CSS for code-block copy button

Add this rule in the CSS section after the `.code-block` styles (around line 445):

```css
.code-block-wrapper {
    position: relative;
    margin: 1rem 0;
}

.code-block-wrapper .code-block {
    margin: 0;
    padding-right: 4rem;
}

.copy-code-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: #50fa7b;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    font-size: 0.78rem;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.2s ease;
}

.copy-code-btn:hover {
    background: rgba(255, 255, 255, 0.25);
}
```

### Step 6c — Add JS to inject copy buttons on DOMContentLoaded

In the `DOMContentLoaded` handler (around line 2117), add this call at the bottom of the function:

```javascript
setupCodeBlockCopyButtons();
```

Then add the function definition in the JavaScript section:

```javascript
function setupCodeBlockCopyButtons() {
    document.querySelectorAll(".code-block").forEach((block) => {
        // Skip if already wrapped
        if (block.parentElement.classList.contains("code-block-wrapper")) return;

        const wrapper = document.createElement("div");
        wrapper.className = "code-block-wrapper";
        block.parentNode.insertBefore(wrapper, block);
        wrapper.appendChild(block);

        const btn = document.createElement("button");
        btn.className = "copy-code-btn";
        btn.textContent = "📋 Copy";
        btn.onclick = () => {
            copyToClipboard(block.innerText.replace(/📋 Copy/g, "").trim());
            btn.textContent = "✅ Copied";
            setTimeout(() => (btn.textContent = "📋 Copy"), 2000);
        };
        wrapper.appendChild(btn);
    });
}
```

### Step 6d — Verify visually

Reload `http://localhost:8788`. Go to the Docs page. Each code block should have a "📋 Copy" button in the top-right corner. Hover over a card — it should get a colored top border.

### Step 6e — Commit
```powershell
git add public/index.html
git commit -m "feat: add card hover borders and copy buttons on code blocks"
```

---

## Task 7: Admin Table Sorting & Badge 3-Style Preview (frontend)

**Files:**
- Modify: `public/index.html` (JavaScript section)

### Step 7a — Add sortable state variable

Near the top of the `<script>` block, add a variable to track sort state (add after `let currentEditProject = null;`):

```javascript
let adminProjectsData = [];
let sortColumn = "view_count";
let sortAscending = false;
```

### Step 7b — Modify `loadAdminData()` to store projects

Find `loadAdminData` (around line 2560) and update the projects loading:

```javascript
function loadAdminData(data) {
    const stats = data.statistics || {};
    document.getElementById("admin-requests").textContent =
        stats.totalViews?.toLocaleString() || "0";
    document.getElementById("admin-db-ops").textContent =
        stats.totalProjects || "0";

    adminProjectsData = data.projects || [];
    renderProjectsTable();
}

function renderProjectsTable() {
    const sorted = [...adminProjectsData].sort((a, b) => {
        const aVal = a[sortColumn] ?? "";
        const bVal = b[sortColumn] ?? "";
        if (typeof aVal === "number" && typeof bVal === "number") {
            return sortAscending ? aVal - bVal : bVal - aVal;
        }
        return sortAscending
            ? String(aVal).localeCompare(String(bVal))
            : String(bVal).localeCompare(String(aVal));
    });

    const projectsHtml = sorted.length
        ? generateProjectsTable(sorted)
        : "<p>No projects found. Click 'Add New Project' to get started!</p>";
    document.getElementById("admin-projects").innerHTML = projectsHtml;
}

function sortBy(column) {
    if (sortColumn === column) {
        sortAscending = !sortAscending;
    } else {
        sortColumn = column;
        sortAscending = false;
    }
    renderProjectsTable();
}
```

### Step 7c — Update `generateProjectsTable()` to use sortable headers

Find `generateProjectsTable` (around line 2577) and replace the `<thead>` section:

```javascript
// Replace the thead block inside generateProjectsTable:
let html = `
    <div style="overflow-x: auto;">
        <table class="table">
            <thead>
                <tr>
                    <th onclick="sortBy('project_name')" style="cursor:pointer;">
                        Project Name ${sortColumn==='project_name' ? (sortAscending?'↑':'↓') : '↕'}
                    </th>
                    <th onclick="sortBy('view_count')" style="cursor:pointer;">
                        Views ${sortColumn==='view_count' ? (sortAscending?'↑':'↓') : '↕'}
                    </th>
                    <th onclick="sortBy('unique_views')" style="cursor:pointer;">
                        Unique ${sortColumn==='unique_views' ? (sortAscending?'↑':'↓') : '↕'}
                    </th>
                    <th>Description</th>
                    <th onclick="sortBy('updated_at')" style="cursor:pointer;">
                        Updated ${sortColumn==='updated_at' ? (sortAscending?'↑':'↓') : '↕'}
                    </th>
                    <th style="text-align: center;">Actions</th>
                </tr>
            </thead>
            <tbody>
`;
```

### Step 7d — Update `updateBadgePreview()` for 3-style display

Find `updateBadgePreview` (around line 2458) and replace it:

```javascript
function updateBadgePreview() {
    const project = document.getElementById("badge-project").value.trim();
    const color = document.getElementById("badge-color").value;

    if (!project) {
        showNotification("❌ Please enter a project name", "error");
        return;
    }

    const styles = ["flat", "flat-square", "for-the-badge"];
    const previewContainer = document.getElementById("badge-preview");

    const previewHtml = styles.map((style) => {
        const url = `${API_BASE}/api/views/${encodeURIComponent(project)}/badge?color=${color}&style=${style}`;
        return `
            <div style="display:flex;align-items:center;gap:1rem;padding:0.75rem 0;border-bottom:1px solid var(--light);">
                <img src="${url}" alt="${style} badge" style="min-width:80px;" />
                <span style="flex:1;font-size:0.85rem;font-family:monospace;word-break:break-all;opacity:0.8;">${url}</span>
                <button onclick="copyToClipboard('${url}')" class="btn btn-secondary btn-sm">📋</button>
            </div>
        `;
    }).join("");

    previewContainer.innerHTML = `<h3>Badge Preview (all styles):</h3>${previewHtml}`;
    previewContainer.style.display = "block";

    document.getElementById("badge-url-project").textContent = project;
    document.getElementById("badge-url-color").textContent = color;
    showNotification("🎨 Badge updated!", "success");
}
```

Note: The existing `badge-url-project` and `badge-url-color` spans in the code block below badge-preview will still show, but the new preview now replaces the `<img id="demo-badge">` area.

### Step 7e — Verify

1. Admin table: click "Views" header — should sort descending. Click again — ascending. Other headers too.
2. Demo page: click "Generate Badge" — should show three badge images side-by-side with copy buttons.

### Step 7f — Commit
```powershell
git add public/index.html
git commit -m "feat: sortable admin table columns and 3-style badge preview in demo"
```

---

## Task 8: New Setup Page (frontend)

**Files:**
- Modify: `public/index.html` (nav, page divs, and JS)

### Step 8a — Add Setup nav link

Find the nav links section (around line 902) and add a new link after the Docs link and before the Admin link:

```html
<a
    href="javascript:void(0)"
    class="nav-link"
    onclick="showPage('setup', event)"
    >⚙️ Setup</a
>
```

### Step 8b — Add the Setup page div

After the closing `</div>` of `#docs-page` (around line 1927) and before the closing `</div>` of `.container`, add the new page:

```html
<!-- SETUP PAGE -->
<div id="setup-page" class="page">
    <div class="hero">
        <h1>⚙️ Self-Hosting Guide</h1>
        <p>
            Deploy your own isolated CFlair Counter instance in ~5 minutes.
            All commands below are pre-filled with your current deployment URL.
        </p>
        <div class="hero-badges">
            <span class="badge">☁️ Cloudflare Pages</span>
            <span class="badge">🗄️ D1 Database</span>
            <span class="badge">🔒 Your Data</span>
        </div>
    </div>

    <div class="card" style="border-left: 4px solid var(--info);">
        <h2>ℹ️ Data Isolation</h2>
        <p>
            When you fork and deploy this project, your Cloudflare Pages worker gets its
            own D1 database binding. <strong>Your data is completely isolated from any
            other deployment</strong> — including the original
            <code id="setup-origin-display"></code> instance.
            No shared databases, no shared secrets.
        </p>
    </div>

    <!-- Step 1 -->
    <div class="card">
        <h2>📦 Step 1 — Fork &amp; Clone</h2>
        <div class="code-block">git clone https://github.com/Life-Experimentalist/CFlair-Counter.git
cd CFlair-Counter</div>
        <p style="margin-top:1rem;">Or fork on GitHub first, then clone your fork.</p>
    </div>

    <!-- Step 2 -->
    <div class="card">
        <h2>📥 Step 2 — Install Dependencies</h2>
        <div class="code-block">npm install</div>
    </div>

    <!-- Step 3 -->
    <div class="card">
        <h2>🗄️ Step 3 — Create Your D1 Database</h2>
        <p>Run this once to create the database in your Cloudflare account:</p>
        <div class="code-block">wrangler d1 create cflaircounter-db</div>
        <p style="margin-top:1rem;">
            Copy the <code>database_id</code> from the output and paste it into
            <code>wrangler.toml</code>:
        </p>
        <div class="code-block">[[d1_databases]]
binding = "DB"
database_name = "cflaircounter-db"
database_id = "YOUR-DATABASE-ID-HERE"  # ← paste here</div>
    </div>

    <!-- Step 4 -->
    <div class="card">
        <h2>🔧 Step 4 — Set Environment Variables</h2>
        <p>
            In <code>wrangler.toml</code>, update the production vars section:
        </p>
        <div class="code-block">[env.production.vars]
ADMIN_PASSWORD = "your-secure-password-here"  # ← CHANGE THIS
ENABLE_ADMIN = "true"
ENABLE_ANALYTICS = "false"
MAX_PROJECTS = "100"</div>
        <p style="margin-top:1rem;">
            Or set secrets securely via the Cloudflare dashboard:
            <strong>Workers &amp; Pages → cflaircounter → Settings → Environment variables</strong>
        </p>
    </div>

    <!-- Step 5 -->
    <div class="card">
        <h2>🏗️ Step 5 — Initialize Schema &amp; Deploy</h2>
        <div class="code-block"># Initialize the database schema
npm run db:init

# Deploy to Cloudflare Pages
npm run deploy</div>
        <p style="margin-top:1rem;">
            After deploy, Cloudflare gives you a URL like
            <code>https://your-project.pages.dev</code>.
        </p>
    </div>

    <!-- Step 6 -->
    <div class="card">
        <h2>🌐 Step 6 — Add a Custom Domain (Optional)</h2>
        <p>In the Cloudflare dashboard:</p>
        <ol style="margin:1rem 0;padding-left:2rem;line-height:2;">
            <li>Go to <strong>Workers &amp; Pages → your project → Custom domains</strong></li>
            <li>Click <strong>Set up a custom domain</strong></li>
            <li>Enter your domain (e.g., <code>counter.yourdomain.com</code>)</li>
            <li>Add the CNAME record to your DNS: <code>counter.yourdomain.com → your-project.pages.dev</code></li>
        </ol>
        <p>For <strong>Cloudflare-managed DNS</strong>: the dashboard adds the record automatically.</p>
        <p>For <strong>external DNS providers</strong>: add the CNAME manually, then return to the dashboard to verify.</p>
    </div>

    <!-- Integration snippet, auto-filled -->
    <div class="card">
        <h2>🔗 Your API Endpoints</h2>
        <p>After deploying, your API base URL is your deployment URL. Replace <code>your-domain.com</code> with your actual domain:</p>
        <div class="code-block" id="setup-endpoints-block">Loading...</div>
    </div>

    <!-- Live health test -->
    <div class="card">
        <h2>✅ Test Your Deployment</h2>
        <p>This button pings the <code>/health</code> endpoint of the currently loaded instance:</p>
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-top:1rem;">
            <button onclick="testSetupHealth()" class="btn btn-primary">
                🏥 Test Health Endpoint
            </button>
            <span id="setup-health-result" style="font-weight:600;"></span>
        </div>
    </div>
</div>
```

### Step 8c — Add Setup page JS functions

Add these functions in the `<script>` block:

```javascript
function initSetupPage() {
    const origin = window.location.origin;
    const el = document.getElementById("setup-origin-display");
    if (el) el.textContent = origin;

    const endpointsBlock = document.getElementById("setup-endpoints-block");
    if (endpointsBlock) {
        endpointsBlock.textContent =
`# Track a view
POST ${origin}/api/views/my-project

# Get stats
GET  ${origin}/api/views/my-project

# SVG badge (use in README.md)
GET  ${origin}/api/views/my-project/badge?color=blue&style=flat

# Global stats
GET  ${origin}/api/stats

# Health check
GET  ${origin}/health`;
    }
}

async function testSetupHealth() {
    const result = document.getElementById("setup-health-result");
    if (!result) return;
    result.textContent = "Checking...";
    result.style.color = "";
    try {
        const start = performance.now();
        const res = await fetch(`${API_BASE}/health`);
        const ms = Math.round(performance.now() - start);
        if (res.ok) {
            result.textContent = `✅ Online (${ms}ms)`;
            result.style.color = "var(--success)";
        } else {
            result.textContent = `⚠️ Responded with HTTP ${res.status}`;
            result.style.color = "var(--warning)";
        }
    } catch {
        result.textContent = "❌ Unreachable";
        result.style.color = "var(--danger)";
    }
}
```

### Step 8d — Call `initSetupPage()` when setup page is shown

In `showPage()`, add:

```javascript
function showPage(pageId, event) {
    if (event) event.preventDefault();
    document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
    document.getElementById(pageId + "-page").classList.add("active");
    document.querySelectorAll(".nav-link").forEach((link) => link.classList.remove("active"));
    if (event && event.target) event.target.classList.add("active");
    currentPage = pageId;
    if (history.replaceState) history.replaceState(null, null, window.location.pathname);

    // Initialize page-specific content
    if (pageId === "setup") initSetupPage();
}
```

### Step 8e — Also call `initSetupPage()` in `DOMContentLoaded` (for deep-link support)

Add at the bottom of `DOMContentLoaded`:

```javascript
initSetupPage();
```

### Step 8f — Verify

Open `http://localhost:8788`, click "⚙️ Setup". Should see all 6 steps. Endpoints card should show `http://localhost:8788/api/views/...`. Click "Test Health Endpoint" — should show "✅ Online (Xms)".

### Step 8g — Commit
```powershell
git add public/index.html
git commit -m "feat: add self-hosting setup wizard page with auto-detected origin URLs"
```

---

## Task 9: AI Integration Docs + api-info.json (frontend + static)

**Files:**
- Modify: `public/index.html` (Docs page — add new card)
- Create: `public/.well-known/api-info.json`

### Step 9a — Create `public/.well-known/` directory and api-info.json

```powershell
New-Item -ItemType Directory -Force -Path "public/.well-known"
```

Create `public/.well-known/api-info.json`:

```json
{
  "name": "CFlair Counter API",
  "description": "Serverless view counter and analytics API. No authentication required for tracking and reading. Admin operations require a password in the request body.",
  "version": "2.0.0",
  "contact": "https://github.com/Life-Experimentalist/CFlair-Counter",
  "rateLimit": {
    "requests": 60,
    "windowSeconds": 60,
    "headers": ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]
  },
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/views/{project}",
      "auth": "none",
      "description": "Increment view count for a project. Creates the project if it does not exist.",
      "parameters": {
        "project": "string — alphanumeric, hyphens, underscores; max 100 chars"
      },
      "response": {
        "success": "boolean",
        "projectName": "string",
        "totalViews": "number",
        "uniqueViews": "number",
        "timestamp": "ISO8601"
      }
    },
    {
      "method": "GET",
      "path": "/api/views/{project}",
      "auth": "none",
      "description": "Get current view statistics for a project.",
      "response": {
        "success": "boolean",
        "projectName": "string",
        "totalViews": "number",
        "uniqueViews": "number",
        "description": "string | null",
        "createdAt": "ISO8601 | null"
      }
    },
    {
      "method": "GET",
      "path": "/api/views/{project}/badge",
      "auth": "none",
      "description": "Returns an SVG badge image with the view count.",
      "queryParams": {
        "color": "blue | brightgreen | green | yellow | orange | red | #hex",
        "label": "string — displayed as badge label (max 24 chars)",
        "style": "flat | flat-square | for-the-badge"
      },
      "responseType": "image/svg+xml"
    },
    {
      "method": "GET",
      "path": "/api/stats",
      "auth": "none",
      "description": "Global statistics across all projects.",
      "response": {
        "success": "boolean",
        "statistics": {
          "totalViews": "number",
          "uniqueViews": "number | null",
          "totalProjects": "number",
          "analyticsEnabled": "boolean"
        }
      }
    },
    {
      "method": "GET",
      "path": "/health",
      "auth": "none",
      "description": "Health check.",
      "response": { "success": "boolean", "status": "ok", "timestamp": "ISO8601", "version": "string" }
    },
    {
      "method": "POST",
      "path": "/api/admin/stats",
      "auth": "password-in-body",
      "description": "Admin: Get statistics and full project list.",
      "body": { "password": "string" }
    },
    {
      "method": "PUT",
      "path": "/api/admin/projects/{project}",
      "auth": "password-in-body",
      "description": "Admin: Update project name, description, or view counts.",
      "body": {
        "password": "string",
        "newName": "string (optional)",
        "description": "string (optional)",
        "viewCount": "number (optional)",
        "uniqueViews": "number (optional)"
      }
    },
    {
      "method": "DELETE",
      "path": "/api/views/{project}",
      "auth": "bearer-token",
      "description": "Admin: Delete a project and all its data.",
      "headers": { "Authorization": "Bearer <ADMIN_PASSWORD>" }
    }
  ]
}
```

### Step 9b — Add AI integration card to Docs page

In `public/index.html`, find the closing `</div>` of the last card in the Docs page (the "Performance & Limits" card, around line 1925) and add a new card **before** the closing `</div>` of `#docs-page`:

```html
<!-- AI / Agent Integration -->
<div class="card">
    <h2>🤖 AI &amp; Agent Integration</h2>
    <p>
        CFlair Counter is designed to be AI-friendly. The API is stateless, REST-ful,
        and requires no authentication for view tracking or reading — making it easy
        to call from agents, GitHub Actions, MCP tools, and scripts.
        A machine-readable API description is available at
        <a id="api-info-link" href="/.well-known/api-info.json" target="_blank" rel="noopener noreferrer">
            /.well-known/api-info.json
        </a>.
    </p>

    <h3>📋 Endpoint Quick Reference</h3>
    <div class="table">
        <table class="table">
            <thead>
                <tr><th>Method</th><th>Path</th><th>Auth</th><th>Purpose</th></tr>
            </thead>
            <tbody>
                <tr><td><code>POST</code></td><td><code>/api/views/{project}</code></td><td>None</td><td>Track a view</td></tr>
                <tr><td><code>GET</code></td><td><code>/api/views/{project}</code></td><td>None</td><td>Read stats</td></tr>
                <tr><td><code>GET</code></td><td><code>/api/views/{project}/badge</code></td><td>None</td><td>SVG badge</td></tr>
                <tr><td><code>GET</code></td><td><code>/api/stats</code></td><td>None</td><td>Global stats</td></tr>
                <tr><td><code>GET</code></td><td><code>/health</code></td><td>None</td><td>Health check</td></tr>
                <tr><td><code>PUT</code></td><td><code>/api/admin/projects/{project}</code></td><td>Password</td><td>Update project</td></tr>
                <tr><td><code>DELETE</code></td><td><code>/api/views/{project}</code></td><td>Bearer</td><td>Delete project</td></tr>
            </tbody>
        </table>
    </div>

    <h3>🚀 GitHub Actions — Track Views on Push</h3>
    <div class="code-block">
<span class="comment"># .github/workflows/track-views.yml</span>
name: Track Page Views
on:
  push:
    branches: [main]
jobs:
  track:
    runs-on: ubuntu-latest
    steps:
      - name: Increment view counter
        run: |
          curl -s -X POST \
            https://your-domain.com/api/views/${{ github.repository }} \
            -o /dev/null</div>

    <h3>🔧 MCP Tool Definition</h3>
    <div class="code-block">
<span class="comment">// Add to your MCP server tools array</span>
{
  name: "track_view",
  description: "Increment the view counter for a project",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string", description: "Project name (alphanumeric, hyphens, underscores)" }
    },
    required: ["project"]
  },
  handler: async ({ project }) =&gt; {
    const res = await fetch(`https://your-domain.com/api/views/${project}`, { method: "POST" });
    return await res.json();
  }
}</div>

    <h3>🐍 Python One-Liner</h3>
    <div class="code-block">
<span class="comment"># Track a view from Python</span>
import urllib.request
urllib.request.urlopen(
  urllib.request.Request("https://your-domain.com/api/views/my-project", method="POST")
)</div>
</div>
```

### Step 9c — Verify

Open `http://localhost:8788`, go to Docs page. Scroll to bottom — should see "🤖 AI & Agent Integration" card with table and code examples.

Open `http://localhost:8788/.well-known/api-info.json` — should return valid JSON.

### Step 9d — Commit
```powershell
git add public/index.html public/.well-known/api-info.json
git commit -m "feat: add AI/agent integration docs and /.well-known/api-info.json API discovery file"
```

---

## Task 10: Final Build Verification

**Files:** none changed

### Step 10a — Full production build

```powershell
npm run build
```

Expected: TypeScript compiles cleanly (zero errors), `public/_worker.js` is updated.

### Step 10b — Run dev server and do a smoke test

```powershell
npm run dev
```

Walk through this checklist:

- [ ] Home page loads, health dot turns green, global stats load
- [ ] Demo page: enter project name, click Increment, see count update; click Generate Badge, see all 3 style badges
- [ ] Docs page: all code blocks have copy buttons; AI integration card visible at bottom
- [ ] Setup page: all 6 steps visible; endpoints show `http://localhost:8788/...`; "Test Health" shows ✅
- [ ] Admin: login works; click edit (✏️), all 4 fields editable; change count and description, save → table updates; rename a project → old name gone, new name appears
- [ ] SVG badge: visit `http://localhost:8788/api/views/test/badge?label=downloads&color=brightgreen` — text fully visible, not clipped
- [ ] CORS header: `curl -v http://localhost:8788/health` shows `Access-Control-Allow-Origin: *`
- [ ] `http://localhost:8788/.well-known/api-info.json` returns JSON

### Step 10c — Commit any remaining changes and tag

```powershell
git add -A
git status  # Should be clean or only untracked non-source files

# If clean:
git log --oneline -8  # Review all commits from this session
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Fix edit count (name, description, viewCount, uniqueViews) | Tasks 4, 5 |
| New PUT endpoint | Task 3 |
| SVG badge text width fix | Task 1 |
| CORS simplification to * | Task 2 |
| Card hover borders | Task 6 |
| Code block copy buttons | Task 6 |
| Admin table sorting | Task 7 |
| Badge 3-style preview | Task 7 |
| Setup wizard page | Task 8 |
| Setup auto-fills current origin | Task 8c/8d |
| AI integration docs | Task 9 |
| api-info.json | Task 9a |
| Data isolation explanation | Task 8b (ℹ️ card) |

All spec requirements covered. No TODOs or placeholders in task code. Type names used consistently (`projectName`, `viewCount`, `uniqueViews`, `finalViews`, `finalUnique` in Tasks 3/5).
