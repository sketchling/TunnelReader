// Minimal service worker: required for installability / share target.
// All requests pass through to the network (no offline caching yet).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* default network handling */ });
