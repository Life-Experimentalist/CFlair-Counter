#!/usr/bin/env node
/**
 * Runs automatically after `npm install`, via package.json's "prepare" script.
 *
 * Git has no post-clone hook, so nothing can run at the moment someone clones
 * this repo. `npm install` is the step everyone takes next, and "prepare" is
 * the hook npm fires for it, which makes this the closest thing to a
 * post-clone trigger that exists.
 *
 * It deliberately does not create Cloudflare resources. `npm install` also runs
 * in CI, in Docker builds and after every dependency change, none of which
 * should provision anything. It points at the one command that does.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");

	// Nothing to say in CI, and nothing to say once setup has run.
	if (process.env.CI) process.exit(0);
	if (existsSync(join(root, ".viewflare", "setup-complete"))) process.exit(0);

	console.log("");
	console.log("  ViewFlare has no instance deployed from this checkout yet.");
	console.log("  One command creates your own on the Cloudflare free tier:");
	console.log("");
	console.log("      npm run setup");
	console.log("");
} catch {
	// A hint is never worth failing an install over.
	process.exit(0);
}
