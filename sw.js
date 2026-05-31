/* Offline AI Chat — Service Worker
   - cache-first for shell (HTML/CSS/JS modules)
   - network-only for /api/* (LM Studio proxy + fs endpoints)
   - bump CACHE_VERSION to invalidate old caches */

const CACHE_VERSION = "v27";
const CACHE_NAME = `offline-ai-shell-${CACHE_VERSION}`;
const SHELL_URLS = [
  "/",
  "/index.html",
  "/styles.css?v=27",
  "/app.js",
  "/manifest.webmanifest",
  "/modules/store.js",
  "/modules/schema.js",
  "/modules/storage.js",
  "/modules/api.js",
  "/modules/markdown.js",
  "/modules/theme.js",
  "/modules/shortcuts.js",
  "/modules/exporter.js",
  "/modules/notifications.js",
  "/modules/search.js",
  "/modules/templates.js",
  "/modules/app-helpers.js",
  "/modules/ui/chat.js",
  "/modules/ui/chat-helpers.js",
  "/modules/ui/comparison.js",
  "/modules/ui/comparison-helpers.js",
  "/modules/ui/composer.js",
  "/modules/ui/composer-helpers.js",
  "/modules/ui/prompt-picker.js",
  "/modules/ui/settings.js",
  "/modules/ui/settings/_shared.js",
  "/modules/ui/settings/index.js",
  "/modules/ui/settings/server.js",
  "/modules/ui/settings/model.js",
  "/modules/ui/settings/profiles.js",
  "/modules/ui/settings/workspace.js",
  "/modules/ui/settings/appearance.js",
  "/modules/ui/settings/behavior.js",
  "/modules/ui/settings/shortcuts.js",
  "/modules/ui/settings/advanced.js",
  "/modules/ui/settings/tools.js",
  "/modules/ui/palette.js",
  "/modules/ui/sidebar.js",
  "/modules/ui/toasts.js",
  "/modules/ui/workspace.js",
  "/modules/workspace/upload.js",
  "/modules/workspace/dragdrop.js",
  "/modules/workspace/fsapi.js",
  "/modules/workspace/fsbridge.js",
  "/modules/workspace/context.js",
  "/modules/rag/chunker.js",
  "/modules/rag/embedder.js",
  "/modules/rag/store.js",
  "/modules/rag/retriever.js",
  "/modules/rag/reranker.js",
  "/modules/rag/indexer.js",
  "/modules/rag/manager.js",
  "/modules/tools/manager.js",
  "/modules/hardware.js",
  "/modules/model-catalog.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          SHELL_URLS.map((url) =>
            cache.add(url).catch(() => {
              /* ignore missing files (modules may not all exist yet) */
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("offline-ai-shell-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // never cache API
  if (url.pathname.startsWith("/api/")) return;
  // only handle same-origin GETs
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Network-first for JS modules — avoids serving stale bundles after deploys.
  // Falls back to cache only when network fails (offline mode).
  const isJsModule = url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs");

  event.respondWith(
    isJsModule
      ? fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => caches.match(request))
      : caches.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              if (response && response.status === 200) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
              }
              return response;
            })
            .catch(() => cached);
          return cached || network;
        })
  );
});
