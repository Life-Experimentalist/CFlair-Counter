# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0]() - 2026-09-10

Nothing was recorded here for 2.3.0 or 2.4.0. The git history covers them.

### Changed
- **Moved from Cloudflare Pages to Cloudflare Workers.** `wrangler.toml` now
  declares `main`, `[assets]` and the D1 binding directly, so a deployment no
  longer depends on anything configured in the dashboard. The public API,
  every route and every existing badge URL are unchanged.
- **Renamed the D1 database** from `cflaircounter-db` to `viewflare-db`. D1 has
  no rename operation, so this was an export into a new database. The binding
  is still `DB`, which is the name the code reads.
- The Worker name is `viewflare`, matching the product for the first time.
- `npm run db:init` and `npm run db:migrate` now pass `--remote`. Without it
  they silently wrote to a local SQLite file instead of the real database.

### Added
- **`npm run setup`**, a one-command install: login check, database creation,
  `database_id` written into `wrangler.toml`, schema applied, admin password
  prompt handed to `wrangler secret put`, deploy. Idempotent throughout.
- **`scripts/prepare.mjs`**, which runs after `npm install` and points at
  `npm run setup`. Git has no post-clone hook; this is the nearest thing.
- **A nightly Cron Trigger** for the install-count snapshot, declared in
  `[triggers]` and handled by `scheduled()` in `functions/index.ts`. It runs
  inside Cloudflare with the D1 binding in hand, so it never crosses the edge.
- **A second Claude Code skill.** `viewflare-setup` deploys and upgrades an
  instance and checks whether one is out of date; `viewflare-integration` is
  the smaller one that wires tracking into an existing project.
- `/health` reports the running `version`, so a deployed instance can be
  compared against the latest release.
- `public/.assetsignore`, without which Workers static assets would publish the
  bundled worker source at `/_worker.js`.

### Removed
- **`.github/workflows/snapshot.yml`.** It called the deployed instance over
  the public internet from a GitHub runner, which Cloudflare's Bot Fight Mode
  answered with a challenge page. It had not completed a run since 2026-09-08.
  The Cron Trigger replaces it.
- **`setup.ps1`.** It deployed to Cloudflare Pages, was Windows only, and took
  the admin password as a command-line argument, which put it in shell history.
  `npm run setup` replaces it on every platform and never handles the password.

### Fixed
- The Newman CI job now runs `wrangler dev` inside the runner and tests against
  that, instead of a deployed instance. A fork gets a green run with no
  repository secrets and no account. It also type-checks before building,
  because esbuild strips types without checking them.
- `npm run setup` runs wrangler as a plain node script rather than through
  `npx`. Since Node 18.20.2, spawning `npx.cmd` on Windows without a shell
  fails with `EINVAL`, which stopped the script at its first step.
- `.env.example` named four variables that no code path reads (`CACHE_TTL`,
  `RATE_LIMIT`, `DEBUG_MODE`, and `MAX_PROJECTS`, which is set in
  `wrangler.toml` but never read). It now lists the real names with their
  defaults, and says which of them belong in a secret rather than a var.
- The landing page description, `llms.txt` and `openapi.yaml` still said
  Cloudflare Pages. `openapi.yaml` also offered `your-instance.pages.dev` as
  the server default.

## [2.2.0]() - 2025-01-14

### Added
- **Project Deletion Feature** - Complete CRUD operations now available
  - New `DELETE /api/views/:projectName` endpoint with admin authentication
  - Frontend integration with confirmation dialog
  - Cascade deletion (removes from both project_views and visitor_tracking tables)
  - Loading states and success/error notifications
  - Auto-refresh admin data after deletion
- **Postman Collection Update**
  - Added "Delete Project (Admin)" request with automated tests
  - Complete API testing coverage (18 requests)
- **Form Accessibility Improvements**
  - Added username field to admin login form
  - Eliminates browser console warning
  - Improved accessibility compliance

### Removed
- **Dark Reader Override Code** (~80 lines removed)
  - Removed HTML meta tags (data-darkreader-mode, data-darkreader-scheme)
  - Removed CSS override style block
  - Removed JavaScript removal script
  - Cleaner codebase, faster page load

### Fixed
- Password form accessibility warning (added username field)
- Project deletion now fully functional (was showing warning before)
- CORS configuration updated to allow DELETE method

### Changed
- Updated CORS allowed methods: `["GET", "POST", "DELETE", "OPTIONS"]`
- Enhanced admin panel now supports true project deletion
- Improved error handling in delete operations

## [2.1.0]() - 2025-11-09

### Added
- **Enhanced Admin Panel** with comprehensive project management
  - ➕ Add new projects directly from UI
  - ✏️ Edit existing project details
  - 🔄 Refresh data on demand
  - ➕ Manual view increment for any project
- **Badge & Links Generator Modal**
  - 6 pre-configured color variations with live previews
  - API endpoint documentation
  - Markdown and HTML examples
  - One-click copy buttons for all URLs
- **Interactive Project Table**
  - 🎨 Get badge variations & links button
  - ✏️ Edit project details button
  - ➕ Add view count button
  - 🗑️ Delete project button (UI ready, API pending)
- **ViewFlare Logo** integration across all pages
  - Logo in navbar
  - Logo in hero section
  - Favicon support
  - Open Graph meta tags
- **Comprehensive Documentation**
  - Complete README.md with architecture diagrams
  - Admin Guide (ADMIN-GUIDE.md)
  - Admin Enhancement Summary (ADMIN-ENHANCEMENT.md)
  - Contributing guidelines (CONTRIBUTING.md)
  - Postman collection documentation
- **Form Improvements**
  - Password field wrapped in proper `<form>` tag
  - Autocomplete attributes for better UX
  - Form validation for project names

### Fixed
- Console error: Password field not in form warning
- Dark Reader interference with UI colors
- Admin data mapping to match actual API response structure
- Badge field mapping (project_name, view_count, etc.)
- Admin dashboard labels (Total Views, Total Projects)

### Changed
- Updated package.json to version 2.1.0
- Improved modal system (3 modal types with ESC key support)
- Enhanced error messages with user-friendly warnings
- Project table now shows action buttons for each project

### Security
- Admin password now stored temporarily for refresh operations
- Proper form handling for password inputs

## [2.0.0]() - 2025-11-08

### Added
- **Complete Frontend Rewrite**
  - Modern single-page application design
  - Responsive mobile-first layout
  - Professional color scheme and typography
- **Admin Dashboard**
  - Statistics overview (total views, total projects)
  - Project management table
  - Admin authentication system
- **Badge Generation**
  - Dynamic SVG badge generation
  - 6 color variations (blue, green, red, orange, purple, brightgreen)
  - Custom label support
  - 1-hour caching for performance
- **API Endpoints**
  - POST /api/views/:project (track views)
  - GET /api/views/:project (get statistics)
  - GET /api/views/:project/badge (generate badge)
  - POST /api/admin/stats (admin statistics)
  - GET /health (health check)
- **Rate Limiting**
  - 1000 requests per hour per IP
  - IP-based tracking with SHA-256 hashing
- **Documentation Pages**
  - Home page with global statistics
  - Demo page with interactive testing
  - API documentation page
  - Integration examples page

### Changed
- Migrated from separate API functions to unified middleware
- Database schema optimized for better performance
- Response format standardized across all endpoints

### Security
- IP addresses hashed with SHA-256 for privacy
- Admin password protection
- GDPR-compliant visitor tracking

## [1.0.0]() - 2025-11-07

### Added
- Initial release
- Basic view tracking functionality
- Cloudflare D1 database integration
- Simple API endpoints for view counting
- Basic badge generation
- TypeScript support
- Hono framework integration

### Core Features
- View counter with unique visitor tracking
- Simple badge generation (blue color only)
- Basic statistics retrieval
- Cloudflare Pages deployment

### Database
- SQLite D1 database
- view_counts table
- visitor_tracking table

## [Unreleased]

### Planned Features
- [ ] DELETE /api/views/:project endpoint for project deletion
- [ ] PATCH /api/views/:project endpoint for direct count updates
- [ ] GET /api/stats endpoint for global statistics
- [ ] Bulk project operations
- [ ] Analytics graphs and charts
- [ ] Data export functionality (JSON/CSV)
- [ ] Project search and filtering
- [ ] Pagination for large project lists
- [ ] Custom badge colors (hex code support)
- [ ] Webhook notifications
- [ ] CLI tool for management
- [ ] Comprehensive test suite
- [ ] Docker support for local development
- [ ] i18n support for multiple languages
- [ ] Dark mode toggle

---

## Version History

- **2.1.0** - Enhanced admin panel with full project management (2025-11-09)
- **2.0.0** - Complete rewrite with modern UI and admin dashboard (2025-11-08)
- **1.0.0** - Initial release with basic functionality (2025-11-07)

---

For detailed information about each release, see the [GitHub Releases](https://github.com/Life-Experimentalists/ViewFlare/releases) page.
