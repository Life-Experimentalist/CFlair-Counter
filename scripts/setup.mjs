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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOML = join(ROOT, "wrangler.toml");
const MARKER = join(ROOT, ".viewflare", "setup-complete");
const DB_NAME = "viewflare-db";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

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
	const result = spawnSync(NPX, ["wrangler", ...args], {
		cwd: ROOT,
		encoding: "utf8",
		stdio: inherit ? "inherit" : "pipe",
	});
	if (result.error) {
		die(
			`could not run wrangler (${result.error.message})`,
			"Run `npm install` first so wrangler is available.",
		);
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

// --------------------------------------------------------------- 5. password
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

// ----------------------------------------------------------------- 6. deploy
say("Building and deploying");
const deploy = spawnSync(NPM, ["run", "deploy"], {
	cwd: ROOT,
	encoding: "utf8",
	stdio: "pipe",
});
const deployOut = (deploy.stdout || "") + (deploy.stderr || "");
if ((deploy.status ?? 1) !== 0) {
	die("deploy failed", deployOut.trim().slice(0, 1200));
}
const url = (deployOut.match(/https:\/\/[^\s]+\.workers\.dev/) || [])[0];
ok("deployed");

// ------------------------------------------------------------------- 7. done
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
console.log("\nTo use your own domain: Cloudflare dashboard, Workers & Pages,");
console.log("viewflare, Settings, Domains & Routes.");
