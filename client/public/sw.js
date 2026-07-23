// Minimal service worker for PWA install + share target.
//
// Intentionally NO 'fetch' handler. On iOS Safari, a service worker that
// intercepts fetches — even a no-op passthrough that never calls respondWith —
// drops the body from POST requests. Multipart uploads then reach the server
// truncated, which busboy/multer reports as "Unexpected end of form", so file
// uploads fail on the installed PWA. Installability and the manifest
// share_target do not require a fetch handler, so we don't register one.
//
// If offline caching is added later, the fetch handler MUST bypass non-GET
// requests (return without calling respondWith) to avoid reintroducing this bug.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
