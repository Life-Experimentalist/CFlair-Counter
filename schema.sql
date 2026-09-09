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
    source TEXT NOT NULL,   -- vscode | openvsx | pypi | github | npm | crates
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

-- Structured event log for POST /api/events.
CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_category TEXT NOT NULL,
    event_name TEXT NOT NULL,
    session_id TEXT,
    metadata_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_event_cat ON event_logs(event_category, created_at);

-- One row per project, source and UTC day, written by
-- POST /api/admin/installs/snapshot. The rolling-window sources (npm, pypi)
-- only publish the last month, so charting them over a longer period means
-- recording them as they go. "window" is quoted because SQLite treats it as a
-- keyword.
CREATE TABLE IF NOT EXISTS install_snapshots (
    day TEXT NOT NULL,            -- YYYY-MM-DD, UTC
    project_name TEXT NOT NULL,
    source TEXT NOT NULL,
    value INTEGER NOT NULL,
    "window" TEXT NOT NULL,       -- all-time | last_month
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(day, project_name, source)
);
CREATE INDEX IF NOT EXISTS idx_install_snapshots_project ON install_snapshots(project_name, day);

-- The same idea for view counts. project_views only holds a running total and
-- visitor_tracking.last_visit is overwritten per visitor, so neither is a real
-- time series.
CREATE TABLE IF NOT EXISTS view_snapshots (
    day TEXT NOT NULL,            -- YYYY-MM-DD, UTC
    project_name TEXT NOT NULL,
    view_count INTEGER NOT NULL,
    unique_views INTEGER NOT NULL DEFAULT 0,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(day, project_name)
);

-- Where the views came from, one row per UTC day, project, country and
-- referring host. Only written when TRACK_BREAKDOWN is "true", because it costs
-- a second D1 write on every view. "unknown" means the signal was missing
-- (CF-IPCountry is absent under wrangler pages dev, and a referrer can be
-- stripped by referrer policy); "none" means no Referer header was sent at all.
CREATE TABLE IF NOT EXISTS view_breakdown (
    day TEXT NOT NULL,            -- YYYY-MM-DD, UTC
    project_name TEXT NOT NULL,
    country TEXT NOT NULL,        -- ISO 3166-1 alpha-2, or "unknown"
    referrer_host TEXT NOT NULL,  -- host, "none", or "unknown"
    view_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(day, project_name, country, referrer_host)
);
CREATE INDEX IF NOT EXISTS idx_view_breakdown_project ON view_breakdown(project_name, day);
