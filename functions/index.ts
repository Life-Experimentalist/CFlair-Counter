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

// Generate SVG badge for project views
// Shields.io style with better aesthetics
app.get("/api/views/:projectName/badge", async (c) => {
	const projectName = c.req.param("projectName");
	const styleParam = (c.req.query("style") || "flat").toLowerCase(); // flat, flat-square, for-the-badge
	const style = ["flat", "flat-square", "for-the-badge"].includes(styleParam)
		? styleParam
		: "flat";
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
		const safeLabel = escapeXml(rawLabel);
		const valueTextRaw =
			viewCount >= 1000
				? `${(viewCount / 1000).toFixed(1)}k`
				: viewCount.toString();
		const safeValueText = escapeXml(valueTextRaw);

		// Color mapping for better aesthetics
		const colorMap: Record<string, string> = {
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

		const badgeColor =
			colorMap[color] || normalizeBadgeColor(color) || colorMap.blue;

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

// Cloudflare Pages export format with static file handling
export default {
	async fetch(request: Request, env: any, ctx: any) {
		const url = new URL(request.url);

		// Handle static files - pass to Cloudflare Pages
		if (
			url.pathname === "/" ||
			url.pathname === "/index.html" ||
			url.pathname.match(
				/\.(html|css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|json|webp)$/i,
			)
		) {
			return env.ASSETS.fetch(request);
		}

		// Handle API routes through Hono
		return app.fetch(request, env, ctx);
	},
};
