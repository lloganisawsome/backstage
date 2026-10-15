const CACHE = "backstage-shell-v4-shared-auth";
const ASSETS = [
  "./",
  "index.html",
  "css/main.css",
  "css/layout.css",
  "css/themes.css",
  "css/components.css",
  "js/app.js",
  "js/router.js",
  "js/config.js",
  "js/services/data.js",
  "core/schema.mjs",
  "core/engine.mjs",
  "core/media.mjs",
  "core/firebase-scope.mjs",
  "js/services/static-writes.js",
  "js/services/maintenance.js",
  "js/utils/dom.js",
  "js/components/modal.js",
  "js/components/editor.js",
  "js/components/table.js",
  "js/modules/dashboard.js",
  "js/modules/records.js",
  "js/modules/events.js",
  "js/modules/show.js",
  "js/modules/labels.js",
  "js/modules/images.js",
  "js/modules/settings.js",
  "js/modules/scan.js",
  "js/modules/search.js",
  "js/modules/notifications.js",
  "js/modules/archives.js",
  "vendor/qrcode.js",
  "vendor/jszip.min.js",
  "manifest.webmanifest",
  "assets/icons/app.svg",
  "assets/branding/sn-productions-logo.png",
  "assets/icons/app-192.png",
  "assets/icons/app-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (url.pathname.includes("/assets/equipment/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate")
          return caches.match("index.html");
        return new Response("Offline: this asset is not cached.", {
          status: 503,
        });
      }),
  );
});
