import { Hono } from "hono";
import { cors } from "hono/cors";
import { cache } from "hono/cache";
import { etag } from "hono/etag";

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

// ETag middleware for better caching
app.use("/api/views/*/badge", etag());

// Cache middleware for badge endpoint (5 minutes)
app.use(
	"/api/views/*/badge",
	cache({
		cacheName: "cflaircounter-badges",
		cacheControl: "public, max-age=300",
	})
);

// Optimized database initialization - minimal structure for efficiency
let dbInitialized = false;
const initDatabase = async (db: D1Database) => {
	if (dbInitialized) return;

	try {
		await db.exec(`
			CREATE TABLE IF NOT EXISTS project_views (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				project_name TEXT NOT NULL UNIQUE,
				view_count INTEGER DEFAULT 0,
				unique_views INTEGER DEFAULT 0,
				description TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_project_name ON project_views(project_name);

			CREATE TABLE IF NOT EXISTS visitor_tracking (
				project_name TEXT NOT NULL,
				visitor_hash TEXT NOT NULL,
				last_visit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				visit_count INTEGER DEFAULT 1,
				PRIMARY KEY(project_name, visitor_hash)
			);

			CREATE TABLE IF NOT EXISTS usage_stats (
				date TEXT PRIMARY KEY,
				requests_count INTEGER DEFAULT 0,
				rows_read INTEGER DEFAULT 0,
				rows_written INTEGER DEFAULT 0,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`);
		dbInitialized = true;
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
		console.error("Database query error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// Optimized webhook endpoint - minimal database operations
app.post("/api/views/:projectName", async (c) => {
	const projectName = c.req.param("projectName");
	if (!projectName || projectName.length > 100) {
		return c.json({ error: "Invalid project name" }, 400);
	}

	await initDatabase(c.env.DB);

	const visitorHash = generateVisitorHash(c.req.raw);
	const enableAnalytics = c.env.ENABLE_ANALYTICS === "true";

	try {
		// Track usage for monitoring
		await trackUsage(c.env.DB);

		// Single optimized query for project increment
		await c.env.DB.prepare(
			`
			INSERT INTO project_views (project_name, view_count, unique_views, updated_at)
			VALUES (?, 1, 0, CURRENT_TIMESTAMP)
			ON CONFLICT(project_name) DO UPDATE SET
				view_count = view_count + 1,
				updated_at = CURRENT_TIMESTAMP
		`
		)
			.bind(projectName)
			.run();

		// Only track unique visitors if analytics enabled (saves rows)
		let uniqueViews = 0;
		if (enableAnalytics) {
			await c.env.DB.prepare(
				`
				INSERT INTO visitor_tracking (project_name, visitor_hash, visit_count)
				VALUES (?, ?, 1)
				ON CONFLICT(project_name, visitor_hash) DO UPDATE SET
					visit_count = visit_count + 1,
					last_visit = CURRENT_TIMESTAMP
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
	// const style = c.req.query("style") || "flat"; // TODO: Implement different badge styles
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

// Get statistics for all projects
app.get("/api/stats", async (c) => {
	await initDatabase(c.env.DB);

	try {
		const stats = await c.env.DB.prepare(
			`
			SELECT
				COUNT(*) as total_projects,
				SUM(view_count) as total_views,
				SUM(unique_views) as total_unique_views,
				AVG(view_count) as avg_views,
				MAX(view_count) as max_views
			FROM project_views
		`
		).first();

		const topProjects = await c.env.DB.prepare(
			`
			SELECT project_name, view_count, unique_views, description
			FROM project_views
			ORDER BY view_count DESC
			LIMIT 10
		`
		).all();

		return c.json({
			success: true,
			totalProjects: stats?.total_projects || 0,
			totalViews: stats?.total_views || 0,
			totalUniqueViews: stats?.total_unique_views || 0,
			averageViews: Math.round(Number(stats?.avg_views || 0)),
			maxViews: stats?.max_views || 0,
			topProjects: topProjects.results,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Stats query error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// List all projects (with pagination)
app.get("/api/projects", async (c) => {
	const page = parseInt(c.req.query("page") || "1");
	const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
	const offset = (page - 1) * limit;

	await initDatabase(c.env.DB);

	try {
		const projects = await c.env.DB.prepare(
			`
			SELECT project_name, view_count, unique_views, description, created_at, updated_at
			FROM project_views
			ORDER BY view_count DESC
			LIMIT ? OFFSET ?
		`
		)
			.bind(limit, offset)
			.all();

		const total = await c.env.DB.prepare(
			"SELECT COUNT(*) as count FROM project_views"
		).first();

		return c.json({
			success: true,
			projects: projects.results,
			pagination: {
				page,
				limit,
				total: total?.count || 0,
				pages: Math.ceil(Number(total?.count || 0) / limit),
			},
		});
	} catch (error) {
		console.error("Projects query error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// Environment-based admin authentication with usage tracking
const adminAuth = async (c: any, next: any) => {
	const password =
		c.req.header("X-Admin-Password") || c.req.query("password");
	const adminPassword = c.env.ADMIN_PASSWORD || "admin123"; // Fallback for dev
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

	// Track admin usage
	await trackUsage(c.env.DB);
	await next();
};

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

// Admin: Get enhanced project statistics
app.get("/api/admin/stats", adminAuth, async (c) => {
	await initDatabase(c.env.DB);

	try {
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

		// Get today's views (approximate - based on updated_at)
		const todayStats = await c.env.DB.prepare(
			`
			SELECT COALESCE(SUM(view_count), 0) as today_views
			FROM project_views
			WHERE DATE(updated_at) = DATE('now')
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

		// Get recent activity
		const recentActivity = await c.env.DB.prepare(
			`
			SELECT project_name, view_count, updated_at
			FROM project_views
			ORDER BY updated_at DESC
			LIMIT 5
		`
		).all();

		return c.json({
			success: true,
			statistics: {
				totalViews: stats?.total_views || 0,
				uniqueViews: stats?.unique_views || 0,
				totalProjects: stats?.total_projects || 0,
				todayViews: todayStats?.today_views || 0,
				uptime: "99.9%", // Static for now
			},
			topProjects: topProjects.results,
			recentActivity: recentActivity.results,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Admin stats query error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// Admin: Get all projects with enhanced details
app.get("/api/admin/projects", adminAuth, async (c) => {
	const page = parseInt(c.req.query("page") || "1");
	const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
	const offset = (page - 1) * limit;
	const search = c.req.query("search") || "";

	await initDatabase(c.env.DB);

	try {
		let query = `
			SELECT project_name, view_count, unique_views, description,
				   created_at, updated_at
			FROM project_views
		`;
		let countQuery = "SELECT COUNT(*) as count FROM project_views";
		let bindings: any[] = [];

		if (search) {
			query += " WHERE project_name LIKE ? OR description LIKE ?";
			countQuery += " WHERE project_name LIKE ? OR description LIKE ?";
			const searchParam = `%${search}%`;
			bindings = [searchParam, searchParam];
		}

		query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
		bindings.push(limit, offset);

		const projects = await c.env.DB.prepare(query)
			.bind(...bindings)
			.all();

		const total = await c.env.DB.prepare(countQuery)
			.bind(...(search ? [bindings[0], bindings[1]] : []))
			.first();

		// Enhance each project with additional data
		const enhancedProjects = await Promise.all(
			projects.results?.map(async (project: any) => {
				// Get unique visitor count for this project
				const visitorCount = await c.env.DB.prepare(
					"SELECT COUNT(DISTINCT visitor_hash) as count FROM visitor_tracking WHERE project_name = ?"
				)
					.bind(project.project_name)
					.first();

				return {
					name: project.project_name,
					totalViews: project.view_count,
					uniqueViews: project.unique_views,
					uniqueVisitors: visitorCount?.count || 0,
					description: project.description,
					createdAt: project.created_at,
					lastUpdated: project.updated_at,
				};
			}) || []
		);

		return c.json({
			success: true,
			projects: enhancedProjects,
			pagination: {
				page,
				limit,
				total: total?.count || 0,
				pages: Math.ceil(Number(total?.count || 0) / limit),
			},
		});
	} catch (error) {
		console.error("Admin projects query error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// Admin: Create or update project
app.post("/api/admin/projects", adminAuth, async (c) => {
	const { name, description, initialViews = 0 } = await c.req.json();

	if (!name || typeof name !== "string") {
		return c.json(
			{
				success: false,
				error: "Project name is required",
			},
			400
		);
	}

	await initDatabase(c.env.DB);

	try {
		// Check if project exists
		const existing = await c.env.DB.prepare(
			"SELECT project_name FROM project_views WHERE project_name = ?"
		)
			.bind(name)
			.first();

		if (existing) {
			// Update existing project
			await c.env.DB.prepare(
				`
				UPDATE project_views
				SET description = ?, updated_at = CURRENT_TIMESTAMP
				WHERE project_name = ?
			`
			)
				.bind(description || null, name)
				.run();
		} else {
			// Create new project
			await c.env.DB.prepare(
				`
				INSERT INTO project_views (project_name, view_count, unique_views, description)
				VALUES (?, ?, ?, ?)
			`
			)
				.bind(name, initialViews, 0, description || null)
				.run();
		}

		return c.json({
			success: true,
			message: existing
				? "Project updated successfully"
				: "Project created successfully",
			project: { name, description, initialViews },
		});
	} catch (error) {
		console.error("Admin create/update project error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// Admin: Delete project
app.delete("/api/admin/projects/:name", adminAuth, async (c) => {
	const projectName = c.req.param("name");

	if (!projectName) {
		return c.json(
			{
				success: false,
				error: "Project name is required",
			},
			400
		);
	}

	await initDatabase(c.env.DB);

	try {
		// Delete project and related visitor tracking
		await c.env.DB.batch([
			c.env.DB.prepare(
				"DELETE FROM project_views WHERE project_name = ?"
			).bind(projectName),
			c.env.DB.prepare(
				"DELETE FROM visitor_tracking WHERE project_name = ?"
			).bind(projectName),
		]);

		return c.json({
			success: true,
			message: "Project deleted successfully",
		});
	} catch (error) {
		console.error("Admin delete project error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// Admin: Update project view count
app.put("/api/admin/projects/:name/views", adminAuth, async (c) => {
	const projectName = c.req.param("name");
	const { viewCount, uniqueViews } = await c.req.json();

	if (!projectName) {
		return c.json(
			{
				success: false,
				error: "Project name is required",
			},
			400
		);
	}

	if (viewCount === undefined || viewCount < 0) {
		return c.json(
			{
				success: false,
				error: "Valid view count is required",
			},
			400
		);
	}

	await initDatabase(c.env.DB);

	try {
		await c.env.DB.prepare(
			`
			UPDATE project_views
			SET view_count = ?, unique_views = ?, updated_at = CURRENT_TIMESTAMP
			WHERE project_name = ?
		`
		)
			.bind(viewCount, uniqueViews || 0, projectName)
			.run();

		return c.json({
			success: true,
			message: "View count updated successfully",
		});
	} catch (error) {
		console.error("Admin update views error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

// Admin: Get project analytics
app.get("/api/admin/projects/:name/analytics", adminAuth, async (c) => {
	const projectName = c.req.param("name");

	if (!projectName) {
		return c.json(
			{
				success: false,
				error: "Project name is required",
			},
			400
		);
	}

	await initDatabase(c.env.DB);

	try {
		// Get project details
		const project = await c.env.DB.prepare(
			"SELECT * FROM project_views WHERE project_name = ?"
		)
			.bind(projectName)
			.first();

		if (!project) {
			return c.json(
				{
					success: false,
					error: "Project not found",
				},
				404
			);
		}

		// Get visitor analytics
		const visitorStats = await c.env.DB.prepare(
			`
			SELECT
				COUNT(DISTINCT visitor_hash) as unique_visitors,
				SUM(visit_count) as total_visits,
				MIN(first_visit) as first_visitor,
				MAX(last_visit) as last_visitor
			FROM visitor_tracking
			WHERE project_name = ?
		`
		)
			.bind(projectName)
			.first();

		// Get recent visitors (last 10)
		const recentVisitors = await c.env.DB.prepare(
			`
			SELECT visitor_hash, visit_count, first_visit, last_visit
			FROM visitor_tracking
			WHERE project_name = ?
			ORDER BY last_visit DESC
			LIMIT 10
		`
		)
			.bind(projectName)
			.all();

		return c.json({
			success: true,
			project: {
				name: project.project_name,
				totalViews: project.view_count,
				uniqueViews: project.unique_views,
				description: project.description,
				createdAt: project.created_at,
				lastUpdated: project.updated_at,
			},
			analytics: {
				uniqueVisitors: visitorStats?.unique_visitors || 0,
				totalVisits: visitorStats?.total_visits || 0,
				firstVisitor: visitorStats?.first_visitor,
				lastVisitor: visitorStats?.last_visitor,
				recentVisitors:
					recentVisitors.results?.map((v: any) => ({
						hash: v.visitor_hash.substring(0, 8) + "...", // Partial hash for privacy
						visitCount: v.visit_count,
						firstVisit: v.first_visit,
						lastVisit: v.last_visit,
					})) || [],
			},
		});
	} catch (error) {
		console.error("Admin analytics error:", error);
		return c.json({ success: false, error: "Database error" }, 500);
	}
});

export default app;
