// ViewFlare service worker, v3.
//
// v2 precached "/" and "/index.html", so every returning visitor kept being
// served the old landing page no matter what was deployed. This version exists
// only to undo that: it takes control, drops every cache the old one created,
// unregisters itself, and reloads any page it was controlling.
//
// The bytes of this file have to differ from v2 for a browser to notice it at
// all. That is the whole trigger. Once a client has run this once, it has no
// service worker and fetches normally.

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(names.map((name) => caches.delete(name)));
			await self.registration.unregister();

			const clients = await self.clients.matchAll({ type: "window" });
			for (const client of clients) {
				client.navigate(client.url);
			}
		})(),
	);
});
