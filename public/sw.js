// Deliberately minimal service worker.
//
// FRTCON shows live weather alert data, so this app should NOT serve
// cached/stale content when offline or between updates — showing someone
// an out-of-date severe weather alert would be actively misleading, unlike
// e.g. a notes app where a stale cache is harmless. So this service worker
// exists ONLY to satisfy Chrome's installability requirement (a registered
// service worker with a fetch handler is required for the beforeinstallprompt
// event to fire) — it does not cache anything and always defers to the
// network.
//
// skipWaiting()/clients.claim() below ensure that when a new deployment
// ships, it takes over immediately on next load instead of waiting for
// every open tab to be closed first — avoiding the classic "why isn't my
// update showing up" PWA problem, since there's no cache lifecycle to get
// stuck on in the first place.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Always go to the network. No caching, no offline fallback — presence
  // of this handler is what Chrome checks for, not what it does.
  event.respondWith(fetch(event.request));
});
