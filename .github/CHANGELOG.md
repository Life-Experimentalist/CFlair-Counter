# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.1]() - 2026-09-11

### Changed
- hono 4.10.4 to 4.13.7, and the declared range from `^4.9.4` to `^4.13.7`.
  Fifteen advisories were open against the old version. None of them reach this
  Worker, which imports `hono` and `hono/cors` and nothing else: the CORS
  credential bypass needs `credentials: true` and this sets it to `false`, and
  the rest are in `bodyLimit`, `serveStatic`, the cache middleware, `setCookie`,
  `parseBody`, JSX, JWT, `basicAuth`, `bearerAuth`, the `Accept` header helper
  and the Lambda adapters, none of which this code loads. Upgraded anyway so
  the advisory list is empty and a fork that does add one of those starts from
  a patched base. No source change was needed and behaviour is unchanged.

## [3.0.0]() - 2026-09-11

A major version because the API lost fields. Anything that only reads a view
count keeps working unchanged. Anything that read a unique count has to change.

### Removed
- **Unique view tracking, everywhere.** `uniqueViews` is gone from
  `POST /api/views/{project}`, the `GET /api/views` batch read, `/api/stats`,
  `GET /api/views/{project}?rollup=1` and the admin endpoints. `unique_views`
  is gone from the admin project rows. `views.unique` is gone from the compute
  expression language. `analyticsEnabled` is gone from `/api/stats`, and
  `ENABLE_ANALYTICS` is gone from `wrangler.toml` and both env examples. The
  number came from a hash of IP and user agent, which is a guess at who a
  visitor is, and a guess sitting next to a real count reads like a second
  measurement. A count is a count.
- **The `visitor_tracking` table and the `unique_views` column**, dropped by
  `migrations/0001_remove_unique_views.sql`. It rebuilds the table rather than
  using `ALTER TABLE DROP COLUMN`, because SQLite has no `IF EXISTS` there and
  the statement would error on a database created from the current schema. As
  written it is safe on an old database, on a fresh one, and run twice.
- The default series of `GET /api/views/{project}/history` used to be the
  visitor-derived approximation. It is now the nightly snapshot, a real running
  total per day. `?series=snapshots` still works and means the same thing, so
  existing callers are unaffected.

### Added
- **`MAX_PROJECTS`, now enforced**, and raised to `1000`. It has been declared
  since the beginning and read by nothing. At the cap, a project name that does
  not exist yet is refused with a 409; every project that already exists keeps
  counting. There is no admin create-project route, so the cap sits on the two
  paths that create a project implicitly: `POST /api/views/{project}` and the
  badge with `?inc=true`.
- **`DAILY_WRITE_BUDGET`**, at `30000`. D1's free tier allows 100,000 rows
  written a day, and reaching it turns every write into an error with no
  warning. The budget counts requests rather than rows, and one recorded view is
  two rows at the shipped settings, the usage counter and the project row, or
  three with `TRACK_BREAKDOWN` on. So the default is 60,000 rows and 90,000
  respectively, which leaves the nightly snapshot room to run. Past the budget a
  view POST is refused with a 503 and a `Retry-After` counting down to UTC
  midnight, while a badge still renders and silently skips the increment,
  because a badge that errors is a broken image in someone's README. Reads are
  never shed. The count only happens while `TRACK_USAGE` is `true`, since that
  is the code doing the counting. `0` turns the budget off.

  This does nothing for the Workers request limit, 100,000 a day on the free
  plan. Cloudflare stops invoking the worker at that point, so no code inside
  the worker can answer for it.
- **`npm run setup` offers to set every `[vars]` value.** It lists the nine
  settings and asks whether to change any of them, before the deploy rather
  than after it. The question defaults to no, each prompt defaults to the
  shipped value, and the whole thing is skipped when there is no terminal, so
  an unattended or CI install behaves exactly as it did.

### Changed
- The header comment on `.github/workflows/verify-deploy.yml` said the version
  poll was "the signal that the build actually landed". It is not. It proves a
  build carrying that version is answering, and when the version has not
  changed it passes on the first attempt against whatever was already live. The
  comment now says so.

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
- **Every variable the code reads is now declared in `[vars]`**, each set to the
  value the code already fell back to, so the full configuration surface is
  visible in one file: `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW`,
  `INSTALL_CACHE_TTL`, `TRACK_USAGE`, `TRACK_BREAKDOWN` and `DEBUG` join the
  three that were already there. Runtime behaviour is unchanged except for
  `TRACK_USAGE`, which is `"true"`. This matters because `wrangler deploy`
  replaces the whole deployed variable list, so a variable set only in the
  Cloudflare dashboard is erased by the next deploy without an error.
- **`[observability]`**, enabling log and trace retention with full head
  sampling and invocation logs. Declared in the config for the same reason: a
  deploy owns the setting, so an absent block turns it back off.
- **`[build]`**, so a bare `wrangler deploy` builds the worker first. That is
  what Cloudflare Workers Builds runs when its build command is blank. Because
  wrangler now runs the build itself, `npm run deploy` dropped its own
  `npm run build &&` prefix, which had become a second full build.
- **`.dev.vars.example`**, listing the same names for local `wrangler dev`.

### Removed
- **`.github/workflows/snapshot.yml`.** It called the deployed instance over
  the public internet from a GitHub runner, which Cloudflare's Bot Fight Mode
  answered with a challenge page. It had not completed a run since 2026-09-08.
  The Cron Trigger replaces it.
- **`setup.ps1`.** It deployed to Cloudflare Pages, was Windows only, and took
  the admin password as a command-line argument, which put it in shell history.
  `npm run setup` replaces it on every platform and never handles the password.

### Fixed

- **OS metadata files were being published.** `wrangler deploy` uploads whatever
  sits in `public/`, so a deploy from Windows served `desktop.ini` and one from
  macOS would have served `.DS_Store`. Both are gitignored, so they never arrive
  through the repository, but they were reaching production from the deploying
  machine. `public/.assetsignore` now excludes them.
- **The docs said a custom domain was dashboard only.** `wrangler deploy` takes
  a `--domains` flag, which attaches the hostname and creates the DNS record in
  one command. The attachment lives on the Worker, so later plain `npm run
  deploy` runs keep it, which is what makes it safe to leave `routes` out of the
  committed `wrangler.toml` and keep forks from claiming someone else's
  hostname.
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
