-- Remove unique-view tracking.
--
-- A view is a view. The unique count was a second number derived from an
-- IP-and-user-agent hash, which is not a person: it split one visitor across
-- devices and networks, merged everyone behind a shared address, and cost a
-- write plus a COUNT(*) on every single view to produce. Nothing consumed it.
--
-- Apply this only after deploying the code that stopped reading these columns:
--
--     npm run deploy
--     npx wrangler d1 migrations apply viewflare-db --remote
--
-- The other order leaves a live Worker selecting a column that is gone, which
-- fails every request that touches project_views.
--
-- The columns are dropped by rebuilding the two tables rather than with
-- ALTER TABLE DROP COLUMN, because SQLite has no DROP COLUMN IF EXISTS and this
-- has to be safe to run against a database created after the change as well as
-- one created before it. Copying only the columns that survive works either way.

DROP TABLE IF EXISTS visitor_tracking;

CREATE TABLE IF NOT EXISTS project_views_rebuilt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL UNIQUE,
    view_count INTEGER DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO project_views_rebuilt (id, project_name, view_count, description, created_at, updated_at)
SELECT id, project_name, view_count, description, created_at, updated_at FROM project_views;

DROP TABLE project_views;

ALTER TABLE project_views_rebuilt RENAME TO project_views;

-- Dropping the old table dropped this with it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_name ON project_views(project_name);

CREATE TABLE IF NOT EXISTS view_snapshots_rebuilt (
    day TEXT NOT NULL,
    project_name TEXT NOT NULL,
    view_count INTEGER NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(day, project_name)
);

INSERT INTO view_snapshots_rebuilt (day, project_name, view_count, recorded_at)
SELECT day, project_name, view_count, recorded_at FROM view_snapshots;

DROP TABLE view_snapshots;

ALTER TABLE view_snapshots_rebuilt RENAME TO view_snapshots;
