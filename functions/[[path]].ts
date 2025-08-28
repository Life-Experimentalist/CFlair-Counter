// Cloudflare Pages Function - Root handler
// This handles all API routes for CFlairCounter

import { Hono } from "hono";
import { cors } from "hono/cors";

// Define the environment bindings
type Bindings = {
	DB: D1Database;
	ADMIN_PASSWORD?: string;
	ENABLE_ADMIN?: string;
	ENABLE_ANALYTICS?: string;
	MAX_PROJECTS?: string;
};

type Variables = {
	visitorHash?: string;
	projectName?: string;
};

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

// CORS middleware with optimized settings
app.use(
	"*",
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
		maxAge: 86400, // Cache preflight for 24 hours
	})
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
		`
			)
			.run();

		// Only essential indexes to minimize write costs
		await db
			.prepare(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_project_name ON project_views(project_name)"
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
		`
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
		`
			)
			.run();
	} catch (error) {
		console.error("Database initialization error:", error);
	}
};

// Health check endpoint
app.get("/health", (c) => {
	return c.json({
		success: true,
		status: "ok",
		timestamp: new Date().toISOString(),
		worker: "cflaircounter-api",
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
			"SELECT view_count, unique_views, description, created_at FROM project_views WHERE project_name = ?"
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
app.post("/api/views/:projectName", async (c) => {
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
		`
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
			`
			)
				.bind(projectName, visitorHash)
				.run();

			// Get unique count efficiently
			const uniqueResult = await c.env.DB.prepare(
				"SELECT COUNT(*) as count FROM visitor_tracking WHERE project_name = ?"
			)
				.bind(projectName)
				.first();

			uniqueViews = Number(uniqueResult?.count) || 0;

			// Update unique views count
			await c.env.DB.prepare(
				"UPDATE project_views SET unique_views = ? WHERE project_name = ?"
			)
				.bind(uniqueViews, projectName)
				.run();
		}

		// Get final count with minimal query
		const result = await c.env.DB.prepare(
			"SELECT view_count FROM project_views WHERE project_name = ?"
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

// Generate SVG badge for project views
app.get("/api/views/:projectName/badge", async (c) => {
	const projectName = c.req.param("projectName");
	const color = c.req.query("color") || "blue";
	const label = c.req.query("label") || "views";

	if (!projectName || projectName.length > 100) {
		return c.text("Invalid project name", 400);
	}

	await initDatabase(c.env.DB);

	try {
		const result = await c.env.DB.prepare(
			"SELECT view_count FROM project_views WHERE project_name = ?"
		)
			.bind(projectName)
			.first();

		const viewCount = result?.view_count || 0;

		// Generate SVG badge
		const labelWidth = label.length * 7 + 10;
		const valueWidth = viewCount.toString().length * 7 + 10;
		const totalWidth = labelWidth + valueWidth;

		const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
	<linearGradient id="b" x2="0" y2="100%">
		<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
		<stop offset="1" stop-opacity=".1"/>
	</linearGradient>
	<clipPath id="a">
		<rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
	</clipPath>
	<g clip-path="url(#a)">
		<path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
		<path fill="${
			color === "blue" ? "#4c7bd9" : color
		}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
		<path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/>
	</g>
	<g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
		<text x="${
			labelWidth / 2
		}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
		<text x="${labelWidth / 2}" y="14">${label}</text>
		<text x="${
			labelWidth + valueWidth / 2
		}" y="15" fill="#010101" fill-opacity=".3">${viewCount}</text>
		<text x="${labelWidth + valueWidth / 2}" y="14">${viewCount}</text>
	</g>
</svg>`.trim();

		c.header("Content-Type", "image/svg+xml");
		c.header("Cache-Control", "public, max-age=3600"); // 1 hour cache
		return c.body(svg);
	} catch (error) {
		console.error("Badge generation error:", error);
		return c.text("Error generating badge", 500);
	}
});

// Lightweight usage tracking
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
		`
			)
			.bind(today)
			.run();
	} catch (error) {
		// Silently fail to avoid impacting main functionality
		console.warn("Usage tracking failed:", error);
	}
};

// Admin: Get enhanced project statistics (POST for password in body)
app.post("/api/admin/stats", async (c) => {
	try {
		const body = await c.req.json();
		const password = body.password;
		const adminPassword = c.env.ADMIN_PASSWORD || "admin123";
		const enableAdmin = c.env.ENABLE_ADMIN !== "false";

		if (!enableAdmin) {
			return c.json(
				{
					success: false,
					error: "Admin functionality is disabled",
				},
				403
			);
		}

		if (!password || password !== adminPassword) {
			return c.json(
				{
					success: false,
					error: "Unauthorized - Invalid admin password",
				},
				401
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
		`
		).first();

		// Get top projects
		const topProjects = await c.env.DB.prepare(
			`
			SELECT project_name, view_count, unique_views, description, updated_at
			FROM project_views
			ORDER BY view_count DESC
			LIMIT 10
		`
		).all();

		return c.json({
			success: true,
			statistics: {
				totalViews: stats?.total_views || 0,
				uniqueViews: stats?.unique_views || 0,
				totalProjects: stats?.total_projects || 0,
				uptime: "99.9%", // Static for now
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

// Cloudflare Pages export format
export default {
	fetch: app.fetch.bind(app),
};
