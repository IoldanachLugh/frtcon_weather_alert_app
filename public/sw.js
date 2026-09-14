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
  //
  // That auto-retry is capped, not unconditional: a brief hiccup during
  // Android cold-start is the case this is built for, but the same catch
  // fires just as readily for airplane mode, no signal, a real site/DNS
  // outage, or a captive portal -- none of which resolve themselves in a
  // second or two. Retrying forever in those cases just spins the battery
  // on a screen that looks like it's about to load. So this backs off
  // (1.5s, 3s, 6s, 6s) across a handful of attempts, tracked in
  // sessionStorage so the count survives the reloads it's causing, then
  // gives up and shows a plain "can't reach it" message with a manual
  // Retry button -- restarting the same backoff from scratch, since a
  // deliberate retry means the user believes something changed. The
  // 'online' event (fired the instant the OS reports connectivity
  // restored, e.g. leaving airplane mode) also triggers an immediate
  // reload/reset rather than waiting out whatever backoff step is queued.
  // The counter itself is cleared on a genuinely successful app load (see
  // main.jsx) so it never carries over into an unrelated later failure.
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
      p { max-width: 320px; }
      button {
        margin-top: 16px; display: none;
        background: #60a5fa; color: #0b1f3a; border: none;
        border-radius: 12px; padding: 12px 18px;
        font-size: 15px; font-weight: bold; cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div>
      <p id="frtcon-reconnect-text">Reconnecting&hellip;</p>
      <button id="frtcon-reconnect-retry" type="button">Retry</button>
    </div>
    <script>
      (function () {
        var STORAGE_KEY = "frtcon_reconnect_attempts";
        var MAX_ATTEMPTS = 4;
        var RETRY_DELAYS_MS = [1500, 3000, 6000, 6000];

        function getAttempts() {
          try {
            return Number(sessionStorage.getItem(STORAGE_KEY)) || 0;
          } catch (err) {
            return 0;
          }
        }
        function setAttempts(count) {
          try {
            sessionStorage.setItem(STORAGE_KEY, String(count));
          } catch (err) {
            // Ignore storage failures -- worst case, backoff restarts at 0.
          }
        }

        var textEl = document.getElementById("frtcon-reconnect-text");
        var retryButton = document.getElementById("frtcon-reconnect-retry");

        function giveUp(message) {
          setAttempts(0);
          textEl.textContent = message;
          retryButton.style.display = "inline-block";
        }

        retryButton.addEventListener("click", function () {
          setAttempts(0);
          location.reload();
        });

        // Fires the instant the OS reports connectivity restored (e.g.
        // leaving airplane mode) -- reload right away instead of waiting
        // out whatever backoff step happened to be queued.
        window.addEventListener("online", function () {
          setAttempts(0);
          location.reload();
        });

        if (navigator.onLine === false) {
          // Definitely offline right now -- retrying on a timer would just
          // burn the attempt budget for nothing. Wait for the 'online'
          // listener above; the Retry button still lets the user force
          // an attempt sooner (e.g. if navigator.onLine is wrong).
          giveUp("You're offline. This will reload automatically once you're back online.");
        } else {
          var attempts = getAttempts();
          if (attempts >= MAX_ATTEMPTS) {
            giveUp("Can't reach FRTCON right now. Check your connection and try again.");
          } else {
            setAttempts(attempts + 1);
            var delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];
            setTimeout(function () { location.reload(); }, delay);
          }
        }
      })();
    </script>
  </body>
</html>`,
            { status: 200, headers: { "Content-Type": "text/html" } }
          )
      )
    );
    return;
  }

  // Not a navigation -- JS/CSS/image/font requests and cross-origin API
  // calls (NWS, zippopotam) all fall through here. Since this SW never
  // caches or rewrites anything for these, routing them through
  // respondWith(fetch(...)) would only add overhead for no behavior
  // change: leaving the fetch handler installed (a no-op for these
  // requests) still satisfies Chrome's installability requirement.
});
