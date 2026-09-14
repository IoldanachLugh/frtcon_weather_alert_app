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
  // Always go to the network -- no caching, no offline fallback content,
  // since this app shows live weather alerts and stale cached content
  // would be actively misleading (see top-of-file note).
  //
  // But a bare fetch() with no error handling has a real failure mode: if
  // the network genuinely isn't ready the instant this fires -- notably,
  // right when Android cold-starts a fully-killed app and the OS may
  // still be reinitializing the network stack -- the fetch promise
  // rejects, and Chrome falls back to its own default offline
  // interstitial for the whole page. In standalone/installed display mode
  // (no browser chrome, no address bar) that interstitial is nearly blank
  // white with faint text, easily mistaken for the app just not loading.
  // For navigation requests specifically, catch that failure and hand
  // back a minimal self-contained page that auto-retries instead -- this
  // doesn't cache or serve stale content, it just retries the same live
  // request a moment later once the network has actually come up.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>French Toast Conditions</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body {
        display: flex; align-items: center; justify-content: center;
        min-height: 100vh; box-sizing: border-box; padding: 24px;
        background: #0b1f3a; color: #e5ecf5;
        font-family: Arial, Helvetica, sans-serif; text-align: center;
      }
    </style>
  </head>
  <body>
    <p>Reconnecting&hellip;</p>
    <script>setTimeout(function () { location.reload(); }, 1500);</script>
  </body>
</html>`,
            { status: 200, headers: { "Content-Type": "text/html" } }
          )
      )
    );
    return;
  }

  event.respondWith(fetch(event.request));
});
