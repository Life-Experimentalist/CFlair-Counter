# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **CFlairCounter Logo** integration across all pages
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

For detailed information about each release, see the [GitHub Releases](https://github.com/Life-Experimentalists/CFlair-Counter/releases) page.
