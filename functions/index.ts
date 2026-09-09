// Cloudflare Pages Function - Root handler
// This handles all API routes for ViewFlare

import { Hono } from "hono";
import { cors } from "hono/cors";

// Define the environment bindings
type Bindings = {
	DB: D1Database;
	ADMIN_PASSWORD?: string;
	ENABLE_ADMIN?: string;
	ENABLE_ANALYTICS?: string;
	MAX_PROJECTS?: string;
	RATE_LIMIT_REQUESTS?: string;
	RATE_LIMIT_WINDOW?: string;
	INSTALL_CACHE_TTL?: string;
	TRACK_USAGE?: string;
	TRACK_BREAKDOWN?: string;
	DEBUG?: string;
};

type Variables = {
	visitorHash?: string;
	projectName?: string;
};

const escapeXml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");

const normalizeBadgeColor = (rawColor: string): string | null => {
	if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(rawColor)) {
		return rawColor;
	}

	return null;
};

// A dot makes a project name a path: "acme.api.docs" sits under "acme.api",
// which sits under "acme". Nothing about storage changes, the name is still one
// string in one column. The dots only matter when a caller asks for a rollup.
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

const wantsRollup = (c: any): boolean => {
	const raw = c.req.query("rollup");
	return raw === "1" || raw === "true";
};

// Sums a project together with every descendant of it.
//
// The range comparison is deliberate. `LIKE 'name.%'` would be wrong here
// because `_` is a LIKE wildcard and underscores are legal in a name, so
// `my_org.%` would also match `myXorg.api`. `/` is the byte directly after `.`,
// so `> name || '.'` and `< name || '/'` is exactly the dotted subtree, and it
// still uses idx_project_name.
const readSubtreeViews = async (db: D1Database, projectName: string) => {
	const rows = await db
		.prepare(
			`SELECT project_name, view_count, unique_views
			FROM project_views
			WHERE project_name = ?1
				OR (project_name > ?1 || '.' AND project_name < ?1 || '/')
			ORDER BY project_name`,
		)
		.bind(projectName)
		.all();

	const members = ((rows.results || []) as any[]).map((row) => ({
		projectName: String(row.project_name),
		totalViews: Number(row.view_count) || 0,
		uniqueViews: Number(row.unique_views) || 0,
	}));

	return {
		members,
		totalViews: members.reduce((sum, m) => sum + m.totalViews, 0),
		uniqueViews: members.reduce((sum, m) => sum + m.uniqueViews, 0),
	};
};

// In-memory rate limiting store (Workers KV would be better for production)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Rate limiting middleware - Prevents webhook spam
const customRateLimiter = async (c: any, next: any) => {
	const key = c.req.header("CF-Connecting-IP") || "unknown";
	const now = Date.now();

	// Get rate limit config from env or use defaults
	const maxRequests = parseInt(c.env.RATE_LIMIT_REQUESTS || "60"); // 60 requests
	const windowMs = parseInt(c.env.RATE_LIMIT_WINDOW || "60000"); // per minute

	// Cleanup expired entries on each request (to avoid memory leak)
	for (const [ip, data] of rateLimitStore.entries()) {
		if (now > data.resetAt) {
			rateLimitStore.delete(ip);
		}
	}

	// Check if IP has existing rate limit data
	let rateLimitData = rateLimitStore.get(key);

	// Clean up if window expired
	if (rateLimitData && now > rateLimitData.resetAt) {
		rateLimitData = undefined;
		rateLimitStore.delete(key);
	}

	// Initialize or increment
	if (!rateLimitData) {
		rateLimitData = { count: 1, resetAt: now + windowMs };
		rateLimitStore.set(key, rateLimitData);
	} else {
		rateLimitData.count++;
	}

	// Check if rate limit exceeded
	if (rateLimitData.count > maxRequests) {
		const retryAfter = Math.ceil((rateLimitData.resetAt - now) / 1000);
		c.header("Retry-After", retryAfter.toString());
		c.header("X-RateLimit-Limit", maxRequests.toString());
		c.header("X-RateLimit-Remaining", "0");
		c.header("X-RateLimit-Reset", rateLimitData.resetAt.toString());

		return c.json(
			{
				success: false,
				error: "Rate limit exceeded",
				retryAfter: retryAfter,
				message: `Too many requests. Please wait ${retryAfter} seconds.`,
			},
			429,
		);
	}

	// Add rate limit headers
	c.header("X-RateLimit-Limit", maxRequests.toString());
	c.header(
		"X-RateLimit-Remaining",
		(maxRequests - rateLimitData.count).toString(),
	);
	c.header("X-RateLimit-Reset", rateLimitData.resetAt.toString());

	await next();
};

// Note: Periodic cleanup removed - Workers don't support setInterval at global scope
// Rate limit entries will naturally expire when checked

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Utility function to generate visitor hash (IP-based, privacy-friendly)
const generateVisitorHash = (request: Request): string => {
	const ip =
		request.headers.get("CF-Connecting-IP") ||
		request.headers.get("X-Forwarded-For") ||
		"unknown";
	const userAgent = request.headers.get("User-Agent") || "";

	// Simple hash function for privacy (not cryptographically secure, but sufficient)
	let hash = 0;
	const str = `${ip}_${userAgent}`;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return Math.abs(hash).toString(36);
};

// CORS middleware
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

// Database initialization with optimized schema.
// The schema is normally applied once by `npm run db:init`. Running the DDL on
// every request costs about ten D1 statements per invocation for no benefit, so
// it runs at most once per Worker isolate and every later caller reuses the same
// promise. Nothing here ever rejects, so a cached failure cannot wedge the
// isolate.
let schemaReady: Promise<void> | null = null;

const runSchemaDdl = async (db: D1Database) => {
	try {
		// Create tables with minimal indexes for cost optimization
		await db
			.prepare(
				`
			CREATE TABLE IF NOT EXISTS project_views (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				project_name TEXT NOT NULL UNIQUE,
				view_count INTEGER DEFAULT 0,
				unique_views INTEGER DEFAULT 0,
				description TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`,
			)
			.run();

		// Only essential indexes to minimize write costs
		await db
			.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_project_name ON project_views(project_name)",
			)
			.run();

		// Lightweight visitor tracking - optional for cost control
		await db
			.prepare(
				`
			CREATE TABLE IF NOT EXISTS visitor_tracking (
				project_name TEXT NOT NULL,
				visitor_hash TEXT NOT NULL,
				last_visit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				visit_count INTEGER DEFAULT 1,
				PRIMARY KEY(project_name, visitor_hash)
			)
		`,
			)
			.run();

		// Usage monitoring table for staying within limits
		await db
			.prepare(
				`
			CREATE TABLE IF NOT EXISTS usage_stats (
				date TEXT PRIMARY KEY, -- YYYY-MM-DD format
				requests_count INTEGER DEFAULT 0,
				rows_read INTEGER DEFAULT 0,
				rows_written INTEGER DEFAULT 0,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`,
			)
			.run();

		await db.prepare(`
			CREATE TABLE IF NOT EXISTS event_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				event_category TEXT NOT NULL,
				event_name TEXT NOT NULL,
				session_id TEXT,
				metadata_json TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`).run()

		await db.prepare(
			"CREATE INDEX IF NOT EXISTS idx_event_cat ON event_logs(event_category, created_at)"
		).run()

		// Which registries a project publishes to. A project with no rows here
		// has no install sources and behaves exactly as it did before.
		await db
			.prepare(
				`
			CREATE TABLE IF NOT EXISTS install_sources (
				project_name TEXT NOT NULL,
				source TEXT NOT NULL,   -- vscode | openvsx | pypi | github | npm | crates
				config TEXT NOT NULL,   -- the identifier that source is looked up by
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY(project_name, source)
			)
		`,
			)
			.run();

		// One cached count per source, so a single dead upstream cannot take the
		// whole aggregate response down.
		await db
			.prepare(
				`
			CREATE TABLE IF NOT EXISTS install_cache (
				project_name TEXT NOT NULL,
				source TEXT NOT NULL,
				count INTEGER,
				fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY(project_name, source)
			)
		`,
			)
			.run();

		// One row per project, source and UTC day. The rolling-window sources
		// (npm, pypi) only publish the last month, so charting them over a longer
		// period means recording them as they go. "window" is quoted because
		// SQLite treats it as a keyword.
		await db
			.prepare(
				`
			CREATE TABLE IF NOT EXISTS install_snapshots (
				day TEXT NOT NULL,            -- YYYY-MM-DD, UTC
				project_name TEXT NOT NULL,
				source TEXT NOT NULL,
				value INTEGER NOT NULL,
				"window" TEXT NOT NULL,       -- all-time | last_month
				recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY(day, project_name, source)
			)
		`,
			)
			.run();

		await db
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_install_snapshots_project ON install_snapshots(project_name, day)",
			)
			.run();

		// The same idea for view counts. project_views only holds a running total
		// and visitor_tracking.last_visit is overwritten per visitor, so neither is
		// a real time series. This is.
		await db
			.prepare(
				`
			CREATE TABLE IF NOT EXISTS view_snapshots (
				day TEXT NOT NULL,            -- YYYY-MM-DD, UTC
				project_name TEXT NOT NULL,
				view_count INTEGER NOT NULL,
				unique_views INTEGER NOT NULL DEFAULT 0,
				recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY(day, project_name)
			)
		`,
			)
			.run();

		// Where the views came from, one row per day, project, country and
		// referring host. Only written when TRACK_BREAKDOWN is "true", because
		// it costs a second D1 write on every view. The two sentinel values are
		// "unknown" (the signal was not there) and "none" (a referrer was
		// genuinely absent); the read route turns "unknown" back into null so a
		// missing value never reads as a real one.
		await db
			.prepare(
				`
			CREATE TABLE IF NOT EXISTS view_breakdown (
				day TEXT NOT NULL,            -- YYYY-MM-DD, UTC
				project_name TEXT NOT NULL,
				country TEXT NOT NULL,        -- ISO 3166-1 alpha-2, or "unknown"
				referrer_host TEXT NOT NULL,  -- host, "none", or "unknown"
				view_count INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY(day, project_name, country, referrer_host)
			)
		`,
			)
			.run();

		await db
			.prepare(
				"CREATE INDEX IF NOT EXISTS idx_view_breakdown_project ON view_breakdown(project_name, day)",
			)
			.run();
	} catch (error) {
		console.error("Database initialization error:", error);
	}
};

const initDatabase = (db: D1Database): Promise<void> => {
	if (!schemaReady) {
		schemaReady = runSchemaDdl(db);
	}
	return schemaReady;
};

// Edge cache for read-only GET routes. A hit answers without touching D1, which
// is what keeps a busy badge off the free-tier row budget. Worker invocations
// still count on a hit; docs/CLOUDFLARE-SETUP.md covers the zone-level cache
// rule that avoids those too.
const edgeCache = (seconds: number) => async (c: any, next: any) => {
	const cache = (globalThis as any).caches?.default;
	// ?inc=true makes a badge request a write. Serving that from cache would
	// silently drop the increment, so it always goes through.
	if (!cache || c.req.method !== "GET" || c.req.query("inc") === "true") {
		return next();
	}

	const key = new Request(c.req.url, { method: "GET" });
	const hit = await cache.match(key);
	if (hit) {
		const cached = new Response(hit.body, hit);
		cached.headers.set("X-Worker-Cache", "HIT");
		c.res = cached;
		return;
	}

	await next();

	const res = c.res;
	if (!res || res.status !== 200) {
		return;
	}

	const out = new Response(res.body, res);
	if (!out.headers.has("Cache-Control")) {
		out.headers.set("Cache-Control", `public, max-age=${seconds}`);
	}

	// The stored copy must not carry this request's rate-limit counters, or a
	// later hit would report a window that has long since expired.
	const stored = out.clone();
	stored.headers.delete("X-RateLimit-Limit");
	stored.headers.delete("X-RateLimit-Remaining");
	stored.headers.delete("X-RateLimit-Reset");
	stored.headers.delete("Retry-After");

	try {
		c.executionCtx.waitUntil(cache.put(key, stored));
	} catch {
		await cache.put(key, stored);
	}

	out.headers.set("X-Worker-Cache", "MISS");
	c.res = out;
};

// Health check endpoint
app.get("/health", (c) => {
	// Debug logging only if DEBUG env variable is set to "true"
	const enableAdmin = c.env.ENABLE_ADMIN !== "false";
	if (c.env.DEBUG === "true") {
		console.log("🔧 [DEBUG] System Configuration:");
		console.log("  - Admin Enabled:", enableAdmin);
		console.log(
			"  - Analytics Enabled:",
			c.env.ENABLE_ANALYTICS !== "false",
		);
	}

	return c.json({
		success: true,
		status: "ok",
		timestamp: new Date().toISOString(),
		worker: "viewflare-api",
		version: "2.0.0",
	});
});

// Get view count for a project (optimized query)
// Batch read. A portfolio page listing fifteen projects used to make fifteen
// requests; this answers all of them at once. Strictly read-only: it never
// increments, so it is safe to call on every page render.
const BATCH_VIEWS_LIMIT = 50;

app.get("/api/views", edgeCache(60), async (c) => {
	const raw = c.req.query("names") || c.req.query("projects") || "";
	const requested = [
		...new Set(
			raw
				.split(",")
				.map((name) => name.trim())
				.filter((name) => name.length > 0 && name.length <= 100),
		),
	];

	if (requested.length === 0) {
		return c.json(
			{
				success: false,
				error:
					"Pass a comma-separated names parameter, for example ?names=project-a,project-b",
				limit: BATCH_VIEWS_LIMIT,
			},
			400,
		);
	}
	if (requested.length > BATCH_VIEWS_LIMIT) {
		return c.json(
			{
				success: false,
				error: `Too many names. The limit is ${BATCH_VIEWS_LIMIT} per request.`,
				requested: requested.length,
				limit: BATCH_VIEWS_LIMIT,
			},
			400,
		);
	}

	await initDatabase(c.env.DB);

	try {
		const placeholders = requested.map(() => "?").join(",");
		const rows = await c.env.DB.prepare(
			`SELECT project_name, view_count, unique_views FROM project_views WHERE project_name IN (${placeholders})`,
		)
			.bind(...requested)
			.all();

		const views: Record<string, number> = {};
		const unique: Record<string, number> = {};
		for (const row of (rows.results || []) as any[]) {
			views[String(row.project_name)] = Number(row.view_count) || 0;
			unique[String(row.project_name)] = Number(row.unique_views) || 0;
		}

		// A project that has never been recorded is reported as missing rather
		// than as a zero, so a typo in a name cannot pass for a real count.
		const missing = requested.filter((name) => !(name in views));
		const total = Object.values(views).reduce((sum, n) => sum + n, 0);

		c.header("Cache-Control", "public, max-age=60");
		c.header("Access-Control-Allow-Origin", "*");
		return c.json({
			success: true,
			views,
			uniqueViews: unique,
			missing,
			requested: requested.length,
			found: Object.keys(views).length,
			total,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Batch views error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

app.get("/api/views/:projectName", edgeCache(60), async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ error: "Invalid project name" }, 400);
	}

	await initDatabase(c.env.DB);

	try {
		// ?rollup=1 answers for this project plus everything under it. Off by
		// default, so an existing caller sees exactly what it always did.
		if (wantsRollup(c)) {
			const subtree = await readSubtreeViews(c.env.DB, projectName);
			return c.json({
				success: true,
				projectName,
				rollup: true,
				totalViews: subtree.totalViews,
				uniqueViews: subtree.uniqueViews,
				memberCount: subtree.members.length,
				members: subtree.members,
			});
		}

		const result = await c.env.DB.prepare(
			"SELECT view_count, unique_views, description, created_at FROM project_views WHERE project_name = ?",
		)
			.bind(projectName)
			.first();

		if (!result) {
			return c.json({
				success: true,
				projectName,
				totalViews: 0,
				uniqueViews: 0,
				description: null,
				createdAt: null,
			});
		}

		return c.json({
			success: true,
			projectName,
			totalViews: result.view_count,
			uniqueViews: result.unique_views,
			description: result.description,
			createdAt: result.created_at,
		});
	} catch (error) {
		console.error("Query error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// Increment view count (webhook endpoint - optimized for minimal DB operations)
// ⚡ Rate Limited: Prevents spam and abuse
app.post("/api/views/:projectName", customRateLimiter, async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ error: "Invalid project name" }, 400);
	}

	// Generate visitor hash for unique tracking
	const visitorHash = generateVisitorHash(c.req.raw);

	await initDatabase(c.env.DB);

	try {
		// Track usage for monitoring
		await trackUsage(c.env);

		// Single optimized query - Insert or increment in one operation
		await c.env.DB.prepare(
			`
			INSERT INTO project_views (project_name, view_count, updated_at)
			VALUES (?, 1, CURRENT_TIMESTAMP)
			ON CONFLICT(project_name) DO UPDATE SET
				view_count = view_count + 1,
				updated_at = CURRENT_TIMESTAMP
		`,
		)
			.bind(projectName)
			.run();

		let uniqueViews = 0;

		// Optional: Track unique visitors (can be disabled for cost savings)
		const enableAnalytics = c.env.ENABLE_ANALYTICS !== "false";
		if (enableAnalytics) {
			// Efficient visitor tracking with minimal queries
			await c.env.DB.prepare(
				`
				INSERT INTO visitor_tracking (project_name, visitor_hash, last_visit, visit_count)
				VALUES (?, ?, CURRENT_TIMESTAMP, 1)
				ON CONFLICT(project_name, visitor_hash) DO UPDATE SET
					last_visit = CURRENT_TIMESTAMP,
					visit_count = visit_count + 1
			`,
			)
				.bind(projectName, visitorHash)
				.run();

			// Get unique count efficiently
			const uniqueResult = await c.env.DB.prepare(
				"SELECT COUNT(*) as count FROM visitor_tracking WHERE project_name = ?",
			)
				.bind(projectName)
				.first();

			uniqueViews = Number(uniqueResult?.count) || 0;

			// Update unique views count
			await c.env.DB.prepare(
				"UPDATE project_views SET unique_views = ? WHERE project_name = ?",
			)
				.bind(uniqueViews, projectName)
				.run();
		}

		// Optional: remember where the view came from. Off by default because
		// it is a second write on every single view.
		if (c.env.TRACK_BREAKDOWN === "true") {
			await c.env.DB.prepare(
				`
				INSERT INTO view_breakdown (day, project_name, country, referrer_host, view_count)
				VALUES (DATE('now'), ?, ?, ?, 1)
				ON CONFLICT(day, project_name, country, referrer_host) DO UPDATE SET
					view_count = view_count + 1
			`,
			)
				.bind(
					projectName,
					readCountry(c.req.raw),
					readReferrerHost(c.req.raw),
				)
				.run();
		}

		// Get final count with minimal query
		const result = await c.env.DB.prepare(
			"SELECT view_count FROM project_views WHERE project_name = ?",
		)
			.bind(projectName)
			.first();

		return c.json({
			success: true,
			projectName,
			totalViews: result?.view_count || 1,
			uniqueViews,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Webhook error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

app.post("/api/events", customRateLimiter, async (c) => {
	let body: { category?: string; event?: string; metadata?: unknown }
	try {
		body = await c.req.json()
	} catch {
		return c.json({ success: false, error: "Invalid JSON body" }, 400)
	}

	const { category, event: eventName, metadata } = body
	if (
		!category ||
		!eventName ||
		typeof category !== "string" ||
		typeof eventName !== "string" ||
		category.length > 64 ||
		eventName.length > 64
	) {
		return c.json(
			{ success: false, error: "Invalid category or event name" },
			400
		)
	}

	await initDatabase(c.env.DB)
	const visitorHash = generateVisitorHash(c.req.raw)

	try {
		await c.env.DB.prepare(`
			INSERT INTO event_logs (event_category, event_name, session_id, metadata_json)
			VALUES (?, ?, ?, ?)
		`)
			.bind(
				category,
				eventName,
				visitorHash,
				metadata != null ? JSON.stringify(metadata) : null
			)
			.run()

		await trackUsage(c.env)

		return c.json({
			success: true,
			category,
			event: eventName,
			timestamp: new Date().toISOString(),
		})
	} catch (error) {
		console.error("Event log error:", error)
		return c.json({ success: false, error: "Database error" }, 500)
	}
})

app.get("/api/metrics", edgeCache(60), customRateLimiter, async (c) => {
	try {
		await initDatabase(c.env.DB)

		const rows = await c.env.DB.prepare(`
			SELECT event_category, event_name, COUNT(*) as count
			FROM event_logs
			GROUP BY event_category, event_name
			ORDER BY count DESC
			LIMIT 100
		`).all()

		const byCategory: Record<string, Record<string, number>> = {}
		for (const row of rows.results as {
			event_category: string
			event_name: string
			count: number
		}[]) {
			if (!byCategory[row.event_category]) {
				byCategory[row.event_category] = {}
			}
			const cat = byCategory[row.event_category];
			if (cat) {
				cat[row.event_name] = row.count;
			}
		}

		return c.json({
			success: true,
			metrics: byCategory,
			timestamp: new Date().toISOString(),
		})
	} catch (error) {
		console.error("Metrics error:", error)
		return c.json({ success: false, error: "Database error" }, 500)
	}
})

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

// ---------------------------------------------------------------------------
// Install / download count aggregation
//
// Every number returned below comes from a live upstream API response. Nothing
// is estimated, and a stale cached value is never presented as a fresh one - it
// comes back with `stale: true` and its original fetchedAt.
// ---------------------------------------------------------------------------

// 6 hours. Override with the INSTALL_CACHE_TTL binding (seconds).
const DEFAULT_INSTALL_CACHE_TTL = 21600;

type InstallSourceId =
	| "vscode"
	| "openvsx"
	| "pypi"
	| "github"
	| "npm"
	| "crates";

const INSTALL_SOURCES: InstallSourceId[] = [
	"vscode",
	"openvsx",
	"pypi",
	"github",
	"npm",
	"crates",
];

// `window: "all-time"` sources report a cumulative lifetime figure.
// `window: "last_month"` sources only publish a rolling window - PyPI and npm
// expose nothing else - so a total that mixes the two is flagged with
// `mixedWindows` rather than passed off as one comparable number.
const INSTALL_SOURCE_META: Record<
	InstallSourceId,
	{ label: string; window: string; measures: string }
> = {
	vscode: {
		label: "VS Code Marketplace",
		window: "all-time",
		measures: "installs",
	},
	openvsx: { label: "Open VSX", window: "all-time", measures: "downloads" },
	pypi: { label: "PyPI", window: "last_month", measures: "downloads" },
	github: {
		label: "GitHub releases",
		window: "all-time",
		measures: "release asset downloads",
	},
	npm: { label: "npm", window: "last_month", measures: "downloads" },
	crates: { label: "crates.io", window: "all-time", measures: "downloads" },
};

const isInstallSource = (value: string): value is InstallSourceId =>
	(INSTALL_SOURCES as string[]).includes(value);

const installFetchInit = (
	extraHeaders?: Record<string, string>,
): RequestInit => ({
	// GitHub rejects requests with no User-Agent; the others tolerate one.
	headers: {
		"User-Agent": "ViewFlare/1.0 (+https://counter.vkrishna04.me)",
		...(extraHeaders || {}),
	},
	signal: AbortSignal.timeout(8000),
});

// Each fetcher returns a real number read out of the upstream payload, or throws.

const fetchVscodeInstalls = async (id: string): Promise<number> => {
	const response = await fetch(
		"https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
		{
			...installFetchInit({
				Accept: "application/json;api-version=3.0-preview.1",
				"Content-Type": "application/json",
			}),
			method: "POST",
			body: JSON.stringify({
				filters: [
					{
						criteria: [{ filterType: 7, value: id }],
						pageNumber: 1,
						pageSize: 1,
					},
				],
				flags: 914,
			}),
		},
	);
	if (!response.ok) throw new Error(`Marketplace HTTP ${response.status}`);
	const data: any = await response.json();
	const extension = data?.results?.[0]?.extensions?.[0];
	if (!extension) {
		throw new Error(`extension "${id}" not found on the Marketplace`);
	}
	const stat = (extension.statistics || []).find(
		(entry: any) => entry.statisticName === "install",
	);
	if (!stat || typeof stat.value !== "number") {
		throw new Error("no install statistic in Marketplace response");
	}
	return Math.round(stat.value);
};

const fetchOpenVsxDownloads = async (id: string): Promise<number> => {
	const [namespace, name] = id.split("/");
	if (!namespace || !name) {
		throw new Error('Open VSX id must be "namespace/extension"');
	}
	const response = await fetch(
		`https://open-vsx.org/api/${encodeURIComponent(
			namespace,
		)}/${encodeURIComponent(name)}`,
		installFetchInit({ Accept: "application/json" }),
	);
	if (!response.ok) throw new Error(`Open VSX HTTP ${response.status}`);
	const data: any = await response.json();
	if (typeof data?.downloadCount !== "number") {
		throw new Error("no downloadCount in Open VSX response");
	}
	return data.downloadCount;
};

const fetchPypiDownloads = async (id: string): Promise<number> => {
	// The PyPI JSON API still reports downloads as -1 ("not available"), so
	// pypistats is the only place a real figure comes from. It publishes rolling
	// windows only; last_month is the one reported here.
	const response = await fetch(
		`https://pypistats.org/api/packages/${encodeURIComponent(id)}/recent`,
		installFetchInit({ Accept: "application/json" }),
	);
	if (!response.ok) throw new Error(`pypistats HTTP ${response.status}`);
	const data: any = await response.json();
	const count = data?.data?.last_month;
	if (typeof count !== "number" || count < 0) {
		throw new Error("no last_month figure in pypistats response");
	}
	return count;
};

const fetchGithubReleaseDownloads = async (id: string): Promise<number> => {
	// Unauthenticated GitHub allows 60 requests/hour per egress IP, and Workers
	// share IPs - the cache in front of this is what keeps it usable.
	let total = 0;
	for (let page = 1; page <= 3; page++) {
		const response = await fetch(
			`https://api.github.com/repos/${id}/releases?per_page=100&page=${page}`,
			installFetchInit({ Accept: "application/vnd.github+json" }),
		);
		if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
		const releases: any = await response.json();
		if (!Array.isArray(releases)) {
			throw new Error("unexpected GitHub releases response");
		}
		for (const release of releases) {
			for (const asset of release.assets || []) {
				total += Number(asset.download_count) || 0;
			}
		}
		if (releases.length < 100) break;
	}
	return total;
};

const fetchNpmDownloads = async (id: string): Promise<number> => {
	const response = await fetch(
		`https://api.npmjs.org/downloads/point/last-month/${id}`,
		installFetchInit({ Accept: "application/json" }),
	);
	if (!response.ok) throw new Error(`npm HTTP ${response.status}`);
	const data: any = await response.json();
	if (typeof data?.downloads !== "number") {
		throw new Error("no downloads figure in npm response");
	}
	return data.downloads;
};

const fetchCratesDownloads = async (id: string): Promise<number> => {
	// crates.io returns 403 without an identifying User-Agent; installFetchInit
	// sends one for every source.
	const response = await fetch(
		`https://crates.io/api/v1/crates/${encodeURIComponent(id)}`,
		installFetchInit({ Accept: "application/json" }),
	);
	if (!response.ok) throw new Error(`crates.io HTTP ${response.status}`);
	const data: any = await response.json();
	if (typeof data?.crate?.downloads !== "number") {
		throw new Error("no downloads figure in crates.io response");
	}
	return data.crate.downloads;
};

const fetchInstallCount = async (
	source: InstallSourceId,
	id: string,
): Promise<number> => {
	switch (source) {
		case "vscode":
			return fetchVscodeInstalls(id);
		case "openvsx":
			return fetchOpenVsxDownloads(id);
		case "pypi":
			return fetchPypiDownloads(id);
		case "github":
			return fetchGithubReleaseDownloads(id);
		case "npm":
			return fetchNpmDownloads(id);
		case "crates":
			return fetchCratesDownloads(id);
	}
};

type InstallSourceResult = {
	source: InstallSourceId;
	label: string;
	id: string;
	measures: string;
	window: string;
	count: number | null;
	fetchedAt: string | null;
	stale: boolean;
	ok: boolean;
	error?: string;
};

// D1's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC.
const parseSqlTimestamp = (value: unknown): number => {
	if (!value) return NaN;
	return Date.parse(`${String(value).replace(" ", "T")}Z`);
};

const collectInstallCounts = async (
	env: Bindings,
	projectName: string,
): Promise<{ configured: number; results: InstallSourceResult[] }> => {
	const configuredRows = await env.DB.prepare(
		"SELECT source, config FROM install_sources WHERE project_name = ? ORDER BY source",
	)
		.bind(projectName)
		.all();

	const rows = (configuredRows.results || []) as any[];
	if (rows.length === 0) return { configured: 0, results: [] };

	const cachedRows = await env.DB.prepare(
		"SELECT source, count, fetched_at FROM install_cache WHERE project_name = ?",
	)
		.bind(projectName)
		.all();
	const cacheBySource = new Map<string, any>();
	for (const row of (cachedRows.results || []) as any[]) {
		cacheBySource.set(String(row.source), row);
	}

	const ttlSeconds = Math.max(
		60,
		parseInt(env.INSTALL_CACHE_TTL || "", 10) || DEFAULT_INSTALL_CACHE_TTL,
	);
	const now = Date.now();

	// One dead upstream must not take the whole response down, so every source
	// is fetched independently and failures are reported per source.
	const settled = await Promise.allSettled(
		rows.map(async (row): Promise<InstallSourceResult> => {
			const source = String(row.source) as InstallSourceId;
			const meta = INSTALL_SOURCE_META[source];
			const id = String(row.config);
			const base = {
				source,
				label: meta.label,
				id,
				measures: meta.measures,
				window: meta.window,
			};

			const cacheRow = cacheBySource.get(source);
			const cachedAt = parseSqlTimestamp(cacheRow?.fetched_at);
			const hasCache =
				cacheRow != null &&
				cacheRow.count !== null &&
				Number.isFinite(cachedAt);

			if (hasCache && now - cachedAt < ttlSeconds * 1000) {
				return {
					...base,
					count: Number(cacheRow.count),
					fetchedAt: new Date(cachedAt).toISOString(),
					stale: false,
					ok: true,
				};
			}

			try {
				const count = await fetchInstallCount(source, id);
				const fetchedAt = new Date().toISOString();
				await env.DB.prepare(
					`
					INSERT INTO install_cache (project_name, source, count, fetched_at)
					VALUES (?, ?, ?, CURRENT_TIMESTAMP)
					ON CONFLICT(project_name, source) DO UPDATE SET
						count = excluded.count,
						fetched_at = CURRENT_TIMESTAMP
					`,
				)
					.bind(projectName, source, count)
					.run();
				return { ...base, count, fetchedAt, stale: false, ok: true };
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "upstream request failed";
				// An expired cache entry is better than nothing, but it is labelled.
				if (hasCache) {
					return {
						...base,
						count: Number(cacheRow.count),
						fetchedAt: new Date(cachedAt).toISOString(),
						stale: true,
						ok: true,
						error: message,
					};
				}
				return {
					...base,
					count: null,
					fetchedAt: null,
					stale: false,
					ok: false,
					error: message,
				};
			}
		}),
	);

	const results = settled.map((outcome, index) => {
		if (outcome.status === "fulfilled") return outcome.value;
		const source = String(rows[index].source) as InstallSourceId;
		const meta = INSTALL_SOURCE_META[source];
		return {
			source,
			label: meta.label,
			id: String(rows[index].config),
			measures: meta.measures,
			window: meta.window,
			count: null,
			fetchedAt: null,
			stale: false,
			ok: false,
			error: "source handler failed",
		} as InstallSourceResult;
	});

	return { configured: rows.length, results };
};

const summariseInstalls = (results: InstallSourceResult[]) => {
	const answered = results.filter(
		(result) => result.ok && typeof result.count === "number",
	);
	// Nothing answered and nothing was cached: report null, never 0.
	const total =
		answered.length > 0
			? answered.reduce((sum, result) => sum + (result.count as number), 0)
			: null;
	const windows = new Set(answered.map((result) => result.window));
	return {
		total,
		answered: answered.length,
		mixedWindows: windows.size > 1,
	};
};

// One label builder for every surface, so the JSON endpoint, the SVG badge and
// shields.json can never disagree about how much the total actually covers. It
// never claims "all registries" while a source is missing, and it says so when
// an all-time count and a rolling window have been added together.
const buildInstallLabel = (
	configured: number,
	summary: { answered: number; mixedWindows: boolean },
): string => {
	const parts: string[] = [];
	if (summary.answered < configured) {
		parts.push(`${summary.answered} of ${configured} registries`);
	} else if (summary.answered > 1) {
		parts.push("all registries");
	}
	if (summary.mixedWindows) parts.push("mixed windows");
	return parts.length > 0 ? `installs (${parts.join(", ")})` : "installs";
};

// Shields.io-compatible colour names, shared by every badge route.
const BADGE_COLORS: Record<string, string> = {
	blue: "#007ec6",
	brightgreen: "#44cc11",
	green: "#97ca00",
	yellowgreen: "#a4a61d",
	yellow: "#dfb317",
	orange: "#fe7d37",
	red: "#e05d44",
	lightgrey: "#9f9f9f",
	success: "#44cc11",
	important: "#fe7d37",
	critical: "#e05d44",
	informational: "#007ec6",
	inactive: "#9f9f9f",
};

const BADGE_DEFAULT_COLOR = "#007ec6"; // BADGE_COLORS.blue

const resolveBadgeColor = (rawColor: string): string =>
	BADGE_COLORS[rawColor] ||
	normalizeBadgeColor(rawColor) ||
	BADGE_DEFAULT_COLOR;

// Badge text only, the way shields.io shortens it. Every JSON API response
// keeps the exact integer; this is what stops a five-figure count from
// stretching the SVG. Shared by the views badge, the installs badge and
// shields.json so no two badge surfaces can disagree about the same number.
const formatCompactCount = (value: number): string => {
	if (value >= 1000000000) return `${(value / 1000000000).toFixed(1)}B`;
	if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
	if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
	return value.toString();
};

const BADGE_STYLES = ["flat", "flat-square", "for-the-badge"];

// Renders the badge SVG. Extracted verbatim from the views badge route so the
// installs badge is pixel-identical to it; the views badge output is unchanged.
const renderBadgeSvg = (
	rawLabel: string,
	valueTextRaw: string,
	badgeColor: string,
	style: string,
): string => {
	const safeLabel = escapeXml(rawLabel);
	const safeValueText = escapeXml(valueTextRaw);

	// Calculate widths dynamically
	const labelWidth = Math.max(verdanaWidth(rawLabel) + 12, 40);
	const valueWidth = Math.max(verdanaWidth(valueTextRaw) + 12, 30);
	const totalWidth = labelWidth + valueWidth;

	let svg = "";

	if (style === "flat") {
		// Modern flat style (shields.io default)
		svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${safeLabel}: ${safeValueText}">
	<title>${safeLabel}: ${safeValueText}</title>
	<linearGradient id="s" x2="0" y2="100%">
		<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
		<stop offset="1" stop-opacity=".1"/>
	</linearGradient>
	<clipPath id="r">
		<rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
	</clipPath>
	<g clip-path="url(#r)">
		<rect width="${labelWidth}" height="20" fill="#555"/>
		<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${badgeColor}"/>
		<rect width="${totalWidth}" height="20" fill="url(#s)"/>
	</g>
	<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
		<text aria-hidden="true" x="${
			(labelWidth / 2) * 10
		}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${
			(labelWidth - 10) * 10
		}">${safeLabel}</text>
		<text x="${
			(labelWidth / 2) * 10
		}" y="140" transform="scale(.1)" fill="#fff" textLength="${
			(labelWidth - 10) * 10
		}">${safeLabel}</text>
		<text aria-hidden="true" x="${
			(labelWidth + valueWidth / 2) * 10
		}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${
			(valueWidth - 10) * 10
		}">${safeValueText}</text>
		<text x="${
			(labelWidth + valueWidth / 2) * 10
		}" y="140" transform="scale(.1)" fill="#fff" textLength="${
			(valueWidth - 10) * 10
		}">${safeValueText}</text>
	</g>
</svg>`;
	} else if (style === "flat-square") {
		// Flat square style (no rounded corners)
		svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${safeLabel}: ${safeValueText}">
	<title>${safeLabel}: ${safeValueText}</title>
	<g shape-rendering="crispEdges">
		<rect width="${labelWidth}" height="20" fill="#555"/>
		<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${badgeColor}"/>
	</g>
	<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
		<text x="${
			(labelWidth / 2) * 10
		}" y="140" transform="scale(.1)" fill="#fff" textLength="${
			(labelWidth - 10) * 10
		}">${safeLabel}</text>
		<text x="${
			(labelWidth + valueWidth / 2) * 10
		}" y="140" transform="scale(.1)" fill="#fff" textLength="${
			(valueWidth - 10) * 10
		}">${safeValueText}</text>
	</g>
</svg>`;
	} else if (style === "for-the-badge") {
		// Bold style with larger text
		const boldHeight = 28;
		svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${boldHeight}" role="img" aria-label="${safeLabel}: ${safeValueText}">
	<title>${safeLabel}: ${safeValueText}</title>
	<g shape-rendering="crispEdges">
		<rect width="${labelWidth}" height="${boldHeight}" fill="#555"/>
		<rect x="${labelWidth}" width="${valueWidth}" height="${boldHeight}" fill="${badgeColor}"/>
	</g>
	<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="100" font-weight="bold">
		<text x="${
			(labelWidth / 2) * 10
		}" y="175" transform="scale(.1)" fill="#fff" textLength="${
			(labelWidth - 10) * 10
		}">${safeLabel.toUpperCase()}</text>
		<text x="${
			(labelWidth + valueWidth / 2) * 10
		}" y="175" transform="scale(.1)" fill="#fff" textLength="${
			(valueWidth - 10) * 10
		}">${safeValueText}</text>
	</g>
</svg>`;
	} else {
		// Default to flat style
		svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
	<rect width="${labelWidth}" height="20" fill="#555"/>
	<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${badgeColor}"/>
	<text x="${labelWidth / 2}" y="14" fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle">${safeLabel}</text>
	<text x="${
		labelWidth + valueWidth / 2
	}" y="14" fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle">${safeValueText}</text>
</svg>`;
	}

	return svg;
};

// Generate SVG badge for project views
// Shields.io style with better aesthetics
app.get("/api/views/:projectName/badge", edgeCache(60), async (c) => {
	const projectName = c.req.param("projectName");
	const styleParam = (c.req.query("style") || "flat").toLowerCase(); // flat, flat-square, for-the-badge
	const style = BADGE_STYLES.includes(styleParam) ? styleParam : "flat";
	const color = (c.req.query("color") || "blue").toLowerCase();
	const rawLabel = (c.req.query("label") || "views").slice(0, 24);

	if (!projectName || projectName.length > 100) {
		return c.text("Invalid project name", 400);
	}

	await initDatabase(c.env.DB);

	try {
		// Increment the view count only when inc=true query param is explicitly passed
		const shouldIncrement = c.req.query("inc") === "true";
		if (shouldIncrement) {
			await c.env.DB.prepare(
				`
				INSERT INTO project_views (project_name, view_count, updated_at)
				VALUES (?, 1, CURRENT_TIMESTAMP)
				ON CONFLICT(project_name) DO UPDATE SET
					view_count = view_count + 1,
					updated_at = CURRENT_TIMESTAMP
				`,
			)
				.bind(projectName)
				.run();

			// Track usage for monitoring
			await trackUsage(c.env);

			// Track unique visitor if analytics enabled
			const enableAnalytics = c.env.ENABLE_ANALYTICS !== "false";
			if (enableAnalytics) {
				const visitorHash = generateVisitorHash(c.req.raw);
				await c.env.DB.prepare(
					`
					INSERT INTO visitor_tracking (project_name, visitor_hash, last_visit, visit_count)
					VALUES (?, ?, CURRENT_TIMESTAMP, 1)
					ON CONFLICT(project_name, visitor_hash) DO UPDATE SET
						last_visit = CURRENT_TIMESTAMP,
						visit_count = visit_count + 1
					`,
				)
					.bind(projectName, visitorHash)
					.run();

				const uniqueResult = await c.env.DB.prepare(
					"SELECT COUNT(*) as count FROM visitor_tracking WHERE project_name = ?",
				)
					.bind(projectName)
					.first();

				const uniqueViews = Number(uniqueResult?.count) || 0;

				await c.env.DB.prepare(
					"UPDATE project_views SET unique_views = ? WHERE project_name = ?",
				)
					.bind(uniqueViews, projectName)
					.run();
			}
		}

		let viewCount: number;
		if (wantsRollup(c)) {
			viewCount = (await readSubtreeViews(c.env.DB, projectName)).totalViews;
		} else {
			const result = await c.env.DB.prepare(
				"SELECT view_count FROM project_views WHERE project_name = ?",
			)
				.bind(projectName)
				.first();
			viewCount = Number(result?.view_count) || 0;
		}

		const valueTextRaw = formatCompactCount(viewCount);

		const badgeColor = resolveBadgeColor(color);
		const svg = renderBadgeSvg(rawLabel, valueTextRaw, badgeColor, style);

		c.header("Content-Type", "image/svg+xml");
		c.header(
			"Cache-Control",
			"public, max-age=60, stale-while-revalidate=86400",
		);
		c.header("Access-Control-Allow-Origin", "*");
		return c.body(svg.trim());
	} catch (error) {
		console.error("Badge generation error:", error);
		return c.text("Error generating badge", 500);
	}
});

app.get("/api/views/:projectName/history", edgeCache(300), async (c) => {
	const projectName = c.req.param("projectName")
	if (!projectName || projectName.length > 100) {
		return c.json({ error: "Invalid project name" }, 400)
	}

	await initDatabase(c.env.DB)

	try {
		// series=snapshots reads the daily rows written by
		// POST /api/admin/installs/snapshot: a real running total per day.
		// The default stays the visitor-derived view this endpoint has always
		// returned, so existing callers see the same shape.
		if (c.req.query("series") === "snapshots") {
			const days = parseHistoryDays(c.req.query("days"), 90)
			const bucket = parseHistoryBucket(c.req.query("bucket"))
			const snapshotRows = await c.env.DB.prepare(`
				SELECT day, view_count, unique_views
				FROM view_snapshots
				WHERE project_name = ?
					AND day >= DATE('now', ?)
				ORDER BY day ASC
			`)
				.bind(projectName, `-${days} days`)
				.all()

			const raw = ((snapshotRows.results || []) as any[]).map((row) => ({
				day: String(row.day),
				value: Number(row.view_count),
				uniqueViews: Number(row.unique_views) || 0,
			}))
			const points = bucketSeries(raw, bucket)

			c.header("Cache-Control", "public, max-age=900")
			c.header("Access-Control-Allow-Origin", "*")
			return c.json({
				success: true,
				projectName,
				series: "snapshots",
				days,
				bucket,
				summary: summariseSeries(points),
				points,
			})
		}

		// series=breakdown reads view_breakdown, which only has rows if the
		// instance runs with TRACK_BREAKDOWN=true. An instance that never
		// collected this answers with an empty list and enabled: false, so a
		// caller can tell "nobody visited" apart from "nothing was recorded".
		if (c.req.query("series") === "breakdown") {
			const days = parseHistoryDays(c.req.query("days"), 30)
			const by = c.req.query("by") === "referrer" ? "referrer" : "country"
			const column = by === "referrer" ? "referrer_host" : "country"

			const breakdownRows = await c.env.DB.prepare(`
				SELECT ${column} AS key, SUM(view_count) AS views
				FROM view_breakdown
				WHERE project_name = ?
					AND day >= DATE('now', ?)
				GROUP BY ${column}
				ORDER BY views DESC
				LIMIT 100
			`)
				.bind(projectName, `-${days} days`)
				.all()

			const buckets = ((breakdownRows.results || []) as any[]).map((row) => ({
				// "unknown" means the signal was missing, so it leaves as null
				// rather than as a value someone might chart as real.
				key: String(row.key) === "unknown" ? null : String(row.key),
				views: Number(row.views) || 0,
			}))
			const total = buckets.reduce((sum, bucket) => sum + bucket.views, 0)

			c.header("Cache-Control", "public, max-age=900")
			c.header("Access-Control-Allow-Origin", "*")
			return c.json({
				success: true,
				projectName,
				series: "breakdown",
				by,
				days,
				enabled: c.env.TRACK_BREAKDOWN === "true",
				total,
				buckets,
			})
		}

		const rows = await c.env.DB.prepare(`
			SELECT DATE(last_visit) as date, COUNT(*) as visits
			FROM visitor_tracking
			WHERE project_name = ?
				AND last_visit >= datetime('now', '-30 days')
			GROUP BY DATE(last_visit)
			ORDER BY date ASC
		`)
			.bind(projectName)
			.all()

		return c.json({
			success: true,
			projectName,
			series: "visitors",
			history: rows.results,
		})
	} catch (error) {
		console.error("History error:", error)
		return c.json({ success: false, error: "Database error" }, 500)
	}
})

// Where a view came from. Both readers answer "unknown" rather than guessing:
// CF-IPCountry is absent under `wrangler pages dev` and on some Cloudflare
// plans, and a referrer can be stripped by the browser's referrer policy.
const readCountry = (request: Request): string => {
	const raw = (request.headers.get("CF-IPCountry") || "").toUpperCase();
	// T1 is Cloudflare's code for a Tor exit, XX for "could not determine".
	if (!/^[A-Z]{2}$/.test(raw) || raw === "XX" || raw === "T1") return "unknown";
	return raw;
};

const readReferrerHost = (request: Request): string => {
	const referer = request.headers.get("Referer");
	if (!referer) return "none";
	try {
		return new URL(referer).hostname.toLowerCase() || "unknown";
	} catch {
		return "unknown";
	}
};

// Usage tracking helper
// One extra D1 write per tracked view, duplicating numbers the Cloudflare
// dashboard already reports. Off unless TRACK_USAGE is "true".
const trackUsage = async (env: Bindings) => {
	if (env.TRACK_USAGE !== "true") {
		return;
	}

	const today = new Date().toISOString().split("T")[0];
	try {
		await env.DB
			.prepare(
				`
			INSERT INTO usage_stats (date, requests_count, rows_read, rows_written)
			VALUES (?, 1, 1, 1)
			ON CONFLICT(date) DO UPDATE SET
				requests_count = requests_count + 1,
				rows_read = rows_read + 1,
				rows_written = rows_written + 1,
				updated_at = CURRENT_TIMESTAMP
		`,
			)
			.bind(today)
			.run();
	} catch (error) {
		// Silently fail to avoid impacting main functionality
		console.warn("Usage tracking failed:", error);
	}
};

// Public: Get global statistics (no authentication required)
app.get("/api/stats", edgeCache(300), async (c) => {
	try {
		await initDatabase(c.env.DB);

		// Get total statistics
		const stats = await c.env.DB.prepare(
			`
			SELECT
				COALESCE(SUM(view_count), 0) as total_views,
				COALESCE(SUM(unique_views), 0) as unique_views,
				COUNT(*) as total_projects
			FROM project_views
		`,
		).first();

		const enableAnalytics = c.env.ENABLE_ANALYTICS !== "false";

		return c.json({
			success: true,
			statistics: {
				totalViews: stats?.total_views || 0,
				uniqueViews: enableAnalytics ? stats?.unique_views || 0 : null,
				totalProjects: stats?.total_projects || 0,
				analyticsEnabled: enableAnalytics,
			},
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Stats error:", error);
		return c.json(
			{ success: false, error: "Failed to fetch statistics" },
			500,
		);
	}
});

// Admin: Get enhanced project statistics (POST for password in body)
app.post("/api/admin/stats", async (c) => {
	try {
		// Get password from request body
		const body = await c.req.json();
		const password = body.password;

		const adminPassword = c.env.ADMIN_PASSWORD;
		const enableAdmin = c.env.ENABLE_ADMIN !== "false";

		// 🔧 DEBUG: Log admin authentication status only if DEBUG is enabled (never log passwords)
		if (c.env.DEBUG === "true") {
			console.log("🔧 [DEBUG] Admin Authentication Check:");
			console.log("  - Admin Enabled:", enableAdmin);
			console.log("  - Password Provided:", !!password);
			console.log("  - Password Match:", password === adminPassword);
		}
		if (!enableAdmin) {
			return c.json(
				{
					success: false,
					error: "Admin functionality is disabled",
				},
				403,
			);
		}

		if (!password || password !== adminPassword) {
			return c.json(
				{
					success: false,
					error: "Unauthorized - Invalid admin password",
				},
				401,
			);
		}

		await initDatabase(c.env.DB);
		await trackUsage(c.env);

		// Get total statistics
		const stats = await c.env.DB.prepare(
			`
			SELECT
				COALESCE(SUM(view_count), 0) as total_views,
				COALESCE(SUM(unique_views), 0) as unique_views,
				COUNT(*) as total_projects
			FROM project_views
		`,
		).first();

		// Get top projects
		const topProjects = await c.env.DB.prepare(
			`
			SELECT project_name, view_count, unique_views, description, updated_at
			FROM project_views
			ORDER BY view_count DESC
			LIMIT 10
		`,
		).all();

		return c.json({
			success: true,
			statistics: {
				totalViews: stats?.total_views || 0,
				uniqueViews: stats?.unique_views || 0,
				totalProjects: stats?.total_projects || 0,
				uptime: "99.9%", // Static for now
				name: "VKrishna04",
			},
			projects: topProjects.results,
			todayRequests: 0,
			dbOperations: 0,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Admin stats error:", error);
		return c.json({ success: false, error: "Invalid request" }, 400);
	}
});

// Admin: List projects (requires admin password)
app.get("/api/admin/projects", async (c) => {
	try {
		const authHeader = c.req.header("Authorization");
		const headerPassword = c.req.header("X-Admin-Password");
		const queryPassword = c.req.query("password");

		let password = headerPassword || queryPassword || "";
		if (!password && authHeader && authHeader.startsWith("Bearer ")) {
			password = authHeader.substring(7);
		}

		const adminPassword = c.env.ADMIN_PASSWORD;
		const enableAdmin = c.env.ENABLE_ADMIN !== "false";

		if (!enableAdmin) {
			return c.json(
				{
					success: false,
					error: "Admin functionality is disabled",
				},
				403,
			);
		}

		if (!password || password !== adminPassword) {
			return c.json(
				{
					success: false,
					error: "Unauthorized - Invalid admin password",
				},
				401,
			);
		}

		await initDatabase(c.env.DB);
		await trackUsage(c.env);

		const projects = await c.env.DB.prepare(
			`SELECT
				project_name,
				view_count,
				unique_views,
				description,
				created_at,
				updated_at
			FROM project_views
			ORDER BY updated_at DESC`,
		).all();

		return c.json({
			success: true,
			projects: projects.results || [],
			totalProjects: projects.results?.length || 0,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Admin projects error:", error);
		return c.json(
			{
				success: false,
				error: "Failed to fetch projects",
			},
			500,
		);
	}
});

// Admin: Delete a project (requires admin password)
app.delete("/api/views/:projectName", async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ error: "Invalid project name" }, 400);
	}

	try {
		// Get admin password from request header or body
		const authHeader = c.req.header("Authorization");
		let password = "";

		if (authHeader && authHeader.startsWith("Bearer ")) {
			password = authHeader.substring(7);
		} else {
			// Try to get from body if not in header
			try {
				const body = await c.req.json();
				password = body.password;
			} catch {
				// Body parsing failed, password remains empty
			}
		}

		const adminPassword = c.env.ADMIN_PASSWORD;
		const enableAdmin = c.env.ENABLE_ADMIN !== "false";

		if (c.env.DEBUG === "true") {
			console.log("🔧 [DEBUG] Delete Project Authentication:");
			console.log("  - Project Name:", projectName);
			console.log("  - Admin Enabled:", enableAdmin);
			console.log("  - Password Provided:", !!password);
			console.log("  - Password Match:", password === adminPassword);
		}
		if (!enableAdmin) {
			return c.json(
				{
					success: false,
					error: "Admin functionality is disabled",
				},
				403,
			);
		}

		if (!password || password !== adminPassword) {
			return c.json(
				{
					success: false,
					error: "Unauthorized - Invalid admin password",
				},
				401,
			);
		}

		await initDatabase(c.env.DB);

		// Check if project exists
		const existingProject = await c.env.DB.prepare(
			"SELECT project_name FROM project_views WHERE project_name = ?",
		)
			.bind(projectName)
			.first();

		if (!existingProject) {
			return c.json(
				{
					success: false,
					error: "Project not found",
				},
				404,
			);
		}

		// Delete from both tables
		await c.env.DB.prepare(
			"DELETE FROM project_views WHERE project_name = ?",
		)
			.bind(projectName)
			.run();

		await c.env.DB.prepare(
			"DELETE FROM visitor_tracking WHERE project_name = ?",
		)
			.bind(projectName)
			.run();

		await trackUsage(c.env);

		return c.json({
			success: true,
			message: `Project "${projectName}" deleted successfully`,
			projectName,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Delete project error:", error);
		return c.json(
			{
				success: false,
				error: "Failed to delete project",
			},
			500,
		);
	}
});

// Admin: Update a project. Rename, change description, set view/unique counts
app.put("/api/admin/projects/:projectName", async (c) => {
	const originalName = c.req.param("projectName");
	if (!originalName || originalName.length > 100) {
		return c.json({ error: "Invalid project name" }, 400);
	}

	try {
		const body = await c.req.json();
		const { newName, description, viewCount, uniqueViews } = body;

		// Extract password from body, or Authorization: Bearer / X-Admin-Password header
		let password = body.password;
		if (!password) {
			const authHeader = c.req.header("Authorization");
			const headerPassword = c.req.header("X-Admin-Password");
			if (authHeader && authHeader.startsWith("Bearer ")) {
				password = authHeader.substring(7);
			} else if (headerPassword) {
				password = headerPassword;
			}
		}

		const adminPassword = c.env.ADMIN_PASSWORD;
		const enableAdmin = c.env.ENABLE_ADMIN !== "false";

		if (!enableAdmin) {
			return c.json({ success: false, error: "Admin functionality is disabled" }, 403);
		}
		if (!password || password !== adminPassword) {
			return c.json({ success: false, error: "Unauthorized - Invalid admin password" }, 401);
		}

		const targetName: string = (newName || originalName).trim();
		if (!PROJECT_NAME_PATTERN.test(targetName) || targetName.length > 100) {
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

		// Check for rename conflict before attempting
		if (targetName !== originalName) {
			const conflict = await c.env.DB.prepare(
				"SELECT 1 FROM project_views WHERE project_name = ?"
			).bind(targetName).first();
			if (conflict) {
				return c.json({ success: false, error: "A project with that name already exists" }, 409);
			}
		}

		if (targetName !== originalName) {
			// Atomic rename: insert new, migrate visitor_tracking, delete old
			await c.env.DB.batch([
				c.env.DB.prepare(
					`INSERT INTO project_views (project_name, view_count, unique_views, description, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
				).bind(targetName, finalViews, finalUnique, finalDesc, current.created_at),
				c.env.DB.prepare(
					"UPDATE visitor_tracking SET project_name = ? WHERE project_name = ?"
				).bind(targetName, originalName),
				c.env.DB.prepare(
					"DELETE FROM project_views WHERE project_name = ?"
				).bind(originalName),
			]);
		} else {
			// Update in place
			await c.env.DB.prepare(
				`UPDATE project_views
				 SET view_count = ?, unique_views = ?, description = ?, updated_at = CURRENT_TIMESTAMP
				 WHERE project_name = ?`
			).bind(finalViews, finalUnique, finalDesc, originalName).run();
		}

		await trackUsage(c.env);

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

// Aggregate install / download counts for a project.
// Partial failure is a normal outcome here, not an error: whatever answered is
// returned with a coverage figure, and the sources that did not are marked.
app.get("/api/installs/:projectName", edgeCache(300), customRateLimiter, async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ success: false, error: "Invalid project name" }, 400);
	}

	await initDatabase(c.env.DB);

	try {
		const { configured, results } = await collectInstallCounts(
			c.env,
			projectName,
		);

		// A project with no sources configured behaves exactly as it did before.
		if (configured === 0) {
			return c.json(
				{
					success: false,
					error: "No install sources configured for this project",
					project: projectName,
					sourcesConfigured: 0,
					sources: [],
				},
				404,
			);
		}

		const summary = summariseInstalls(results);

		c.header("Cache-Control", "public, max-age=300");
		return c.json({
			success: true,
			project: projectName,
			total: summary.total,
			totalLabel: buildInstallLabel(configured, summary),
			// True when a cumulative all-time count is being added to a rolling
			// window figure. The total is still returned, but it is not one
			// comparable number and callers are told so.
			mixedWindows: summary.mixedWindows,
			coverage: `${summary.answered} of ${configured} sources`,
			sourcesConfigured: configured,
			sourcesAnswered: summary.answered,
			complete: summary.answered === configured,
			sources: results,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Install aggregation error:", error);
		return c.json(
			{ success: false, error: "Failed to aggregate install counts" },
			500,
		);
	}
});

// Badge-shaped views of the same aggregate. Both share one resolver so the SVG
// and the shields.io JSON can never disagree about the number or the label.

type InstallBadgeData = {
	label: string;
	message: string;
	unavailable: boolean;
	cacheSeconds: number;
};

// The default label never claims more coverage than the response actually has:
// "all registries" only when every configured source answered.
const resolveInstallBadge = async (
	env: Bindings,
	projectName: string,
): Promise<InstallBadgeData> => {
	const { configured, results } = await collectInstallCounts(
		env,
		projectName,
	);

	if (configured === 0) {
		return {
			label: "installs",
			message: "not configured",
			unavailable: true,
			cacheSeconds: 300,
		};
	}

	const summary = summariseInstalls(results);

	if (summary.total === null) {
		return {
			label: "installs",
			message: "unavailable",
			unavailable: true,
			cacheSeconds: 300,
		};
	}

	return {
		// A badge shows only the total, so the label carries the caveats.
		label: buildInstallLabel(configured, summary),
		message: formatCompactCount(summary.total),
		unavailable: false,
		// A partial or stale answer is re-checked sooner than a complete one.
		cacheSeconds:
			summary.answered < configured || results.some((r) => r.stale)
				? 900
				: 3600,
	};
};

// SVG badge of the aggregate. Same style/colour/label options as the view badge.
// No per-IP rate limit here, matching the existing view badge: GitHub's camo
// proxy fetches from a small pool of IPs, so limiting per IP would break the
// badge for everyone at once. The D1 cache is what protects the upstreams.
app.get("/api/installs/:projectName/badge", edgeCache(300), async (c) => {
	const projectName = c.req.param("projectName");
	const styleParam = (c.req.query("style") || "flat").toLowerCase();
	const style = BADGE_STYLES.includes(styleParam) ? styleParam : "flat";
	const colorParam = c.req.query("color");
	const labelParam = c.req.query("label");

	if (!projectName || projectName.length > 100) {
		return c.text("Invalid project name", 400);
	}

	await initDatabase(c.env.DB);

	try {
		const badge = await resolveInstallBadge(c.env, projectName);

		// A caller-supplied label wins - it is their README. The default is the
		// one that states the coverage.
		// Only a caller-supplied label is truncated. The default one states the
		// coverage and must not be cut off mid-caveat.
		const rawLabel = labelParam ? labelParam.slice(0, 40) : badge.label;
		const badgeColor = resolveBadgeColor(
			(
				colorParam || (badge.unavailable ? "lightgrey" : "blue")
			).toLowerCase(),
		);
		const svg = renderBadgeSvg(rawLabel, badge.message, badgeColor, style);

		c.header("Content-Type", "image/svg+xml");
		// GitHub's camo proxy refetches these constantly; the numbers move slowly.
		c.header(
			"Cache-Control",
			`public, max-age=${badge.cacheSeconds}, stale-while-revalidate=86400`,
		);
		c.header("Access-Control-Allow-Origin", "*");
		return c.body(svg.trim());
	} catch (error) {
		console.error("Install badge error:", error);
		return c.text("Error generating badge", 500);
	}
});

// shields.io endpoint-badge format, for people who would rather keep rendering
// their badges at shields.io: https://shields.io/badges/endpoint-badge
app.get(
	"/api/installs/:projectName/shields.json",
	async (c) => {
		const projectName = c.req.param("projectName");
		const colorParam = c.req.query("color");
		const labelParam = c.req.query("label");

		if (!projectName || projectName.length > 100) {
			return c.json(
				{
					schemaVersion: 1,
					label: "installs",
					message: "invalid project",
					color: "lightgrey",
					isError: true,
				},
				400,
			);
		}

		await initDatabase(c.env.DB);

		try {
			const badge = await resolveInstallBadge(c.env, projectName);

			c.header(
				"Cache-Control",
				`public, max-age=${badge.cacheSeconds}, stale-while-revalidate=86400`,
			);
			c.header("Access-Control-Allow-Origin", "*");
			return c.json({
				schemaVersion: 1,
				label: labelParam ? labelParam.slice(0, 40) : badge.label,
				message: badge.message,
				color: colorParam || (badge.unavailable ? "lightgrey" : "blue"),
				isError: badge.unavailable,
				cacheSeconds: badge.cacheSeconds,
			});
		} catch (error) {
			console.error("Install shields.json error:", error);
			return c.json(
				{
					schemaVersion: 1,
					label: "installs",
					message: "error",
					color: "lightgrey",
					isError: true,
				},
				500,
			);
		}
	},
);

// Admin: configure which registries a project is published on.
// Body: { password, sources: { vscode: "publisher.ext", npm: null, ... } }
// A null or empty value removes that source.
app.put("/api/admin/installs/:projectName", async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ success: false, error: "Invalid project name" }, 400);
	}

	try {
		const body = await c.req.json();

		let password = body.password;
		if (!password) {
			const authHeader = c.req.header("Authorization");
			const headerPassword = c.req.header("X-Admin-Password");
			if (authHeader && authHeader.startsWith("Bearer ")) {
				password = authHeader.substring(7);
			} else if (headerPassword) {
				password = headerPassword;
			}
		}

		const adminPassword = c.env.ADMIN_PASSWORD;
		const enableAdmin = c.env.ENABLE_ADMIN !== "false";

		if (!enableAdmin) {
			return c.json(
				{ success: false, error: "Admin functionality is disabled" },
				403,
			);
		}
		if (!password || password !== adminPassword) {
			return c.json(
				{ success: false, error: "Unauthorized - Invalid admin password" },
				401,
			);
		}

		const sources = body.sources;
		if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
			return c.json(
				{ success: false, error: "sources must be an object" },
				400,
			);
		}

		for (const [source, value] of Object.entries(sources)) {
			if (!isInstallSource(source)) {
				return c.json(
					{
						success: false,
						error: `Unknown source "${source}". Supported: ${INSTALL_SOURCES.join(", ")}`,
					},
					400,
				);
			}
			if (value === null || value === "") continue;
			if (typeof value !== "string" || !/^[A-Za-z0-9._/@-]{1,200}$/.test(value)) {
				return c.json(
					{ success: false, error: `Invalid identifier for source "${source}"` },
					400,
				);
			}
		}

		await initDatabase(c.env.DB);

		for (const [source, value] of Object.entries(sources)) {
			if (value === null || value === "") {
				await c.env.DB.prepare(
					"DELETE FROM install_sources WHERE project_name = ? AND source = ?",
				)
					.bind(projectName, source)
					.run();
				await c.env.DB.prepare(
					"DELETE FROM install_cache WHERE project_name = ? AND source = ?",
				)
					.bind(projectName, source)
					.run();
				continue;
			}
			const existing = await c.env.DB.prepare(
				"SELECT config FROM install_sources WHERE project_name = ? AND source = ?",
			)
				.bind(projectName, source)
				.first();

			await c.env.DB.prepare(
				`
				INSERT INTO install_sources (project_name, source, config)
				VALUES (?, ?, ?)
				ON CONFLICT(project_name, source) DO UPDATE SET config = excluded.config
				`,
			)
				.bind(projectName, source, value)
				.run();

			// Pointing at a different package means any cached count for this
			// source is now a count of something else. Drop it.
			if (existing && String(existing.config) !== value) {
				await c.env.DB.prepare(
					"DELETE FROM install_cache WHERE project_name = ? AND source = ?",
				)
					.bind(projectName, source)
					.run();
			}
		}

		const current = await c.env.DB.prepare(
			"SELECT source, config FROM install_sources WHERE project_name = ? ORDER BY source",
		)
			.bind(projectName)
			.all();

		return c.json({
			success: true,
			project: projectName,
			sources: current.results,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Install source config error:", error);
		return c.json({ success: false, error: "Invalid request" }, 400);
	}
});

// ---------------------------------------------------------------------------
// Snapshots
//
// The registries only report a current figure, and two of them (npm, pypi)
// report a rolling last-month window that nothing else can reconstruct later.
// Charting any of it over time means writing down what was true each day.
// Pages Functions have no cron trigger, so the schedule lives in
// .github/workflows/snapshot.yml and calls the endpoint below.
// ---------------------------------------------------------------------------

// The same three ways the other admin routes accept a password: JSON body,
// X-Admin-Password, or an Authorization bearer token.
const resolveAdminPassword = (c: any, body: any): string | undefined => {
	if (body && typeof body.password === "string" && body.password) {
		return body.password;
	}
	const authHeader = c.req.header("Authorization");
	if (authHeader && authHeader.startsWith("Bearer ")) {
		return authHeader.substring(7);
	}
	return c.req.header("X-Admin-Password");
};

// Workers cap the outbound subrequests one incoming request may make, and a
// full sweep is one fetch per project per source. The endpoint therefore walks
// a page of projects at a time and hands back the offset to resume from.
const SNAPSHOT_PROJECT_LIMIT = 20;

app.post("/api/admin/installs/snapshot", async (c) => {
	let body: any = {};
	try {
		body = await c.req.json();
	} catch {
		body = {};
	}

	if (c.env.ENABLE_ADMIN === "false") {
		return c.json(
			{ success: false, error: "Admin functionality is disabled" },
			403,
		);
	}
	const password = resolveAdminPassword(c, body);
	if (!password || password !== c.env.ADMIN_PASSWORD) {
		return c.json(
			{ success: false, error: "Unauthorized - Invalid admin password" },
			401,
		);
	}

	try {
		await initDatabase(c.env.DB);

		const day = new Date().toISOString().slice(0, 10);
		const offset = Math.max(0, parseInt(String(body.offset ?? "0"), 10) || 0);
		const limit = Math.min(
			SNAPSHOT_PROJECT_LIMIT,
			Math.max(
				1,
				parseInt(String(body.limit ?? ""), 10) || SNAPSHOT_PROJECT_LIMIT,
			),
		);

		// View counts need no upstream call, so the whole set is recorded in one
		// statement on every run rather than paged.
		const viewWrite = await c.env.DB.prepare(
			`
			INSERT INTO view_snapshots (day, project_name, view_count, unique_views)
			SELECT ?, project_name, view_count, COALESCE(unique_views, 0)
			FROM project_views
			-- SQLite cannot tell whether ON CONFLICT belongs to the SELECT or
			-- the INSERT unless the SELECT has a WHERE clause.
			WHERE true
			ON CONFLICT(day, project_name) DO UPDATE SET
				view_count = excluded.view_count,
				unique_views = excluded.unique_views,
				recorded_at = CURRENT_TIMESTAMP
			`,
		)
			.bind(day)
			.run();

		const totalRow = await c.env.DB.prepare(
			"SELECT COUNT(DISTINCT project_name) AS total FROM install_sources",
		).first();
		const totalProjects = Number(totalRow?.total) || 0;

		const projectRows = await c.env.DB.prepare(
			"SELECT DISTINCT project_name FROM install_sources ORDER BY project_name LIMIT ? OFFSET ?",
		)
			.bind(limit, offset)
			.all();
		const projects = ((projectRows.results || []) as any[]).map((row) =>
			String(row.project_name),
		);

		const writes: D1PreparedStatement[] = [];
		const skipped: {
			project: string;
			source: string;
			reason: string;
			error?: string;
		}[] = [];

		for (const projectName of projects) {
			const { results } = await collectInstallCounts(c.env, projectName);
			for (const result of results) {
				// A stale figure is an older number wearing today's date, and a
				// failed source has no number at all. Neither gets written.
				if (!result.ok || result.count === null) {
					skipped.push({
						project: projectName,
						source: result.source,
						reason: "source unavailable",
						error: result.error,
					});
					continue;
				}
				if (result.stale) {
					skipped.push({
						project: projectName,
						source: result.source,
						reason: "cached figure is stale, not recorded as today",
						error: result.error,
					});
					continue;
				}
				writes.push(
					c.env.DB.prepare(
						`
						INSERT INTO install_snapshots (day, project_name, source, value, "window")
						VALUES (?, ?, ?, ?, ?)
						ON CONFLICT(day, project_name, source) DO UPDATE SET
							value = excluded.value,
							"window" = excluded."window",
							recorded_at = CURRENT_TIMESTAMP
						`,
					).bind(day, projectName, result.source, result.count, result.window),
				);
			}
		}

		if (writes.length > 0) await c.env.DB.batch(writes);

		const nextOffset = offset + projects.length;
		const done = projects.length === 0 || nextOffset >= totalProjects;

		return c.json({
			success: true,
			day,
			projectsScanned: projects.length,
			projectsTotal: totalProjects,
			offset,
			nextOffset: done ? null : nextOffset,
			done,
			installRowsWritten: writes.length,
			viewRowsWritten: viewWrite.meta?.changes ?? null,
			skipped,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Snapshot error:", error);
		return c.json({ success: false, error: "Snapshot failed" }, 500);
	}
});

const SNAPSHOT_BUCKETS = ["day", "week", "month"];

// Snapshots are gauges, not counters: each row is the registry's own running
// total on that day. Rolling days up into a bucket therefore means keeping the
// bucket's last reading, never summing the days inside it.
const bucketKeyFor = (day: string, bucket: string): string => {
	if (bucket === "month") return day.slice(0, 7);
	if (bucket === "week") {
		const date = new Date(`${day}T00:00:00Z`);
		if (Number.isNaN(date.getTime())) return day;
		// Shift back to the Monday that starts this ISO week.
		date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
		return date.toISOString().slice(0, 10);
	}
	return day;
};

type SeriesPoint = { day: string; value: number };

const bucketSeries = (points: SeriesPoint[], bucket: string): SeriesPoint[] => {
	if (bucket === "day") return points;
	const byBucket = new Map<string, SeriesPoint>();
	for (const point of points) {
		const key = bucketKeyFor(point.day, bucket);
		byBucket.set(key, { day: key, value: point.value });
	}
	return [...byBucket.values()].sort((a, b) => a.day.localeCompare(b.day));
};

// Every figure here is derived from the recorded points and nothing else. With
// fewer than two points there is no change to report, so those fields are null
// rather than zero.
const summariseSeries = (points: SeriesPoint[]) => {
	if (points.length === 0) {
		return {
			points: 0,
			first: null,
			last: null,
			change: null,
			changePercent: null,
			perDay: null,
		};
	}
	const first = points[0]!;
	const last = points[points.length - 1]!;
	const change = last.value - first.value;
	// A month bucket is keyed "YYYY-MM"; pin it to the first of the month so the
	// span does not depend on how the runtime parses a partial date.
	const atMidnightUtc = (day: string): number =>
		Date.parse(`${day.length === 7 ? `${day}-01` : day}T00:00:00Z`);
	const spanMs = atMidnightUtc(last.day) - atMidnightUtc(first.day);
	const spanDays = Number.isFinite(spanMs)
		? Math.max(1, Math.round(spanMs / 86400000))
		: 1;
	return {
		points: points.length,
		first: first.value,
		last: last.value,
		change: points.length > 1 ? change : null,
		changePercent:
			points.length > 1 && first.value > 0
				? Number(((change / first.value) * 100).toFixed(2))
				: null,
		perDay: points.length > 1 ? Number((change / spanDays).toFixed(2)) : null,
	};
};

const parseHistoryDays = (
	raw: string | undefined,
	fallback: number,
): number => {
	const parsed = parseInt(raw || "", 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(365, Math.max(1, parsed));
};

const parseHistoryBucket = (raw: string | undefined): string =>
	SNAPSHOT_BUCKETS.includes(raw || "") ? (raw as string) : "day";

app.get("/api/installs/:projectName/history", edgeCache(300), async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ success: false, error: "Invalid project name" }, 400);
	}

	const days = parseHistoryDays(c.req.query("days"), 90);
	const bucket = parseHistoryBucket(c.req.query("bucket"));

	try {
		await initDatabase(c.env.DB);

		const rows = await c.env.DB.prepare(
			`
			SELECT day, source, value, "window"
			FROM install_snapshots
			WHERE project_name = ?
				AND day >= DATE('now', ?)
			ORDER BY source ASC, day ASC
			`,
		)
			.bind(projectName, `-${days} days`)
			.all();

		const bySource = new Map<
			string,
			{ window: string; points: SeriesPoint[] }
		>();
		for (const row of (rows.results || []) as any[]) {
			const source = String(row.source);
			if (!bySource.has(source)) {
				bySource.set(source, { window: String(row.window), points: [] });
			}
			bySource.get(source)!.points.push({
				day: String(row.day),
				value: Number(row.value),
			});
		}

		const sources = [...bySource.entries()].map(([source, entry]) => {
			const points = bucketSeries(entry.points, bucket);
			const meta = INSTALL_SOURCE_META[source as InstallSourceId];
			return {
				source,
				label: meta ? meta.label : source,
				window: entry.window,
				summary: summariseSeries(points),
				points,
			};
		});

		c.header("Cache-Control", "public, max-age=900");
		c.header("Access-Control-Allow-Origin", "*");
		return c.json({
			success: true,
			project: projectName,
			days,
			bucket,
			sources,
			// Sources are deliberately not summed here. They measure different
			// things over different windows; GET /api/installs/{project} is the
			// endpoint that carries the labelled aggregate.
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Install history error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// ---------------------------------------------------------------------------
// Computed metrics
//
// One number, derived from the numbers ViewFlare already holds:
//   GET /api/compute/:project?expr=views.total%2Binstalls.total
//
// The formula lives in the query string, so nothing is stored and there is no
// schema for it: a README badge carries its own formula in its URL.
//
// There is no eval in here. The text is tokenised and walked by a small
// recursive descent parser that knows numbers, the identifiers resolved in
// resolveComputeInputs, seven functions and five operators. Anything else is a
// 400 that names what was not recognised.
//
// The never-invent rule from the install aggregator carries over: if any input
// an expression reads is unavailable, the whole metric is unavailable. A
// missing number never quietly becomes 0.
// ---------------------------------------------------------------------------

const COMPUTE_MAX_EXPRESSION = 200;
const COMPUTE_MAX_DEPTH = 24;

// Argument counts are checked at parse time so a typo is a 400 rather than a
// surprise NaN.
const COMPUTE_FUNCTIONS: Record<string, { min: number; max: number }> = {
	min: { min: 1, max: 8 },
	max: { min: 1, max: 8 },
	abs: { min: 1, max: 1 },
	round: { min: 1, max: 2 },
	floor: { min: 1, max: 1 },
	ceil: { min: 1, max: 1 },
	pct: { min: 2, max: 2 },
};

type ComputeToken =
	| { kind: "number"; value: number }
	| { kind: "ident"; value: string }
	| { kind: "op"; value: string };

type ComputeNode =
	| { kind: "number"; value: number }
	| { kind: "var"; name: string }
	| { kind: "unary"; op: string; operand: ComputeNode }
	| { kind: "binary"; op: string; left: ComputeNode; right: ComputeNode }
	| { kind: "call"; name: string; args: ComputeNode[] };

// Thrown for anything the caller can fix by editing their expression, so the
// routes can answer 400 with the message instead of a blank 500.
const computeFail = (message: string): never => {
	const error = new Error(message);
	(error as any).computeError = true;
	throw error;
};

const tokeniseExpression = (input: string): ComputeToken[] => {
	const tokens: ComputeToken[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i] as string;
		if (ch === " " || ch === "\t" || ch === "\n") {
			i += 1;
			continue;
		}
		if (ch >= "0" && ch <= "9") {
			let j = i;
			while (j < input.length && /[0-9.]/.test(input[j] as string)) j += 1;
			const raw = input.slice(i, j);
			const value = Number(raw);
			if (!Number.isFinite(value)) computeFail(`Not a number: "${raw}"`);
			tokens.push({ kind: "number", value });
			i = j;
			continue;
		}
		if (/[A-Za-z_]/.test(ch)) {
			let j = i;
			while (j < input.length && /[A-Za-z0-9_.]/.test(input[j] as string)) {
				j += 1;
			}
			tokens.push({ kind: "ident", value: input.slice(i, j) });
			i = j;
			continue;
		}
		if ("+-*/%(),".includes(ch)) {
			tokens.push({ kind: "op", value: ch });
			i += 1;
			continue;
		}
		computeFail(`Unexpected character "${ch}" in the expression`);
	}
	return tokens;
};

type ComputeParser = { tokens: ComputeToken[]; pos: number };

const peekToken = (p: ComputeParser): ComputeToken | null =>
	p.pos < p.tokens.length ? (p.tokens[p.pos] as ComputeToken) : null;

const expectOp = (p: ComputeParser, op: string) => {
	const token = peekToken(p);
	if (!token || token.kind !== "op" || token.value !== op) {
		computeFail(`Expected "${op}" in the expression`);
	}
	p.pos += 1;
};

const parseExpression = (p: ComputeParser, depth: number): ComputeNode => {
	if (depth > COMPUTE_MAX_DEPTH) {
		computeFail("Expression is nested too deeply");
	}
	let left = parseTerm(p, depth);
	for (;;) {
		const token = peekToken(p);
		if (!token || token.kind !== "op") break;
		if (token.value !== "+" && token.value !== "-") break;
		p.pos += 1;
		const right = parseTerm(p, depth);
		left = { kind: "binary", op: token.value, left, right };
	}
	return left;
};

const parseTerm = (p: ComputeParser, depth: number): ComputeNode => {
	let left = parseUnary(p, depth);
	for (;;) {
		const token = peekToken(p);
		if (!token || token.kind !== "op") break;
		if (token.value !== "*" && token.value !== "/" && token.value !== "%") {
			break;
		}
		p.pos += 1;
		const right = parseUnary(p, depth);
		left = { kind: "binary", op: token.value, left, right };
	}
	return left;
};

const parseUnary = (p: ComputeParser, depth: number): ComputeNode => {
	const token = peekToken(p);
	if (token && token.kind === "op" && (token.value === "-" || token.value === "+")) {
		p.pos += 1;
		return { kind: "unary", op: token.value, operand: parseUnary(p, depth) };
	}
	return parsePrimary(p, depth);
};

const parsePrimary = (p: ComputeParser, depth: number): ComputeNode => {
	const token = peekToken(p);
	if (!token) computeFail("Expression ended early");
	const current = token as ComputeToken;

	if (current.kind === "number") {
		p.pos += 1;
		return { kind: "number", value: current.value };
	}

	if (current.kind === "op" && current.value === "(") {
		p.pos += 1;
		const inner = parseExpression(p, depth + 1);
		expectOp(p, ")");
		return inner;
	}

	if (current.kind === "ident") {
		p.pos += 1;
		const next = peekToken(p);
		if (next && next.kind === "op" && next.value === "(") {
			const spec = COMPUTE_FUNCTIONS[current.value];
			if (!spec) computeFail(`Unknown function "${current.value}"`);
			const arity = spec as { min: number; max: number };
			p.pos += 1;
			const args: ComputeNode[] = [];
			const closing = peekToken(p);
			if (closing && closing.kind === "op" && closing.value === ")") {
				p.pos += 1;
			} else {
				for (;;) {
					args.push(parseExpression(p, depth + 1));
					const sep = peekToken(p);
					if (sep && sep.kind === "op" && sep.value === ",") {
						p.pos += 1;
						continue;
					}
					expectOp(p, ")");
					break;
				}
			}
			if (args.length < arity.min || args.length > arity.max) {
				computeFail(
					`"${current.value}" takes ${arity.min === arity.max ? arity.min : `${arity.min} to ${arity.max}`} argument(s), got ${args.length}`,
				);
			}
			return { kind: "call", name: current.value, args };
		}
		return { kind: "var", name: current.value };
	}

	return computeFail(`Unexpected "${current.value}" in the expression`);
};

const parseComputeExpression = (raw: string): ComputeNode => {
	const trimmed = raw.trim();
	if (!trimmed) computeFail("No expression given. Pass ?expr=");
	if (trimmed.length > COMPUTE_MAX_EXPRESSION) {
		computeFail(`Expression is longer than ${COMPUTE_MAX_EXPRESSION} characters`);
	}
	const parser: ComputeParser = { tokens: tokeniseExpression(trimmed), pos: 0 };
	const node = parseExpression(parser, 0);
	const leftover = peekToken(parser);
	if (leftover) {
		// A "+" in a URL query string decodes to a space, so an unencoded
		// formula arrives as two values with nothing between them. Say so
		// rather than making the caller guess.
		if (leftover.kind === "ident" || leftover.kind === "number") {
			computeFail(
				'Two values with no operator between them. A "+" in a URL means a space: write it as %2B.',
			);
		}
		computeFail(`Unexpected "${leftover.value}" after the expression`);
	}
	return node;
};

const collectComputeVariables = (node: ComputeNode, into: Set<string>) => {
	if (node.kind === "var") into.add(node.name);
	else if (node.kind === "unary") collectComputeVariables(node.operand, into);
	else if (node.kind === "binary") {
		collectComputeVariables(node.left, into);
		collectComputeVariables(node.right, into);
	} else if (node.kind === "call") {
		for (const arg of node.args) collectComputeVariables(arg, into);
	}
};

const evaluateComputeNode = (
	node: ComputeNode,
	values: Map<string, number>,
): number => {
	switch (node.kind) {
		case "number":
			return node.value;
		case "var": {
			const value = values.get(node.name);
			// Unavailable inputs are caught before evaluation, so this only
			// guards against a resolver bug.
			return value === undefined ? NaN : value;
		}
		case "unary": {
			const operand = evaluateComputeNode(node.operand, values);
			return node.op === "-" ? -operand : operand;
		}
		case "binary": {
			const left = evaluateComputeNode(node.left, values);
			const right = evaluateComputeNode(node.right, values);
			if (node.op === "+") return left + right;
			if (node.op === "-") return left - right;
			if (node.op === "*") return left * right;
			// Division and modulo by zero produce Infinity or NaN, which the
			// caller sees as "unavailable" rather than a made up number.
			if (node.op === "/") return left / right;
			return left % right;
		}
		case "call": {
			const args = node.args.map((arg) => evaluateComputeNode(arg, values));
			const first = args[0] as number;
			switch (node.name) {
				case "min":
					return Math.min(...args);
				case "max":
					return Math.max(...args);
				case "abs":
					return Math.abs(first);
				case "floor":
					return Math.floor(first);
				case "ceil":
					return Math.ceil(first);
				case "round": {
					const digitsArg = args.length > 1 ? (args[1] as number) : 0;
					const digits = Math.min(6, Math.max(0, Math.floor(digitsArg)));
					const factor = Math.pow(10, digits);
					return Math.round(first * factor) / factor;
				}
				default: {
					// pct(part, whole): the share of whole, as a percentage.
					const whole = args[1] as number;
					return whole === 0 ? NaN : (first / whole) * 100;
				}
			}
		}
	}
};

type ComputeInput = {
	name: string;
	value: number | null;
	// Views and installs belong to the project in the URL. A rollup widens views
	// to the whole dotted subtree. The event log has no project column, so event
	// counts are instance wide and say so.
	scope: "project" | "subtree" | "instance";
	stale: boolean;
	partial: boolean;
	note?: string;
};

const resolveComputeInputs = async (
	env: Bindings,
	projectName: string,
	names: string[],
	rollup: boolean,
): Promise<{ inputs: ComputeInput[]; mixedWindows: boolean }> => {
	const inputs: ComputeInput[] = [];
	let mixedWindows = false;

	// Only the families an expression actually mentions are fetched. An
	// expression with no installs.* never calls out to the registries.
	const wantsViews = names.some((name) => name.startsWith("views."));
	const wantsInstalls = names.some((name) => name.startsWith("installs."));

	let viewRow: any = null;
	let rolledMembers = 0;
	if (wantsViews) {
		if (rollup) {
			const subtree = await readSubtreeViews(env.DB, projectName);
			rolledMembers = subtree.members.length;
			viewRow = {
				view_count: subtree.totalViews,
				unique_views: subtree.uniqueViews,
			};
		} else {
			viewRow = await env.DB.prepare(
				"SELECT view_count, unique_views FROM project_views WHERE project_name = ?",
			)
				.bind(projectName)
				.first();
		}
	}

	let configured = 0;
	let installResults: InstallSourceResult[] = [];
	let installSummary: { total: number | null; answered: number; mixedWindows: boolean } | null =
		null;
	if (wantsInstalls) {
		const collected = await collectInstallCounts(env, projectName);
		configured = collected.configured;
		installResults = collected.results;
		installSummary = summariseInstalls(installResults);
		mixedWindows = installSummary.mixedWindows;
	}

	for (const name of names) {
		const parts = name.split(".");

		if (parts[0] === "views") {
			if (parts.length !== 2 || (parts[1] !== "total" && parts[1] !== "unique")) {
				computeFail(`Unknown variable "${name}". Try views.total or views.unique.`);
			}
			// An unseen project reads 0 here, matching GET /api/views/:project.
			const value =
				parts[1] === "total"
					? Number(viewRow?.view_count) || 0
					: Number(viewRow?.unique_views) || 0;
			inputs.push({
				name,
				value,
				scope: rollup ? "subtree" : "project",
				stale: false,
				partial: false,
				note: rollup
					? `summed over ${rolledMembers} project${rolledMembers === 1 ? "" : "s"} under "${projectName}"`
					: undefined,
			});
			continue;
		}

		if (parts[0] === "installs") {
			if (parts.length !== 2) {
				computeFail(
					`Unknown variable "${name}". Try installs.total or installs.<source>.`,
				);
			}
			const which = parts[1] as string;

			if (which === "total") {
				const summary = installSummary as {
					total: number | null;
					answered: number;
				};
				inputs.push({
					name,
					value: configured === 0 ? null : summary.total,
					scope: "project",
					stale: installResults.some((r) => r.ok && r.stale),
					partial: configured > 0 && summary.answered < configured,
					note:
						configured === 0
							? "no install sources configured for this project"
							: summary.answered < configured
								? `${summary.answered} of ${configured} sources answered`
								: rollup
									? "installs are not rolled up, only this project"
									: undefined,
				});
				continue;
			}

			if (!INSTALL_SOURCES.includes(which as InstallSourceId)) {
				computeFail(
					`Unknown install source "${which}". Known sources are ${INSTALL_SOURCES.join(", ")}.`,
				);
			}
			const result = installResults.find((r) => r.source === which);
			if (!result) {
				inputs.push({
					name,
					value: null,
					scope: "project",
					stale: false,
					partial: false,
					note: "source not configured for this project",
				});
				continue;
			}
			inputs.push({
				name,
				value: result.ok && typeof result.count === "number" ? result.count : null,
				scope: "project",
				stale: result.stale,
				partial: false,
				note: result.ok ? undefined : result.error || "source did not answer",
			});
			continue;
		}

		if (parts[0] === "events") {
			if (parts.length < 2 || parts.length > 3) {
				computeFail(
					`Unknown variable "${name}". Try events.<category> or events.<category>.<name>.`,
				);
			}
			const category = parts[1] as string;
			const eventName = parts.length === 3 ? (parts[2] as string) : null;
			const row = eventName
				? await env.DB.prepare(
						"SELECT COUNT(*) as count FROM event_logs WHERE event_category = ? AND event_name = ?",
					)
						.bind(category, eventName)
						.first()
				: await env.DB.prepare(
						"SELECT COUNT(*) as count FROM event_logs WHERE event_category = ?",
					)
						.bind(category)
						.first();
			// A count of zero is a real answer, not a missing one.
			inputs.push({
				name,
				value: Number(row?.count) || 0,
				scope: "instance",
				stale: false,
				partial: false,
				note: "the event log is not project scoped",
			});
			continue;
		}

		computeFail(
			`Unknown variable "${name}". Available: views.total, views.unique, installs.total, installs.<source>, events.<category>[.<name>].`,
		);
	}

	return { inputs, mixedWindows };
};

// Badges have no room for twelve decimal places; two is enough for a
// percentage or a ratio. Whole numbers keep the compact k/M/B form.
const formatComputedValue = (value: number): string => {
	if (Number.isInteger(value)) return formatCompactCount(value);
	return String(Math.round(value * 100) / 100);
};

type ComputeResult = {
	expression: string;
	value: number | null;
	formatted: string;
	unavailable: boolean;
	reason: string | null;
	partial: boolean;
	stale: boolean;
	mixedWindows: boolean;
	usesLiveCounters: boolean;
	rollup: boolean;
	inputs: ComputeInput[];
};

const resolveComputeMetric = async (
	env: Bindings,
	projectName: string,
	rawExpression: string,
	rollup = false,
): Promise<ComputeResult> => {
	const node = parseComputeExpression(rawExpression);
	const referenced = new Set<string>();
	collectComputeVariables(node, referenced);
	const names = Array.from(referenced).sort();

	const { inputs, mixedWindows } = await resolveComputeInputs(
		env,
		projectName,
		names,
		rollup,
	);

	const partial = inputs.some((input) => input.partial);
	const stale = inputs.some((input) => input.stale);
	// Views and events are written on every request; registry counts move daily.
	const usesLiveCounters = names.some(
		(name) => name.startsWith("views.") || name.startsWith("events."),
	);
	const base = {
		expression: rawExpression.trim(),
		partial,
		stale,
		mixedWindows,
		usesLiveCounters,
		rollup,
		inputs,
	};

	// One unavailable input makes the whole metric unavailable. Substituting a
	// zero would look like a real answer.
	const missing = inputs.filter((input) => input.value === null);
	if (missing.length > 0) {
		return {
			...base,
			value: null,
			formatted: "unavailable",
			unavailable: true,
			reason: `no value for ${missing.map((input) => input.name).join(", ")}`,
		};
	}

	const values = new Map<string, number>();
	for (const input of inputs) values.set(input.name, input.value as number);
	const value = evaluateComputeNode(node, values);

	// Divide by zero, pct of zero, overflow: report unavailable, never NaN.
	if (!Number.isFinite(value)) {
		return {
			...base,
			value: null,
			formatted: "unavailable",
			unavailable: true,
			reason: "the expression does not produce a finite number",
		};
	}

	return {
		...base,
		value,
		formatted: formatComputedValue(value),
		unavailable: false,
		reason: null,
	};
};

// A badge shows only the number, so the label carries the caveats, the same way
// buildInstallLabel does for the installs badge.
const buildComputeLabel = (base: string, result: ComputeResult): string => {
	const parts: string[] = [];
	if (result.partial) parts.push("partial");
	if (result.stale) parts.push("stale");
	if (result.mixedWindows) parts.push("mixed windows");
	return parts.length > 0 ? `${base} (${parts.join(", ")})` : base;
};

// Views and events move on every request, so anything reading them is
// re-checked quickly. Registry numbers move daily, so a complete answer that
// only reads installs holds for an hour.
const computeCacheSeconds = (result: ComputeResult): number => {
	if (result.unavailable) return 300;
	if (result.usesLiveCounters) return 300;
	if (result.partial || result.stale) return 900;
	return 3600;
};

app.get("/api/compute/:projectName", edgeCache(60), customRateLimiter, async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ success: false, error: "Invalid project name" }, 400);
	}

	await initDatabase(c.env.DB);

	try {
		const result = await resolveComputeMetric(
			c.env,
			projectName,
			c.req.query("expr") || "",
			wantsRollup(c),
		);

		c.header("Cache-Control", `public, max-age=${computeCacheSeconds(result)}`);
		c.header("Access-Control-Allow-Origin", "*");
		return c.json({
			success: true,
			project: projectName,
			rollup: result.rollup,
			expression: result.expression,
			value: result.value,
			formatted: result.formatted,
			unavailable: result.unavailable,
			reason: result.reason,
			partial: result.partial,
			stale: result.stale,
			mixedWindows: result.mixedWindows,
			inputs: result.inputs,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		if ((error as any)?.computeError) {
			return c.json({ success: false, error: (error as Error).message }, 400);
		}
		console.error("Compute error:", error);
		return c.json({ success: false, error: "Failed to compute metric" }, 500);
	}
});

// SVG badge of the same number. No per-IP rate limit, for the same reason the
// other badge routes have none: GitHub's camo proxy fetches from a small pool
// of IPs, so limiting per IP would break the badge for everyone at once.
app.get("/api/compute/:projectName/badge", edgeCache(60), async (c) => {
	const projectName = c.req.param("projectName");
	const styleParam = (c.req.query("style") || "flat").toLowerCase();
	const style = BADGE_STYLES.includes(styleParam) ? styleParam : "flat";
	const colorParam = c.req.query("color");
	const labelParam = c.req.query("label");

	if (!projectName || projectName.length > 100) {
		return c.text("Invalid project name", 400);
	}

	await initDatabase(c.env.DB);

	try {
		let message = "";
		let label = "";
		let unavailable = false;
		let cacheSeconds = 300;
		try {
			const result = await resolveComputeMetric(
				c.env,
				projectName,
				c.req.query("expr") || "",
				wantsRollup(c),
			);
			message = result.formatted;
			unavailable = result.unavailable;
			cacheSeconds = computeCacheSeconds(result);
			label = buildComputeLabel(
				labelParam ? labelParam.slice(0, 40) : "metric",
				result,
			);
		} catch (error) {
			if (!(error as any)?.computeError) throw error;
			// A broken formula renders as a grey badge rather than a broken
			// image in someone's README.
			message = "invalid expression";
			unavailable = true;
			label = labelParam ? labelParam.slice(0, 40) : "metric";
		}

		const badgeColor = resolveBadgeColor(
			(colorParam || (unavailable ? "lightgrey" : "blue")).toLowerCase(),
		);
		const svg = renderBadgeSvg(label, message, badgeColor, style);

		c.header("Content-Type", "image/svg+xml");
		c.header(
			"Cache-Control",
			`public, max-age=${cacheSeconds}, stale-while-revalidate=86400`,
		);
		c.header("Access-Control-Allow-Origin", "*");
		return c.body(svg.trim());
	} catch (error) {
		console.error("Compute badge error:", error);
		return c.text("Error generating badge", 500);
	}
});

// shields.io endpoint-badge format: https://shields.io/badges/endpoint-badge
app.get("/api/compute/:projectName/shields.json", edgeCache(60), async (c) => {
	const projectName = c.req.param("projectName");
	const colorParam = c.req.query("color");
	const labelParam = c.req.query("label");

	if (!projectName || projectName.length > 100) {
		return c.json(
			{
				schemaVersion: 1,
				label: "metric",
				message: "invalid project",
				color: "lightgrey",
				isError: true,
			},
			400,
		);
	}

	await initDatabase(c.env.DB);

	try {
		let result: ComputeResult | null = null;
		try {
			result = await resolveComputeMetric(
				c.env,
				projectName,
				c.req.query("expr") || "",
				wantsRollup(c),
			);
		} catch (error) {
			if (!(error as any)?.computeError) throw error;
		}

		const cacheSeconds = result ? computeCacheSeconds(result) : 300;
		const unavailable = result ? result.unavailable : true;
		const base = labelParam ? labelParam.slice(0, 40) : "metric";

		c.header(
			"Cache-Control",
			`public, max-age=${cacheSeconds}, stale-while-revalidate=86400`,
		);
		c.header("Access-Control-Allow-Origin", "*");
		return c.json({
			schemaVersion: 1,
			label: result ? buildComputeLabel(base, result) : base,
			message: result ? result.formatted : "invalid expression",
			color: colorParam || (unavailable ? "lightgrey" : "blue"),
			isError: unavailable,
			cacheSeconds,
		});
	} catch (error) {
		console.error("Compute shields.json error:", error);
		return c.json(
			{
				schemaVersion: 1,
				label: "metric",
				message: "error",
				color: "lightgrey",
				isError: true,
			},
			500,
		);
	}
});

// Cloudflare Pages export format with static file handling
export default {
	async fetch(request: Request, env: any, ctx: any) {
		const url = new URL(request.url);

		// Handle static files - pass to Cloudflare Pages.
		// /api/ is always the worker's: /api/installs/x/shields.json ends in
		// .json but is a route, not an asset.
		// Extensionless pages have to be listed by name. /admin is one, and
		// leaving it off the list is a silent 404 rather than an error.
		if (
			!url.pathname.startsWith("/api/") &&
			(url.pathname === "/" ||
				url.pathname === "/index.html" ||
				url.pathname === "/admin" ||
				url.pathname === "/admin/" ||
				url.pathname.match(
					/\.(html|css|js|mjs|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|json|webp|avif|txt|xml|yaml|webmanifest)$/i,
				))
		) {
			return env.ASSETS.fetch(request);
		}

		// Handle API routes through Hono
		return app.fetch(request, env, ctx);
	},
};
