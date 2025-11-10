# ⚡ CFlairCounter - Hyper-Efficient Telemetry

**Ultra-lightweight serverless view counter optimized for headless telemetry across multiple projects.**

## 🤖 AI / Agent Integration

If you're an automated agent or integrating programmatically, start with the machine-friendly integration guide at the project root:

- `INTEGRATION.md` — agentic checklist, endpoints, CI examples, and step-by-step automation instructions.
-- `docs/` — human-friendly guides and deeper reference material (see `docs/README.md`).
-- `INTEGRATION.md` — root machine-friendly guide (preferred for agents).

Agents should read `INTEGRATION.md` first; it contains a deterministic checklist the agent can follow to configure `wrangler.toml`, bind D1, run a build, deploy, and verify endpoints.

[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Pages-orange?style=for-the-badge&logo=cloudflare)](https://pages.cloudflare.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge)](LICENSE.md)

---

## 🎯 Purpose

**Headless Telemetry System** - Send a single POST request from any project to track usage automatically.

```javascript
// In any of your projects - just one line!
fetch('https://your-domain.com/api/views/project-name', {method: 'POST'});
```

## ⚡ Architecture

```
Your App → POST webhook → Cloudflare Worker → D1 Database
                    ↓
            Admin Interface (when needed)
```

## 💰 Ultra-Efficient Costs

| Usage         | Monthly Cost     |
| ------------- | ---------------- |
| 1K webhooks   | **$0.00** (free) |
| 100K webhooks | **~$0.50**       |
| 1M webhooks   | **~$1.30-$3.40** |

## 🚀 Quick Start

### 1. Deploy
```bash
npm run deploy
npm run db:create
npm run db:init
```

### 2. Set Environment Variables
```bash
# In Cloudflare Dashboard
ADMIN_PASSWORD=your-secure-password
ENABLE_ANALYTICS=false  # Saves 50% DB rows
```

### 3. Use in Your Projects
```javascript
// Webhook telemetry - works headless
fetch('/api/views/my-project', {method: 'POST'});
```

## 📊 Admin Interface

Access admin panel at `/` when you need to:
- View project statistics
- Manage projects
- Monitor usage

## 🔧 Environment Configuration

| Variable           | Purpose               | Default    |
| ------------------ | --------------------- | ---------- |
| `ADMIN_PASSWORD`   | Secure admin access   | `dal-login"` |
| `ENABLE_ANALYTICS` | Track unique visitors | `false`    |
| `ENABLE_ADMIN`     | Enable admin panel    | `true`     |
| `MAX_PROJECTS`     | Limit projects        | `100`      |

## 📖 API Endpoints

| Endpoint                     | Method | Purpose               |
| ---------------------------- | ------ | --------------------- |
| `/api/views/{project}`       | GET    | Get statistics        |
| `/api/views/{project}`       | POST   | **Webhook telemetry** |
| `/api/views/{project}/badge` | GET    | SVG badge             |
| `/api/stats`                 | GET    | Global stats          |

## 🛡️ Security

- ✅ Environment-based admin password
- ✅ No secrets in source code
- ✅ Optional admin panel
- ✅ Usage monitoring

## 📄 License

Apache 2.0 - see [LICENSE.md](LICENSE.md)

### 🎯 Key Features

<table>
<tr>
<td width="33%">

#### ⚡ **Lightning Fast**
- Sub-100ms response times globally
- Cloudflare's edge network
- Optimized TypeScript codebase
- Built-in caching & CDN

</td>
<td width="33%">

#### 🔒 **Privacy-First**
- No personal data collection
- Anonymous visitor tracking
- GDPR compliant by design
- No cookies or tracking scripts

</td>
<td width="33%">

#### 💰 **Free Forever**
- No signup required
- Unlimited projects
- No hidden costs
- Powered by Cloudflare's free tier

</td>
</tr>
<tr>
<td>

#### 🛠️ **Developer Friendly**
- REST API with JSON responses
- Beautiful SVG badges
- TypeScript & modern tooling
- Comprehensive documentation

</td>
<td>

#### 📊 **Rich Analytics**
- Total views & unique visitors
- Project statistics
- Top projects dashboard
- Real-time updates

</td>
<td>

#### 🚀 **Enterprise Ready**
- D1 database for persistence
- Automatic scaling
- 99.9% uptime SLA
- Professional infrastructure

</td>
</tr>
</table>

---

```
CFlairCounter/
├── 📄 Documentation
│   ├── README.md
│   ├── USAGE.md
│   ├── DEPLOYMENT.md
│   ├── CONTRIBUTING.md
│   ├── CHANGELOG.md
│   └── LICENSE.md
├── ⚙️ Configuration
│   ├── package.json
│   ├── tsconfig.json
│   ├── wrangler.toml
│   ├── schema.sql
│   └── .gitignore (new)
├── 🌐 Frontend
│   ├── public/
│   │   ├── index.html (modern animated UI)
│   │   └── sw.js (enhanced service worker v2.0)
└── 🔧 Backend
    └── functions/api/[[path]].ts (TypeScript API with admin features)
```

---

## � Admin Panel

CFlairCounter now includes a password-protected admin panel for managing your projects:

### Features

- **📊 Enhanced Analytics** - Detailed statistics and visitor insights
- **🛠️ Project Management** - Create, edit, and delete projects
- **👥 Visitor Tracking** - Monitor unique visitors and their behavior
- **🔒 Secure Access** - Password-protected interface

### Access

1. Click the "Admin" button on the homepage
2. Enter your admin password (default: `dal-login"`)
3. Manage your projects with full control

### Admin API Endpoints

All admin endpoints require authentication via `X-Admin-Password` header or `password` query parameter:

```bash
# Get enhanced statistics
curl -H "X-Admin-Password: dal-login"" https://your-domain.com/api/admin/stats

# Get all projects with details
curl -H "X-Admin-Password: dal-login"" https://your-domain.com/api/admin/projects

# Create a new project
curl -X POST -H "X-Admin-Password: dal-login"" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project", "description": "My awesome project", "initialViews": 100}' \
  https://your-domain.com/api/admin/projects

# Update project view count
curl -X PUT -H "X-Admin-Password: dal-login"" \
  -H "Content-Type: application/json" \
  -d '{"viewCount": 500, "uniqueViews": 250}' \
  https://your-domain.com/api/admin/projects/my-project/views

# Delete a project
curl -X DELETE -H "X-Admin-Password: dal-login"" \
  https://your-domain.com/api/admin/projects/my-project

# Get project analytics
curl -H "X-Admin-Password: dal-login"" \
  https://your-domain.com/api/admin/projects/my-project/analytics
```

> **⚠️ Security Note**: Change the default password in production! Edit the `ADMIN_PASSWORD` constant in the API code.

---

## �🚀 Quick Start

### Option 1: Use Our Hosted Version (Recommended)

Add this to your HTML or README:

```html
<!-- Simple badge -->
<img src="https://cflaircounter.pages.dev/api/views/YOUR_PROJECT_NAME/badge" alt="Views">

<!-- Increment counter via JavaScript -->
<script>
  fetch('https://cflaircounter.pages.dev/api/views/YOUR_PROJECT_NAME', { method: 'POST' });
</script>
```

### Option 2: Deploy Your Own Instance

<details>
<summary><b>🔧 One-Click Deploy to Cloudflare Pages</b></summary>

1. **Fork this repository**
   ```bash
   gh repo fork VKrishna04/CFlairCounter
   ```

2. **Connect to Cloudflare Pages**
   - Go to [Cloudflare Pages](https://pages.cloudflare.com)
   - Connect your GitHub account
   - Select your forked repository
   - Use these settings:
     - **Build command**: `npm run build`
     - **Build output directory**: `public`
     - **Root directory**: `/`

3. **Set up D1 Database**
   ```bash
   # Install Wrangler CLI
   npm install -g wrangler

   # Login to Cloudflare
   wrangler login

   # Create database
   wrangler d1 create cflaircounter-db

   # Copy the database ID to wrangler.toml
   # Initialize database
   wrangler d1 execute cflaircounter-db --file=./schema.sql
   ```

4. **Deploy**
   ```bash
   wrangler pages deploy public
   ```

</details>

---

## 📖 API Documentation

### Base URL
```
https://cflaircounter.pages.dev
```

### Endpoints

<details>
<summary><b>📈 GET /api/views/{projectName}</b></summary>

Get view statistics for a project.

**Response:**
```json
{
  "projectName": "my-awesome-project",
  "view_count": 1337,
  "unique_views": 256,
  "description": "My awesome project description",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

**Example:**
```bash
curl https://cflaircounter.pages.dev/api/views/my-project
```

</details>

<details>
<summary><b>📊 POST /api/views/{projectName}</b></summary>

Increment view count for a project.

**Response:**
```json
{
  "projectName": "my-awesome-project",
  "view_count": 1338,
  "unique_views": 256,
  "success": true
}
```

**Example:**
```bash
curl -X POST https://cflaircounter.pages.dev/api/views/my-project
```

</details>

<details>
<summary><b>🎨 GET /api/views/{projectName}/badge</b></summary>

Generate an SVG badge for the project.

**Query Parameters:**
- `style`: Badge style (default: `flat`)
- `color`: Badge color (default: `blue`)
- `label`: Custom label (default: `views`)

**Example:**
```html
<img src="https://cflaircounter.pages.dev/api/views/my-project/badge?color=green&label=hits" alt="Project Views">
```

**Available Colors:**
- `blue`, `green`, `red`, `orange`, `yellow`, `purple`, `pink`, `gray`
- Hex colors: `#ff0000`

</details>

<details>
<summary><b>📊 GET /api/stats</b></summary>

Get global statistics across all projects.

**Response:**
```json
{
  "statistics": {
    "total_projects": 42,
    "total_views": 12345,
    "total_unique_views": 3456,
    "avg_views": 294,
    "max_views": 1337
  },
  "top_projects": [
    {
      "project_name": "awesome-project",
      "view_count": 1337,
      "unique_views": 256,
      "description": "An awesome project"
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

</details>

<details>
<summary><b>📋 GET /api/projects</b></summary>

List all projects with pagination.

**Query Parameters:**
- `page`: Page number (default: `1`)
- `limit`: Results per page (default: `50`, max: `100`)

**Response:**
```json
{
  "projects": [...],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 142,
    "pages": 3
  }
}
```

</details>

---

## 🎨 Badge Gallery

Showcase your project views with beautiful, customizable badges:

| Style            | Example                                                                                 | Code                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Default**      | ![Default](https://cflaircounter.pages.dev/api/views/demo/badge)                        | `![Views](https://cflaircounter.pages.dev/api/views/YOUR_PROJECT/badge)`                        |
| **Green**        | ![Green](https://cflaircounter.pages.dev/api/views/demo/badge?color=green)              | `![Views](https://cflaircounter.pages.dev/api/views/YOUR_PROJECT/badge?color=green)`            |
| **Custom Label** | ![Custom](https://cflaircounter.pages.dev/api/views/demo/badge?label=hits&color=purple) | `![Hits](https://cflaircounter.pages.dev/api/views/YOUR_PROJECT/badge?label=hits&color=purple)` |

---

## 🛠️ Development

### Prerequisites

- Node.js 18+
- npm or yarn
- Wrangler CLI
- Cloudflare account

### Local Development

```bash
# Clone the repository
git clone https://github.com/VKrishna04/CFlairCounter.git
cd CFlairCounter

# Install dependencies
npm install

# Set up local database
wrangler d1 create cflaircounter-db-local
wrangler d1 execute cflaircounter-db-local --file=./schema.sql

# Start development server
npm run dev
```

### Project Structure

```
CFlairCounter/
├── 📁 functions/
│   └── 📁 api/
│       └── 📄 [[path]].ts      # Main API handler
├── 📁 public/
│   ├── 📄 index.html           # Landing page
│   └── 📄 sw.js               # Service worker
├── 📄 schema.sql               # Database schema
├── 📄 wrangler.toml           # Cloudflare configuration
├── 📄 package.json            # Dependencies
└── 📄 tsconfig.json           # TypeScript config
```

### Available Scripts

```bash
npm run dev          # Start development server
npm run deploy       # Deploy to Cloudflare Pages
npm run build        # Build TypeScript
npm run type-check   # Type checking
npm run db:create    # Create D1 database
npm run db:init      # Initialize database schema
```

---

## 🔒 Privacy & Security

### Data Collection
- **Visitor Tracking**: Anonymous hash based on IP + User Agent
- **No Personal Data**: No names, emails, or identifiable information
- **No Cookies**: Client-side tracking is cookie-free
- **GDPR Compliant**: Minimal data collection by design

### Security Features
- **Rate Limiting**: Built-in protection against abuse
- **Input Validation**: Sanitized project names and parameters
- **CORS Protection**: Configurable origin restrictions
- **SQL Injection**: Prepared statements for all queries

---

## 🚀 Performance

### Benchmarks

| Metric            | Value  | Description                      |
| ----------------- | ------ | -------------------------------- |
| **Response Time** | <100ms | P95 globally via Cloudflare Edge |
| **Uptime**        | 99.9%  | Cloudflare's SLA guarantee       |
| **Cold Start**    | <50ms  | Optimized TypeScript bundle      |
| **Database**      | <10ms  | D1 query performance             |

### Optimization Features
- **Edge Caching**: 5-minute cache for badges
- **Database Indexing**: Optimized queries with proper indexes
- **Batch Operations**: Efficient bulk database operations
- **Service Worker**: Client-side caching for static assets

---

## 🤝 Contributing

We love contributions! Here's how you can help:

### 🐛 Report Bugs
Found a bug? [Open an issue](https://github.com/VKrishna04/CFlairCounter/issues/new?template=bug_report.md) with:
- Clear description
- Steps to reproduce
- Expected vs actual behavior
- Environment details

### 💡 Suggest Features
Have an idea? [Start a discussion](https://github.com/VKrishna04/CFlairCounter/discussions/new?category=ideas) or [open a feature request](https://github.com/VKrishna04/CFlairCounter/issues/new?template=feature_request.md).

### 🔧 Development Contribution

1. **Fork & Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/CFlairCounter.git
   ```

2. **Create Branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make Changes**
   - Follow TypeScript best practices
   - Add tests for new features
   - Update documentation

4. **Test Locally**
   ```bash
   npm run dev
   npm run type-check
   ```

5. **Submit PR**
   - Clear description of changes
   - Link related issues
   - Add screenshots if UI changes

---

## 📊 Usage Analytics

Real usage statistics for CFlairCounter:

<div align="center">

| ![Total Projects](https://cflaircounter.pages.dev/api/views/stats-projects/badge?label=projects&color=blue) | ![Total Views](https://cflaircounter.pages.dev/api/views/stats-views/badge?label=total%20views&color=green) | ![Unique Users](https://cflaircounter.pages.dev/api/views/stats-users/badge?label=unique%20users&color=purple) |
| :---------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------: |

</div>

---

## 🌟 Showcase

Projects using CFlairCounter:

<table>
<tr>
<td align="center">
<img src="https://cflaircounter.pages.dev/api/views/awesome-project-1/badge?color=blue" alt="Views"><br>
<b>Awesome Project 1</b><br>
<a href="https://github.com/user/project1">github.com/user/project1</a>
</td>
<td align="center">
<img src="https://cflaircounter.pages.dev/api/views/cool-library/badge?color=green" alt="Views"><br>
<b>Cool Library</b><br>
<a href="https://github.com/user/library">github.com/user/library</a>
</td>
<td align="center">
<img src="https://cflaircounter.pages.dev/api/views/amazing-tool/badge?color=purple" alt="Views"><br>
<b>Amazing Tool</b><br>
<a href="https://github.com/user/tool">github.com/user/tool</a>
</td>
</tr>
</table>

*Want your project featured? [Submit a PR](https://github.com/VKrishna04/CFlairCounter/pulls) or [open an issue](https://github.com/VKrishna04/CFlairCounter/issues/new)!*

---

## 📋 Roadmap

### 🎯 Current Focus (Q1 2025)
- [ ] **Enhanced Analytics Dashboard**
- [ ] **Referrer Tracking** (optional, privacy-focused)
- [ ] **API Rate Limiting Improvements**
- [ ] **Custom Badge Themes**

### 🔮 Future Features
- [ ] **Webhooks for View Milestones**
- [ ] **Geographic Analytics** (country-level)
- [ ] **API Keys for Private Projects**
- [ ] **Slack/Discord Integrations**

### 🏗️ Technical Improvements
- [ ] **GraphQL API Option**
- [ ] **Real-time WebSocket Updates**
- [ ] **Advanced Caching Strategies**
- [ ] **Multi-region Database Replication**

---

## 🆚 Comparison

| Feature         | CFlairCounter | Google Analytics | Simple Analytics  | Plausible         |
| --------------- | ------------- | ---------------- | ----------------- | ----------------- |
| **Setup Time**  | < 1 minute    | 15+ minutes      | 5 minutes         | 10 minutes        |
| **Privacy**     | ✅ Anonymous   | ❌ Tracks users   | ✅ Privacy-focused | ✅ Privacy-focused |
| **Cost**        | 🆓 Free        | 🆓 Free*          | 💰 Paid            | 💰 Paid            |
| **Performance** | ⚡ <100ms      | 🐌 Varies         | ⚡ Fast            | ⚡ Fast            |
| **Complexity**  | 🟢 Simple      | 🔴 Complex        | 🟡 Medium          | 🟡 Medium          |
| **Self-hosted** | ✅ Yes         | ❌ No             | ❌ No              | ✅ Yes             |

*Google Analytics is free but has data limits and privacy concerns

---

## 🤔 FAQ

<details>
<summary><b>Is CFlairCounter really free?</b></summary>

Yes! CFlairCounter is completely free and open-source. You can use our hosted version or deploy your own instance. The only costs would be if you exceed Cloudflare's generous free tier limits (which is unlikely for most projects).

</details>

<details>
<summary><b>How accurate are the view counts?</b></summary>

CFlairCounter tracks both total views and unique visitors. Unique visitors are identified by a privacy-friendly hash of IP + User Agent, which provides good accuracy while maintaining privacy.

</details>

<details>
<summary><b>Can I migrate from other analytics platforms?</b></summary>

While CFlairCounter doesn't have automatic migration tools, you can manually set initial view counts by making POST requests to the API. Contact us if you need help with large-scale migrations.

</details>

<details>
<summary><b>What's the rate limit?</b></summary>

Currently, there are soft rate limits based on Cloudflare's standard protections. For normal usage, you shouldn't hit any limits. If you need higher limits, consider deploying your own instance.

</details>

<details>
<summary><b>How do I delete a project?</b></summary>

Project deletion is not currently available through the public API for security reasons. If you need to delete project data, please open an issue on GitHub.

</details>

---

## 📄 License

This project is licensed under the **Apache License 2.0** - see the [LICENSE.md](LICENSE.md) file for details.

### Why Apache 2.0?
- ✅ Commercial use allowed
- ✅ Modification allowed
- ✅ Distribution allowed
- ✅ Patent protection
- ✅ Private use allowed

---

## 🙏 Acknowledgments

Special thanks to:

- **[Cloudflare](https://cloudflare.com)** - For providing amazing free infrastructure
- **[Hono](https://hono.dev)** - Lightweight web framework for the edge
- **[TypeScript](https://typescriptlang.org)** - Making JavaScript development enjoyable
- **[Tailwind CSS](https://tailwindcss.com)** - Utility-first CSS framework
- **All contributors** - Making this project better every day

---

## 📞 Support & Contact

<div align="center">

### Need Help?

[![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-red?style=for-the-badge&logo=github)](https://github.com/VKrishna04/CFlairCounter/issues)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-blue?style=for-the-badge&logo=github)](https://github.com/VKrishna04/CFlairCounter/discussions)
[![Twitter](https://img.shields.io/badge/Twitter-@VKrishna04-1DA1F2?style=for-the-badge&logo=twitter)](https://twitter.com/VKrishna04)

### Author

**VKrishna04**
- 🌐 Website: [vkrishna04.github.io](https://vkrishna04.github.io)
- 🐙 GitHub: [@VKrishna04](https://github.com/VKrishna04)
- 📧 Email: Contact via GitHub

</div>

---

<div align="center">

**Made with ❤️ by [VKrishna04](https://github.com/VKrishna04)**

[![Star this repo](https://img.shields.io/badge/⭐-Star%20this%20repo-yellow?style=for-the-badge)](https://github.com/VKrishna04/CFlairCounter)
[![Follow @VKrishna04](https://img.shields.io/badge/👤-Follow%20@VKrishna04-blue?style=for-the-badge)](https://github.com/VKrishna04)

</div>
    E[Real-time Stats]
    F[Project Management]
    G[Connection Testing]
    H[Database Schema Viewer]
  end

  A --> E
  A --> F
  A --> G
  A --> H
```

---

## 🚀 Deploy in Minutes (No Coding Required!)

### 1. Create a Free PostgreSQL Database

- [![Create Free DB on Filess.io](https://img.shields.io/badge/Create%20Free%20DB-Filess.io-blue?logo=postgresql)](https://filess.io/)
- Go to [Filess.io Free Cloud DB Plans](https://filess.io/) and sign up for a free account.
- Create a new PostgreSQL database (choose the latest version if possible).
- Copy your database credentials (host, port, db name, user, password).
- **Or see [this gist for more free cloud DB options](https://gist.github.com/bmaupin/0ce79806467804fdbbf8761970511b8c).**

### 2. Deploy to Render

- Click this button:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Life-Experimentalist/CounterAPI)

- Render will detect `render.yaml` and prompt you for environment variables:
    - `DB_HOST` (e.g. `your-db-host.filess.io`)
    - `DB_PORT` (e.g. `5432` or as given by Filess.io)
    - `DB_NAME` (your database name)
    - `DB_USER` (your database user)
    - `DB_PASS` (your database password)
- Fill in these values from your Filess.io dashboard.
- Choose a service name and region (pick one close to your DB for best speed).
- Click **Create Web Service** and wait for deployment.

That's it! Your API is live and ready to use. No code changes or manual setup required.

---

## 🗄️ Initializing Your Database on Filess.io

> If you are using Filess.io (or similar) for your PostgreSQL database, you must manually create the schema and table before deploying:

> Please refer to [this](https://support.filess.io/hc/wiki/articles/1710108465-how-to-create-a-table-in-postgre_sql-with-web-client) for detailed instructions.

1. **Create your PostgreSQL database** on Filess.io.
2. **Access the web client** from your Filess.io dashboard.
3. **Open a new query tab** (click the `+` at the top right).
4. **Paste and run the following SQL** (click the `>` beside the line numbers to execute):

```sql
CREATE SCHEMA myschema; -- create the schema first (replace 'myschema' with your schema name if desired)

CREATE TABLE myschema.projects (
    name TEXT PRIMARY KEY,
    description TEXT,
    count INTEGER DEFAULT 0
);
```

5. **Refresh the tables list** in the web client to confirm your table is created.
6. **Set the `DB_SCHEMA` environment variable** in Render to match your schema name (e.g., `myschema`).

---

## 📡 API Reference

- `GET /projects` — List all projects with their counts and descriptions
- `POST /projects` — Add a new project (name and optional description)
- `PUT /projects?name={name}` — Update a project's name and/or description
- `DELETE /projects/{name}` — Delete a project by name
- `POST /projects/ping` — Increment a project's count by 1
- `GET /health` — Check API and database connectivity status
- `GET /meta` — View detailed deployment and database info (tables, columns, row counts)
- `GET /` — Serve the interactive dashboard (index.html)

---

## 🧩 Tech Stack

* [FastAPI](https://fastapi.tiangolo.com/) - backend framework
* [PostgreSQL](https://www.postgresql.org/) - [free cloud database](https://www.filess.io)
* [Render](https://render.com/) - free cloud hosting
* [GitHub Pages](https://pages.github.com/) - static site hosting

---

## 🛡️ License

Apache 2.0 – Free for personal, educational, and commercial use.

---

## 🙋‍♀️ Contributing

Want to run locally or contribute?

- Clone the repo and install dependencies:
  ```bash
  git clone https://github.com/Life-Experimentalist/CounterAPI.git
  cd CounterAPI
  pip install -r requirements.txt psycopg2-binary
  ```
- Set up a local PostgreSQL database and configure the environment variables as in the deployment instructions.
- PRs and suggestions are welcome!

---
