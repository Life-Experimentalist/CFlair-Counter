/* ViewFlare admin console.
 *
 * The page ships a sign-in form and an empty <main>. Everything else is built
 * here, after the Worker has accepted a password. The password lives in this
 * closure for the life of the tab and is never written to localStorage,
 * sessionStorage or a cookie, so closing the tab signs you out.
 *
 * Reads go to the admin routes, never to GET /api/stats or GET /api/views.
 * Those two sit behind a 300s and a 60s edge cache, so setting a count and
 * reloading would show the old figure and look like a bug.
 */
(function () {
	"use strict";

	var API = window.location.origin;
	var auth = "";
	var projects = [];
	var sort = { key: "view_count", dir: -1 };
	var filter = "";

	var app = document.getElementById("app");
	var toastEl = document.getElementById("toast");
	var toastTimer = null;

	/* --- helpers ------------------------------------------------------- */

	function esc(value) {
		return String(value === null || value === undefined ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	// A number that is missing is missing. It is never rendered as zero.
	function num(value) {
		return typeof value === "number" && isFinite(value)
			? value.toLocaleString()
			: "unavailable";
	}

	function toast(message, kind) {
		toastEl.textContent = message;
		toastEl.className = "toast show " + (kind || "info");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () {
			toastEl.className = "toast " + (kind || "info");
		}, 4000);
	}

	function busy(button, on) {
		if (!button) return;
		button.disabled = on;
		button.setAttribute("aria-busy", on ? "true" : "false");
	}

	function api(path, options) {
		var opts = options || {};
		var headers = opts.headers || {};
		headers["Authorization"] = "Bearer " + auth;
		if (opts.body) headers["Content-Type"] = "application/json";
		return fetch(API + path, {
			method: opts.method || "GET",
			headers: headers,
			body: opts.body ? JSON.stringify(opts.body) : undefined,
		}).then(function (res) {
			return res.json().then(
				function (data) {
					if (!res.ok || data.success === false) {
						throw new Error(
							data.error || "Request failed with status " + res.status,
						);
					}
					return data;
				},
				function () {
					throw new Error("Server returned a non-JSON response");
				},
			);
		});
	}

	function icon(name) {
		return '<svg class="ico" aria-hidden="true"><use href="#i-' + name + '" /></svg>';
	}

	/* --- sign in ------------------------------------------------------- */

	var loginForm = document.getElementById("login-form");
	loginForm.addEventListener("submit", function (event) {
		event.preventDefault();
		var button = loginForm.querySelector("button");
		var errorEl = document.getElementById("login-error");
		var password = document.getElementById("password").value;

		errorEl.textContent = "";
		busy(button, true);

		// POST /api/admin/stats is the only admin route that reads the password
		// from the body alone, so it doubles as the sign-in check.
		fetch(API + "/api/admin/stats", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: password }),
		})
			.then(function (res) {
				return res.json().then(function (data) {
					if (!res.ok || !data.success) {
						throw new Error(data.error || "Sign in failed");
					}
					return data;
				});
			})
			.then(function (data) {
				auth = password;
				render(data.statistics);
				return loadProjects();
			})
			.catch(function (error) {
				errorEl.textContent = error.message;
			})
			.finally(function () {
				busy(button, false);
			});
	});

	/* --- dashboard ----------------------------------------------------- */

	function render(stats) {
		app.innerHTML =
			'<div class="console-head">' +
			"<div>" +
			'<p class="eyebrow">Console</p>' +
			'<h1 class="section-title">Every project on this instance</h1>' +
			"</div>" +
			'<div class="console-actions">' +
			'<button class="btn btn-secondary" id="btn-refresh">' +
			icon("refresh") +
			"Refresh</button>" +
			'<button class="btn btn-secondary" id="btn-snapshot">' +
			icon("camera") +
			"Snapshot</button>" +
			'<button class="btn btn-ghost" id="btn-signout">' +
			icon("exit") +
			"Sign out</button>" +
			"</div>" +
			"</div>" +
			'<div class="stat-grid" id="stat-grid"></div>' +
			'<div style="margin-top: 2rem">' +
			'<div class="table-toolbar">' +
			'<label class="visually-hidden" for="search">Filter projects</label>' +
			'<input type="text" id="search" placeholder="Filter by name" />' +
			'<button class="btn btn-primary btn-sm" id="btn-new">' +
			icon("plus") +
			"New project</button>" +
			'<span class="hint" id="count-line"></span>' +
			"</div>" +
			'<div class="table-wrap" id="table-wrap"></div>' +
			"</div>";

		renderStats(stats);

		document.getElementById("btn-refresh").addEventListener("click", refresh);
		document.getElementById("btn-snapshot").addEventListener("click", snapshot);
		document.getElementById("btn-signout").addEventListener("click", signOut);
		document.getElementById("btn-new").addEventListener("click", function () {
			openEditor(null);
		});
		document.getElementById("search").addEventListener("input", function (event) {
			filter = event.target.value.trim().toLowerCase();
			renderTable();
		});
		// Delegated once. renderTable() replaces the table's innards on every
		// change, so binding there would stack a handler per redraw.
		document.getElementById("table-wrap").addEventListener("click", onRowAction);
	}

	function renderStats(stats) {
		var grid = document.getElementById("stat-grid");
		if (!grid || !stats) return;
		var cells = [
			["Total views", stats.totalViews],
			["Unique views", stats.uniqueViews],
			["Projects", stats.totalProjects],
		];
		grid.innerHTML = cells
			.map(function (cell) {
				return (
					'<div class="stat"><div class="stat-value">' +
					esc(num(cell[1])) +
					'</div><div class="stat-label">' +
					esc(cell[0]) +
					"</div></div>"
				);
			})
			.join("");
	}

	function loadProjects() {
		return api("/api/admin/projects")
			.then(function (data) {
				projects = data.projects || [];
				renderTable();
			})
			.catch(function (error) {
				toast(error.message, "error");
			});
	}

	function refresh() {
		var button = document.getElementById("btn-refresh");
		busy(button, true);
		Promise.all([
			fetch(API + "/api/admin/stats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password: auth }),
			})
				.then(function (res) {
					return res.json();
				})
				.then(function (data) {
					if (data.success) renderStats(data.statistics);
				}),
			loadProjects(),
		])
			.then(function () {
				toast("Refreshed", "success");
			})
			.catch(function (error) {
				toast(error.message, "error");
			})
			.finally(function () {
				busy(button, false);
			});
	}

	function signOut() {
		auth = "";
		projects = [];
		window.location.reload();
	}

	var COLUMNS = [
		{ key: "project_name", label: "Project" },
		{ key: "view_count", label: "Views", num: true },
		{ key: "unique_views", label: "Unique", num: true },
		{ key: "updated_at", label: "Updated" },
	];

	function renderTable() {
		var wrap = document.getElementById("table-wrap");
		if (!wrap) return;

		var rows = projects.filter(function (project) {
			return !filter || String(project.project_name).toLowerCase().indexOf(filter) !== -1;
		});

		rows.sort(function (a, b) {
			var left = a[sort.key];
			var right = b[sort.key];
			if (typeof left === "number" && typeof right === "number") {
				return (left - right) * sort.dir;
			}
			return String(left).localeCompare(String(right)) * sort.dir;
		});

		document.getElementById("count-line").textContent =
			rows.length + " of " + projects.length + " shown";

		if (!rows.length) {
			wrap.innerHTML =
				'<p class="empty">' +
				(projects.length
					? "Nothing matches that filter."
					: "No projects yet. The first POST to /api/views/:name creates one.") +
				"</p>";
			return;
		}

		var head = COLUMNS.map(function (column) {
			var state =
				sort.key === column.key
					? sort.dir === 1
						? "ascending"
						: "descending"
					: "none";
			return (
				'<th aria-sort="' +
				state +
				'" data-sort="' +
				column.key +
				'"' +
				(column.num ? ' class="num"' : "") +
				'><button type="button" class="th-sort">' +
				esc(column.label) +
				"</button></th>"
			);
		}).join("");

		var body = rows
			.map(function (project) {
				var name = esc(project.project_name);
				return (
					"<tr>" +
					"<td><strong>" +
					name +
					"</strong>" +
					(project.description
						? '<br /><span class="hint">' + esc(project.description) + "</span>"
						: "") +
					"</td>" +
					'<td class="num">' +
					esc(num(project.view_count)) +
					"</td>" +
					'<td class="num">' +
					esc(num(project.unique_views)) +
					"</td>" +
					"<td>" +
					esc(project.updated_at || "unavailable") +
					"</td>" +
					'<td><div class="row-actions">' +
					'<button class="btn btn-ghost" data-act="bump" data-name="' +
					name +
					'" title="Add one view" aria-label="Add one view to ' +
					name +
					'">' +
					icon("plus") +
					"</button>" +
					'<button class="btn btn-ghost" data-act="badges" data-name="' +
					name +
					'" title="Badge URLs" aria-label="Badge URLs for ' +
					name +
					'">' +
					icon("tag") +
					"</button>" +
					'<button class="btn btn-ghost" data-act="installs" data-name="' +
					name +
					'" title="Install sources" aria-label="Install sources for ' +
					name +
					'">' +
					icon("package") +
					"</button>" +
					'<button class="btn btn-ghost" data-act="edit" data-name="' +
					name +
					'" title="Edit" aria-label="Edit ' +
					name +
					'">' +
					icon("pencil") +
					"</button>" +
					'<button class="btn btn-danger" data-act="delete" data-name="' +
					name +
					'" title="Delete" aria-label="Delete ' +
					name +
					'">' +
					icon("trash") +
					"</button>" +
					"</div></td>" +
					"</tr>"
				);
			})
			.join("");

		wrap.innerHTML =
			"<table><thead><tr>" +
			head +
			'<th><span class="visually-hidden">Actions</span></th>' +
			"</tr></thead><tbody>" +
			body +
			"</tbody></table>";

		wrap.querySelectorAll("th[data-sort]").forEach(function (th) {
			th.addEventListener("click", function () {
				var key = th.dataset.sort;
				sort = { key: key, dir: sort.key === key ? -sort.dir : -1 };
				renderTable();
			});
		});

	}

	function onRowAction(event) {
		var button = event.target.closest("button[data-act]");
		if (!button) return;
		var name = button.dataset.name;
		var project = projects.filter(function (candidate) {
			return candidate.project_name === name;
		})[0];

		if (button.dataset.act === "bump") return bump(name, button);
		if (button.dataset.act === "badges") return openBadges(name);
		if (button.dataset.act === "installs") return openInstalls(name);
		if (button.dataset.act === "edit") return openEditor(project);
		if (button.dataset.act === "delete") return confirmDelete(name);
	}

	/* --- actions ------------------------------------------------------- */

	function bump(name, button) {
		busy(button, true);
		fetch(API + "/api/views/" + encodeURIComponent(name), { method: "POST" })
			.then(function (res) {
				return res.json();
			})
			.then(function (data) {
				if (!data.success) throw new Error(data.error || "Increment failed");
				toast(name + " is now at " + data.totalViews, "success");
				return loadProjects();
			})
			.catch(function (error) {
				toast(error.message, "error");
			})
			.finally(function () {
				busy(button, false);
			});
	}

	function snapshot() {
		var button = document.getElementById("btn-snapshot");
		busy(button, true);
		api("/api/admin/installs/snapshot", { method: "POST", body: {} })
			.then(function (data) {
				toast(
					"Snapshot recorded for " + (data.day || "today") + ".",
					"success",
				);
			})
			.catch(function (error) {
				toast(error.message, "error");
			})
			.finally(function () {
				busy(button, false);
			});
	}

	/* --- dialogs ------------------------------------------------------- */

	function dialog(title, bodyHtml, actionsHtml) {
		var el = document.createElement("dialog");
		el.innerHTML =
			'<form method="dialog" class="dialog-head">' +
			"<h2>" +
			esc(title) +
			"</h2>" +
			'<button class="btn btn-ghost" value="cancel" aria-label="Close">Close</button>' +
			"</form>" +
			bodyHtml +
			(actionsHtml ? '<div class="dialog-actions">' + actionsHtml + "</div>" : "");
		document.body.appendChild(el);
		el.addEventListener("close", function () {
			el.remove();
		});
		el.showModal();
		return el;
	}

	function openEditor(project) {
		var isNew = !project;
		var el = dialog(
			isNew ? "New project" : "Edit " + project.project_name,
			'<div class="field"><label for="f-name">Name</label>' +
				'<input type="text" id="f-name" value="' +
				esc(isNew ? "" : project.project_name) +
				'" />' +
				'<span class="hint">Letters, numbers, dot, dash and underscore. A dot nests it: acme.api.docs sits under acme.</span></div>' +
				'<div class="field"><label for="f-desc">Description</label>' +
				'<input type="text" id="f-desc" value="' +
				esc(isNew ? "" : project.description || "") +
				'" /></div>' +
				'<div class="row">' +
				'<div class="field"><label for="f-views">Total views</label>' +
				'<input type="number" id="f-views" min="0" value="' +
				esc(isNew ? 0 : project.view_count) +
				'" /></div>' +
				'<div class="field"><label for="f-unique">Unique views</label>' +
				'<input type="number" id="f-unique" min="0" value="' +
				esc(isNew ? 0 : project.unique_views || 0) +
				'" /></div>' +
				"</div>",
			'<button class="btn btn-secondary" data-close>Cancel</button>' +
				'<button class="btn btn-primary" data-save>Save</button>',
		);

		el.querySelector("[data-close]").addEventListener("click", function () {
			el.close();
		});

		el.querySelector("[data-save]").addEventListener("click", function (event) {
			var button = event.currentTarget;
			var name = el.querySelector("#f-name").value.trim();
			if (!name) {
				toast("A project needs a name", "error");
				return;
			}
			var payload = {
				newName: name,
				description: el.querySelector("#f-desc").value.trim(),
				viewCount: Number(el.querySelector("#f-views").value) || 0,
				uniqueViews: Number(el.querySelector("#f-unique").value) || 0,
			};

			busy(button, true);
			// A project that does not exist yet has to be created before it can
			// be edited, and the only route that creates one is the increment.
			var prepare = isNew
				? fetch(API + "/api/views/" + encodeURIComponent(name), { method: "POST" })
				: Promise.resolve();

			prepare
				.then(function () {
					return api(
						"/api/admin/projects/" +
							encodeURIComponent(isNew ? name : project.project_name),
						{ method: "PUT", body: payload },
					);
				})
				.then(function () {
					el.close();
					toast("Saved " + name, "success");
					return loadProjects();
				})
				.catch(function (error) {
					toast(error.message, "error");
				})
				.finally(function () {
					busy(button, false);
				});
		});
	}

	function confirmDelete(name) {
		var el = dialog(
			"Delete " + name,
			"<p>Every view and visitor row for <strong>" +
				esc(name) +
				"</strong> is removed. There is no undo, and the counts do not come back.</p>",
			'<button class="btn btn-secondary" data-close>Cancel</button>' +
				'<button class="btn btn-danger" data-confirm>Delete it</button>',
		);

		el.querySelector("[data-close]").addEventListener("click", function () {
			el.close();
		});

		el.querySelector("[data-confirm]").addEventListener("click", function (event) {
			var button = event.currentTarget;
			busy(button, true);
			api("/api/views/" + encodeURIComponent(name), { method: "DELETE" })
				.then(function () {
					el.close();
					toast("Deleted " + name, "success");
					return loadProjects();
				})
				.catch(function (error) {
					toast(error.message, "error");
				})
				.finally(function () {
					busy(button, false);
				});
		});
	}

	function openBadges(name) {
		var encoded = encodeURIComponent(name);
		var urls = [
			["Views", API + "/api/views/" + encoded + "/badge"],
			["Views, whole subtree", API + "/api/views/" + encoded + "/badge?rollup=1"],
			["Installs", API + "/api/installs/" + encoded + "/badge"],
			[
				"Views plus installs",
				API + "/api/compute/" + encoded + "/badge?expr=views.total%2Binstalls.total",
			],
		];

		var el = dialog(
			"Badges for " + name,
			urls
				.map(function (entry) {
					return (
						'<div class="field">' +
						"<label>" +
						esc(entry[0]) +
						"</label>" +
						'<img src="' +
						esc(entry[1]) +
						'" alt="" style="height: 20px; align-self: flex-start" />' +
						'<div class="code" style="white-space: pre-wrap; word-break: break-all">' +
						esc("![" + entry[0] + "](" + entry[1] + ")") +
						'<button class="copy-btn" data-copy="' +
						esc("![" + entry[0] + "](" + entry[1] + ")") +
						'">' +
						icon("copy") +
						"Copy</button></div>" +
						"</div>"
					);
				})
				.join(""),
			"",
		);

		el.querySelectorAll("[data-copy]").forEach(function (button) {
			button.addEventListener("click", function () {
				navigator.clipboard.writeText(button.dataset.copy).then(
					function () {
						toast("Copied", "success");
					},
					function () {
						toast("The browser refused clipboard access", "error");
					},
				);
			});
		});
	}

	var SOURCES = ["vscode", "openvsx", "pypi", "github", "npm", "crates"];

	function openInstalls(name) {
		var el = dialog(
			"Install sources for " + name,
			'<p class="hint" style="margin-bottom: 1rem">One identifier per registry. ' +
				"Clear a field to stop counting that registry.</p>" +
				SOURCES.map(function (source) {
					return (
						'<div class="field"><label for="s-' +
						source +
						'">' +
						esc(source) +
						'</label><input type="text" id="s-' +
						source +
						'" placeholder="not configured" /></div>'
					);
				}).join(""),
			'<button class="btn btn-secondary" data-close>Cancel</button>' +
				'<button class="btn btn-primary" data-save>Save</button>',
		);

		// Prefill from the public read, which reports the configured identifier
		// for each source. A project with none configured answers 404, which is
		// the expected state for most projects rather than an error.
		fetch(API + "/api/installs/" + encodeURIComponent(name))
			.then(function (res) {
				return res.json();
			})
			.then(function (data) {
				(data.sources || []).forEach(function (entry) {
					var input = el.querySelector("#s-" + entry.source);
					if (input && entry.id) input.value = entry.id;
				});
			})
			.catch(function () {
				/* No configuration to prefill. The blank form is correct. */
			});

		el.querySelector("[data-close]").addEventListener("click", function () {
			el.close();
		});

		el.querySelector("[data-save]").addEventListener("click", function (event) {
			var button = event.currentTarget;
			var sources = {};
			SOURCES.forEach(function (source) {
				sources[source] = el.querySelector("#s-" + source).value.trim();
			});

			busy(button, true);
			api("/api/admin/installs/" + encodeURIComponent(name), {
				method: "PUT",
				body: { sources: sources },
			})
				.then(function () {
					el.close();
					toast("Sources saved for " + name, "success");
				})
				.catch(function (error) {
					toast(error.message, "error");
				})
				.finally(function () {
					busy(button, false);
				});
		});
	}
})();
