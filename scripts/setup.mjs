#!/usr/bin/env node
/**
 * One-command setup for a fresh ViewFlare instance.
 *
 *   npm install && npm run setup
 *
 * Every step is idempotent, so re-running it after a partial failure is safe
 * and is the intended way to recover. Nothing here destroys an existing
 * deployment's data: the database is created only if it is absent, and
 * schema.sql uses CREATE TABLE IF NOT EXISTS throughout.
 *
 * This script never reads, stores or transmits your admin password. When one is
 * needed it hands the terminal to `wrangler secret put`, which prompts you
 * directly and sends it to Cloudflare without it passing through here.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOML = join(ROOT, "wrangler.toml");
const MARKER = join(ROOT, ".viewflare", "setup-complete");
const DB_NAME = "viewflare-db";

// wrangler runs as a plain node script rather than through npx. Since Node
// 18.20.2 a bare spawn of "npx.cmd" on Windows fails with EINVAL, and the usual
// `shell: true` workaround then warns about unescaped arguments. Calling the
// installed entry point directly avoids both and skips npx's own resolution.
const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

let step = 0;
const say = (msg) => console.log(`\n[${++step}] ${msg}`);
const ok = (msg) => console.log(`    ok: ${msg}`);
const info = (msg) => console.log(`    ${msg}`);

function die(msg, hint) {
	console.error(`\nSetup stopped: ${msg}`);
	if (hint) console.error(`\n${hint}`);
	process.exit(1);
}

/** Run wrangler and capture its output. */
function wrangler(args, { inherit = false } = {}) {
	if (!existsSync(WRANGLER)) {
		die(
			"wrangler is not installed in this checkout",
			"Run `npm install` first, then `npm run setup` again.",
		);
	}
	const result = spawnSync(process.execPath, [WRANGLER, ...args], {
		cwd: ROOT,
		encoding: "utf8",
		stdio: inherit ? "inherit" : "pipe",
	});
	if (result.error) {
		die(`could not run wrangler (${result.error.message})`);
	}
	return {
		code: result.status ?? 1,
		stdout: result.stdout || "",
		stderr: result.stderr || "",
	};
}

/**
 * wrangler prints npm notices and a coloured config warning before any JSON, so
 * the payload starts at the first line beginning with a bracket rather than at
 * the first bracket in the string.
 */
function wranglerJson(args) {
	const { code, stdout, stderr } = wrangler([...args, "--json"]);
	const at = stdout.search(/^\s*[[{]/m);
	if (code !== 0 || at === -1) {
		die(
			`wrangler ${args.join(" ")} failed`,
			(stderr || stdout).trim().slice(0, 800),
		);
	}
	try {
		return JSON.parse(stdout.slice(at));
	} catch (error) {
		die(`could not read wrangler's output as JSON (${error.message})`);
	}
}

console.log("ViewFlare setup");
console.log("Creates your own Worker and D1 database on the Cloudflare free tier.");

// ---------------------------------------------------------------- 1. account
say("Checking your Cloudflare login");
const who = wrangler(["whoami"]);
if (who.code !== 0) {
	die(
		"wrangler is not logged in",
		"Run `npx wrangler login`, approve it in the browser, then run `npm run setup` again.",
	);
}
const account = (who.stdout.match(/associated with the email ([^\s]+)/i) || [])[1];
ok(account ? `signed in as ${account}` : "signed in");

// --------------------------------------------------------------- 2. database
say(`Looking for a D1 database named "${DB_NAME}"`);
const databases = wranglerJson(["d1", "list"]);
let db = (Array.isArray(databases) ? databases : []).find(
	(entry) => entry.name === DB_NAME,
);

if (db) {
	ok(`found an existing one (${db.uuid})`);
	info("Its data is left untouched.");
} else {
	info("none found, creating one");
	const created = wrangler(["d1", "create", DB_NAME]);
	if (created.code !== 0) {
		die(
			"could not create the database",
			(created.stderr || created.stdout).trim().slice(0, 800),
		);
	}
	const uuid = (created.stdout.match(/database_id\s*=\s*"([0-9a-f-]{36})"/) ||
		[])[1];
	if (!uuid) {
		die(
			"the database was created but wrangler did not print an id",
			"Run `npx wrangler d1 list` and put the id into wrangler.toml by hand.",
		);
	}
	db = { uuid };
	ok(`created (${uuid})`);
}

// ------------------------------------------------------------------- 3. toml
say("Pointing wrangler.toml at your database");
const toml = readFileSync(TOML, "utf8");
const idLine = /^database_id\s*=\s*".*"$/m;
if (!idLine.test(toml)) {
	die(
		"no database_id line found in wrangler.toml",
		'Add `database_id = ""` under [[d1_databases]] and run this again.',
	);
}
const patched = toml.replace(idLine, `database_id = "${db.uuid}"`);
if (patched === toml) {
	ok("already correct");
} else {
	writeFileSync(TOML, patched, "utf8");
	ok(`database_id set to ${db.uuid}`);
}

// ----------------------------------------------------------------- 4. schema
say("Creating the tables");
const schema = wrangler([
	"d1",
	"execute",
	DB_NAME,
	"--remote",
	"--file=./schema.sql",
	"-y",
]);
if (schema.code !== 0) {
	die(
		"could not apply schema.sql",
		(schema.stderr || schema.stdout).trim().slice(0, 800),
	);
}
ok("schema applied, existing tables left as they were");

// ---------------------------------------------------------- 5. configuration
// Nothing to prompt for. Every variable the code reads is already in [vars]
// with the value the code falls back to, so an instance is configured by
// editing a line rather than by discovering a name. This step exists to show
// the list, because a fork that does not know a setting exists cannot use it.
say("Configuration");
const tomlLines = patched.split(/\r?\n/);
const varsAt = tomlLines.findIndex((line) => line.trim() === "[vars]");
const settings = [];
for (let i = varsAt + 1; varsAt !== -1 && i < tomlLines.length; i++) {
	if (tomlLines[i].startsWith("[")) break;
	const match = tomlLines[i].match(/^([A-Z][A-Z0-9_]*)\s*=\s*(".*?")/);
	if (match) settings.push(`${match[1]} = ${match[2]}`);
}
if (settings.length) {
	info(`${settings.length} settings, already initialised in wrangler.toml:`);
	for (const line of settings) info(`    ${line}`);
	info("");
	info("ENABLE_* are on unless the value is exactly \"false\".");
	info("TRACK_* and DEBUG are off unless it is exactly \"true\".");
	info("");
	info("To change one: edit that line, then `npm run deploy`.");
	info("Do not set these in the Cloudflare dashboard. A deploy replaces the");
	info("whole list, so a dashboard-only variable vanishes with no error.");
} else {
	info("No [vars] block found in wrangler.toml, which is unexpected.");
	info("The code falls back to its own defaults, so this is not fatal.");
}

// --------------------------------------------------------------- 6. password
say("Admin password");
if (process.stdin.isTTY) {
	info("wrangler prompts you next. This script never sees what you type.");
	info("Ctrl+C skips it; the admin console stays locked until it is set.");
	wrangler(["secret", "put", "ADMIN_PASSWORD"], { inherit: true });
} else {
	info("Not an interactive terminal, so the prompt is skipped.");
	info("Run this yourself before using the admin console:");
	info("    npx wrangler secret put ADMIN_PASSWORD");
}

// ----------------------------------------------------------------- 7. deploy
say("Building and deploying");
// A single command string rather than an argument array: npm needs a shell on
// Windows for the same EINVAL reason as above, and passing args alongside
// `shell` warns about escaping. Nothing here is user supplied.
const deploy = spawnSync("npm run deploy", {
	cwd: ROOT,
	encoding: "utf8",
	stdio: "pipe",
	shell: true,
});
const deployOut = (deploy.stdout || "") + (deploy.stderr || "");
if ((deploy.status ?? 1) !== 0) {
	die("deploy failed", deployOut.trim().slice(0, 1200));
}
const url = (deployOut.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];
ok("deployed");

// ------------------------------------------------------------------- 8. done
mkdirSync(dirname(MARKER), { recursive: true });
writeFileSync(MARKER, `${new Date().toISOString()}\n`, "utf8");

console.log("\nDone.");
if (url) {
	console.log(`\n  ${url}/health     is it alive`);
	console.log(`  ${url}/admin      admin console`);
	console.log("\nCount a view:");
	console.log(`  curl -X POST ${url}/api/views/MyProject`);
} else {
	console.log(
		"\nwrangler printed no URL. Run `npx wrangler deployments list` to find it.",
	);
}
console.log("\nTo put it on your own domain (the zone must be on this account):");
console.log("  npx wrangler deploy --domains counter.example.com");
console.log("That adds the DNS record too, and later deploys keep it.");
