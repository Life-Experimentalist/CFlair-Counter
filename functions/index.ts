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

// Database initialization with optimized schema
const initDatabase = async (db: D1Database) => {
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
	} catch (error) {
		console.error("Database initialization error:", error);
	}
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

app.get("/api/views", async (c) => {
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

app.get("/api/views/:projectName", async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ error: "Invalid project name" }, 400);
	}

	await initDatabase(c.env.DB);

	try {
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
		await trackUsage(c.env.DB);

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

		await trackUsage(c.env.DB)

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

app.get("/api/metrics", customRateLimiter, async (c) => {
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
app.get("/api/views/:projectName/badge", async (c) => {
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
			await trackUsage(c.env.DB);

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

		const result = await c.env.DB.prepare(
			"SELECT view_count FROM project_views WHERE project_name = ?",
		)
			.bind(projectName)
			.first();

		const viewCount = Number(result?.view_count) || 0;
		const valueTextRaw = formatCompactCount(viewCount);

		const badgeColor = resolveBadgeColor(color);
		const svg = renderBadgeSvg(rawLabel, valueTextRaw, badgeColor, style);

		c.header("Content-Type", "image/svg+xml");
		c.header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
		c.header("Pragma", "no-cache");
		c.header("Expires", "0");
		c.header("Access-Control-Allow-Origin", "*");
		return c.body(svg.trim());
	} catch (error) {
		console.error("Badge generation error:", error);
		return c.text("Error generating badge", 500);
	}
});

app.get("/api/views/:projectName/history", async (c) => {
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

// Usage tracking helper
const trackUsage = async (db: D1Database) => {
	const today = new Date().toISOString().split("T")[0];
	try {
		await db
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
app.get("/api/stats", async (c) => {
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
		await trackUsage(c.env.DB);

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
		await trackUsage(c.env.DB);

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

		await trackUsage(c.env.DB);

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

// Admin: Update a project — rename, change description, set view/unique counts
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

// Aggregate install / download counts for a project.
// Partial failure is a normal outcome here, not an error: whatever answered is
// returned with a coverage figure, and the sources that did not are marked.
app.get("/api/installs/:projectName", customRateLimiter, async (c) => {
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
app.get("/api/installs/:projectName/badge", async (c) => {
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

app.get("/api/installs/:projectName/history", async (c) => {
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

// Cloudflare Pages export format with static file handling
export default {
	async fetch(request: Request, env: any, ctx: any) {
		const url = new URL(request.url);

		// Handle static files - pass to Cloudflare Pages.
		// /api/ is always the worker's: /api/installs/x/shields.json ends in
		// .json but is a route, not an asset.
		if (
			!url.pathname.startsWith("/api/") &&
			(url.pathname === "/" ||
				url.pathname === "/index.html" ||
				url.pathname.match(
					/\.(html|css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|json|webp)$/i,
				))
		) {
			return env.ASSETS.fetch(request);
		}

		// Handle API routes through Hono
		return app.fetch(request, env, ctx);
	},
};
