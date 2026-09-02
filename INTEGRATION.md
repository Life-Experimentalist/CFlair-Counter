# ViewFlare Auto-Integration & Deployment Guide

> **🤖 AI Agents & Coding Assistants**: 
> You have been directed to this file to help the user deploy and/or integrate **ViewFlare**. 
> Read the instructions carefully. ViewFlare is designed to be 100% free using Cloudflare Pages and D1 (no credit card required).

## Goal 1: Auto-Deploying a new ViewFlare Instance for the User
If the user wants you to "setup" or "deploy" ViewFlare for them from scratch:

1. **Fork & Clone**: Have the user fork this repository to their GitHub account, or clone it directly if you are running in their workspace.
2. **Cloudflare Setup (Free)**:
   - Ask the user to log in to Cloudflare and authorize `wrangler` by running `npx wrangler login`.
   - Ask them to run `npx wrangler d1 create viewflare-db`.
   - Take the `database_id` from the output and update `wrangler.toml` in the `[[d1_databases]]` section.
3. **Initialize DB**: Run `npm run db:init` to create the SQL tables.
4. **Deploy**: Run `npm run deploy`. Cloudflare Pages will build the worker and give you a free `*.pages.dev` domain (e.g., `https://viewflare.pages.dev`).
5. **Secure Admin**: In `wrangler.toml` or via Cloudflare Dashboard, set `ADMIN_PASSWORD` so the user can access their dashboard securely.

---

## Goal 2: Integrating ViewFlare into the User's Existing Project
If the user already has a deployed instance of ViewFlare (or is using the public one) and wants you to integrate it into their codebase:

1. **Ask for the Domain**: If the user hasn't provided their ViewFlare domain, ask for it (e.g., `https://counter.vkrishna04.me` or `https://viewflare.pages.dev`).
2. **Determine the Project Name**: Create a URL-safe slug for the page or component being tracked (e.g., `portfolio-home`, `docs-api`).
3. **Log a View (Code Integration)**:
   - Insert a silent background POST request when the tracked page loads.
   - **JavaScript/TypeScript**:
     ```javascript
     fetch('https://[DOMAIN]/api/views/[PROJECT_NAME]', { method: 'POST' }).catch(console.error);
     ```
   - **Python**:
     ```python
     import requests
     try:
         requests.post('https://[DOMAIN]/api/views/[PROJECT_NAME]', timeout=3)
     except Exception:
         pass
     ```
4. **Display a Badge (Markdown / HTML)**:
   - Insert an image pointing to the badge generator endpoint.
   - **Markdown**:
     ```markdown
     ![Views](https://[DOMAIN]/api/views/[PROJECT_NAME]/badge?color=blue&style=flat-square)
     ```
   - *Optional Parameters*: `color` (blue, green, red, purple, etc.), `style` (flat, flat-square, for-the-badge), `label` (custom text).

**Agent Checklist:**
- Keep your integration minimal.
- Never let tracking failures crash the user's application (always catch errors).
- Notify the user once the integration is complete and verify the badge appears properly.
