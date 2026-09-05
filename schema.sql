-- Optimized ViewFlare Database Schema
-- Minimal indexes and efficient structure for cost optimization
-- Main projects table - simplified for webhook efficiency
CREATE TABLE IF NOT EXISTS project_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL UNIQUE,
    view_count INTEGER DEFAULT 0,
    unique_views INTEGER DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Only essential indexes to minimize write costs
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_name ON project_views(project_name);
-- Lightweight visitor tracking - optional for cost control
CREATE TABLE IF NOT EXISTS visitor_tracking (
    project_name TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    last_visit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    visit_count INTEGER DEFAULT 1,
    PRIMARY KEY(project_name, visitor_hash)
);
-- Usage monitoring table for staying within limits
CREATE TABLE IF NOT EXISTS usage_stats (
    date TEXT PRIMARY KEY,
    -- YYYY-MM-DD format
    requests_count INTEGER DEFAULT 0,
    rows_read INTEGER DEFAULT 0,
    rows_written INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Which registries a project publishes to, for GET /api/installs/{project}.
-- A project with no rows here has no install sources configured and the
-- existing view-counting behaviour is unchanged.
CREATE TABLE IF NOT EXISTS install_sources (
    project_name TEXT NOT NULL,
    source TEXT NOT NULL,   -- vscode | openvsx | pypi | github | npm
    config TEXT NOT NULL,   -- the identifier that source is looked up by
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_name, source)
);

-- One cached count per source, refreshed on a TTL (INSTALL_CACHE_TTL, default
-- 6h) so a single dead upstream cannot take the whole aggregate response down.
CREATE TABLE IF NOT EXISTS install_cache (
    project_name TEXT NOT NULL,
    source TEXT NOT NULL,
    count INTEGER,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_name, source)
);
