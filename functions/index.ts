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
	RATE_LIMIT_REQUESTS?: string;
	RATE_LIMIT_WINDOW?: string;
	DEBUG?: string;
};

type Variables = {
	visitorHash?: string;
	projectName?: string;
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
			429
		);
	}

	// Add rate limit headers
	c.header("X-RateLimit-Limit", maxRequests.toString());
	c.header(
		"X-RateLimit-Remaining",
		(maxRequests - rateLimitData.count).toString()
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

// CORS middleware with optimized settings for multiple domains
app.use(
	"*",
	cors({
		origin: (origin) => {
			// Allow requests from both domains and any origin (for embedded usage)
			const allowedOrigins = [
				"https://cflaircounter.pages.dev",
				"https://counter.vkrishna04.me",
				"http://localhost:8788",
				"http://127.0.0.1:8788",
			];

			// Allow if origin is in the list or allow all for flexibility
			return origin &&
				allowedOrigins.some((allowed) => origin.startsWith(allowed))
				? origin
				: "*";
		},
		allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
		maxAge: 86400, // Cache preflight for 24 hours
		credentials: false, // Set to false for public API
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
	// Debug logging only if DEBUG env variable is set to "true"
	const enableAdmin = c.env.ENABLE_ADMIN !== "false";
	if (c.env.DEBUG === "true") {
		console.log("🔧 [DEBUG] System Configuration:");
		console.log("  - Admin Enabled:", enableAdmin);
		console.log(
			"  - Analytics Enabled:",
			c.env.ENABLE_ANALYTICS !== "false"
		);
	}

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
// Shields.io style with better aesthetics
app.get("/api/views/:projectName/badge", async (c) => {
	const projectName = c.req.param("projectName");
	const style = c.req.query("style") || "flat"; // flat, flat-square, for-the-badge
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

		const viewCount = Number(result?.view_count) || 0;

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

		const badgeColor = colorMap[color] || color;

		// Calculate widths dynamically
		const labelWidth = Math.max(label.length * 6.5 + 10, 40);
		const valueText =
			viewCount >= 1000
				? `${(viewCount / 1000).toFixed(1)}k`
				: viewCount.toString();
		const valueWidth = Math.max(valueText.length * 7 + 10, 30);
		const totalWidth = labelWidth + valueWidth;

		let svg = "";

		if (style === "flat") {
			// Modern flat style (shields.io default)
			svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${viewCount}">
	<title>${label}: ${viewCount}</title>
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
			}">${label}</text>
		<text x="${
			(labelWidth / 2) * 10
		}" y="140" transform="scale(.1)" fill="#fff" textLength="${
				(labelWidth - 10) * 10
			}">${label}</text>
		<text aria-hidden="true" x="${
			(labelWidth + valueWidth / 2) * 10
		}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${
				(valueWidth - 10) * 10
			}">${valueText}</text>
		<text x="${
			(labelWidth + valueWidth / 2) * 10
		}" y="140" transform="scale(.1)" fill="#fff" textLength="${
				(valueWidth - 10) * 10
			}">${valueText}</text>
	</g>
</svg>`;
		} else if (style === "flat-square") {
			// Flat square style (no rounded corners)
			svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${viewCount}">
	<title>${label}: ${viewCount}</title>
	<g shape-rendering="crispEdges">
		<rect width="${labelWidth}" height="20" fill="#555"/>
		<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${badgeColor}"/>
	</g>
	<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
		<text x="${
			(labelWidth / 2) * 10
		}" y="140" transform="scale(.1)" fill="#fff" textLength="${
				(labelWidth - 10) * 10
			}">${label}</text>
		<text x="${
			(labelWidth + valueWidth / 2) * 10
		}" y="140" transform="scale(.1)" fill="#fff" textLength="${
				(valueWidth - 10) * 10
			}">${valueText}</text>
	</g>
</svg>`;
		} else if (style === "for-the-badge") {
			// Bold style with larger text
			const boldHeight = 28;
			svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${boldHeight}" role="img" aria-label="${label}: ${viewCount}">
	<title>${label}: ${viewCount}</title>
	<g shape-rendering="crispEdges">
		<rect width="${labelWidth}" height="${boldHeight}" fill="#555"/>
		<rect x="${labelWidth}" width="${valueWidth}" height="${boldHeight}" fill="${badgeColor}"/>
	</g>
	<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="100" font-weight="bold">
		<text x="${
			(labelWidth / 2) * 10
		}" y="175" transform="scale(.1)" fill="#fff" textLength="${
				(labelWidth - 10) * 10
			}">${label.toUpperCase()}</text>
		<text x="${
			(labelWidth + valueWidth / 2) * 10
		}" y="175" transform="scale(.1)" fill="#fff" textLength="${
				(valueWidth - 10) * 10
			}">${valueText}</text>
	</g>
</svg>`;
		} else {
			// Default to flat style
			svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
	<rect width="${labelWidth}" height="20" fill="#555"/>
	<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${badgeColor}"/>
	<text x="${
		labelWidth / 2
	}" y="14" fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle">${label}</text>
	<text x="${
		labelWidth + valueWidth / 2
	}" y="14" fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle">${valueText}</text>
</svg>`;
		}

		c.header("Content-Type", "image/svg+xml");
		c.header("Cache-Control", "public, max-age=300, s-maxage=600"); // 5min browser, 10min CDN
		c.header("Access-Control-Allow-Origin", "*");
		return c.body(svg.trim());
	} catch (error) {
		console.error("Badge generation error:", error);
		return c.text("Error generating badge", 500);
	}
});

// Generate SVG badge for project views
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
		`
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
			500
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

		// Check if project exists
		const existingProject = await c.env.DB.prepare(
			"SELECT project_name FROM project_views WHERE project_name = ?"
		)
			.bind(projectName)
			.first();

		if (!existingProject) {
			return c.json(
				{
					success: false,
					error: "Project not found",
				},
				404
			);
		}

		// Delete from both tables
		await c.env.DB.prepare(
			"DELETE FROM project_views WHERE project_name = ?"
		)
			.bind(projectName)
			.run();

		await c.env.DB.prepare(
			"DELETE FROM visitor_tracking WHERE project_name = ?"
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
			500
		);
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
				/\.(html|css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|json|webp)$/i
			)
		) {
			return env.ASSETS.fetch(request);
		}

		// Handle API routes through Hono
		return app.fetch(request, env, ctx);
	},
};
