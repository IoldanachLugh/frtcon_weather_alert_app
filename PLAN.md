# PLAN.md — Full code review follow-ups

Review of the whole package at `7ff8fdb` (2026-09-14). `npm run lint` is
clean and `vite build` succeeds (built `index.html` correctly rewrites icon
and manifest paths to relative with `base: './'`).

Items are ordered by priority. File references are `path:line` at `7ff8fdb`.

---

## P1 — Correctness

### 1. Alerts query misses county- and polygon-based warnings — ✅ FIXED

- **Where:** `src/lib/weatherApi.js:120-135` (`getActiveAlertsByZone`),
  called from `src/App.jsx:167` and `src/App.jsx:199`.
- **Problem:** `/alerts/active/zone/{forecastZoneId}` only returns alerts
  coded to that forecast zone (UGC `xxZnnn`). Alerts issued by county or
  storm polygon (UGC `xxCnnn`) are not returned. Among the winter types the
  app classifies, **Snow Squall Warning (FRTCON 2)** is a storm-based
  polygon warning, so it would be silently missed.
- **Evidence (checked live 2026-09-14):** for each of the 4 county-coded
  alerts active at the time (Flash Flood Warning `COC033`, `MOC003`; Flood
  Advisory `COC091`; Flood Warning `RIC009`), a point inside the alert
  polygon → `/points` → `forecastZone` → `/alerts/active/zone/{zone}`
  returned **none** of them, while `/alerts/active?point={lat},{lon}`
  returned **all 4**.
- **Fix:**
  - Replace with `getActiveAlertsByPoint(lat, lon, { signal, skipCache })`
    querying `${WEATHER_GOV_BASE}/alerts/active?point=${lat},${lon}&status=actual`.
  - Cache key from rounded lat/lon (same approach as `makeZoneCacheKey`,
    with `ALERTS_CACHE_PREFIX`).
  - Store `lat`/`lon` in `result` in `runLookupFromCoordinates`, and key
    the auto-refresh effect (`App.jsx:195-212`) on those instead of
    `zoneId`.
  - Keep `getZoneByPoint` only for the display name.
  - Update the "Active Zone Alerts" heading (`App.jsx:491`) and README
    wording ("every raw active NWS alert for your zone").
- **Verify:** re-run the zone-vs-point comparison against a currently active
  county-coded alert and confirm the app now lists it.
- **Done:** implemented as described above (`getActiveAlertsByPoint` in
  `src/lib/weatherApi.js`, `result.lat`/`result.lon` and the refresh effect
  in `src/App.jsx`, `makeAlertsCacheKey` in `src/lib/cache.js`, heading/copy
  updated in `App.jsx` and `README.md`). Re-verified live 2026-09-14 against
  a currently active county-coded Flash Flood Warning
  (`37.749,-108.691`, zone `COZ019`): the old zone-based query returned 0
  alerts, the new point-based query returned 1 (the warning). `npm run
  lint` and `vite build` both pass.

### 2. Offline fallback page reloads forever — ✅ FIXED

- **Where:** `public/sw.js:43-73` (reload at `:66`).
- **Problem:** any failed navigation shows "Reconnecting…" and reloads every
  1.5 s with no retry limit, backoff, or offline check. In airplane mode,
  with no signal, during a site/DNS outage, or behind a captive portal, the
  installed app spins indefinitely, drains battery, and never tells the user
  they're offline.
- **Fix:**
  - In the fallback page script, keep an attempt counter in
    `sessionStorage` (wrapped in try/catch), with backoff of about 1.5 s →
    3 s → 6 s.
  - After ~4 attempts, or immediately if `navigator.onLine === false`, show
    "Can't reach FRTCON — check your connection" with a Retry button that
    resets the counter.
  - Also retry on the `online` event.
  - Clear the counter on successful app start (e.g. in `main.jsx`).
- **Verify:** install the PWA, enable airplane mode, then launch. It should
  show the offline message after a few tries. Restore the network, tap
  Retry, and the app should load. Remember the SW update caveat in
  CONTEXT.md: reinstall the PWA to be sure the new `sw.js` is active.
- **Done:** implemented as described (attempt counter + [1.5s, 3s, 6s, 6s]
  backoff in `sessionStorage`, give-up message with a Retry button after 4
  attempts, immediate offline message when `navigator.onLine === false`,
  reset-and-reload on the `online` event, counter cleared on a successful
  app load in `src/main.jsx`). Verified by extracting the fallback page's
  inline script and running it in Node against mocked
  `sessionStorage`/`navigator`/`location`/`setTimeout`: confirmed the
  backoff delays escalate correctly, give-up fires and resets the counter
  at attempt 4, the offline path gives up immediately with distinct
  copy, and both the Retry button and the `online` event reset the counter
  and reload. `npm run lint` and `vite build` both pass.
  - **Re-verified live in a real browser (2026-09-14)**, now that Claude in
    Chrome was available: byte-for-byte extracted the exact fallback HTML
    string `sw.js` generates (via a small Node harness that fakes the SW
    `self`/`fetch` globals and captures the real `Response` body, rather
    than hand-copying it) and served it from a local static file server,
    so the actual shipped script ran in a genuine browser DOM with real
    `sessionStorage`/`setTimeout`/reloads instead of Node mocks. Confirmed:
    a `navigator.onLine === false` shim (prepended before the real script,
    to force that branch without a real outage) gives up immediately with
    the offline-specific message; the normal path backs off 1.5s → 3s → 6s
    → 6s across real reloads and then gives up with "Can't reach FRTCON…"
    and a visible Retry button; a genuine mouse click on that Retry button
    resets the counter and restarts the backoff; dispatching a real
    `online` event mid-backoff interrupts the pending timer and restarts
    from 0 rather than continuing toward give-up.
  - **Still not verified:** an actual installed PWA under real airplane
    mode on a device — the above confirms the reconnect script's own logic
    end-to-end in a browser, but not the service-worker-level `fetch`
    rejection path specifically (Android cold-start hitting the network
    stack before it's ready), which needs real hardware to trigger
    faithfully.

---

## P2 — UX / robustness

### 3. No refresh when the app returns to the foreground — ✅ FIXED

- **Where:** `src/App.jsx:195-212`.
- **Problem:** mobile browsers throttle or freeze `setInterval` for
  background tabs and suspended PWAs. When an installed app is reopened from
  the app switcher, it can show alerts loaded long ago, with no indication
  of their age, until the interval next fires. How quickly timers catch up
  varies by browser, which is not acceptable for an app whose stated design
  goal is never showing stale alerts.
- **Fix:**
  - Record `fetchedAt` in `result`.
  - On `visibilitychange` → visible, refresh immediately if `fetchedAt` is
    older than ~60 s.
  - Show "Updated h:mm a" in the Current FRTCON card.
  - Implement together with #1, since both touch `result` and the refresh
    effect.
- **Done:** implemented as described.
  - `src/lib/weatherApi.js` — added `STALE_ON_VISIBLE_MS` (60s).
  - `src/App.jsx` — `result.fetchedAt` set on every successful fetch; the
    interval-refresh body was extracted into a shared `refreshAlerts(lat,
    lon)` callback (bypasses the TTL cache, only applies its result if
    that location is still the one on screen); a new `visibilitychange`
    effect calls it immediately when the tab becomes visible and
    `fetchedAt` is older than `STALE_ON_VISIBLE_MS`; the Current FRTCON
    card now shows "Updated h:mm a" using `result.fetchedAt`.
  - `src/styles.css` — added `.frtcon-updated-at` (small, muted).
  - `npm run lint` and `vite build` both pass.
  - **Verified live in a real browser (2026-09-14)**, now that Claude in
    Chrome was available (previously blocked -- see below). Ran the app
    against the real dev server and NWS API for ZIP 55771: did a ZIP
    lookup, confirmed a real `alerts/active` network request and an
    "Updated h:mm" timestamp appeared; toggled `document.visibilityState`
    hidden→visible immediately afterward (data still fresh) and confirmed
    *no* new network request fired; waited a real 65 seconds (past
    `STALE_ON_VISIBLE_MS`), toggled visibility again, and confirmed exactly
    one new `alerts/active` request fired and the displayed timestamp
    advanced. This is now fully confirmed, superseding the "not verified"
    note below, which is kept for context on why it wasn't done initially.
  - Previously: not verified in an actual browser. Headless Chromium
    couldn't be launched in this sandbox to drive an interactive check
    (the only Chromium here is the snap package, which fails with a
    snap-cgroup error specific to this sandboxed shell — not something
    fixable from here), and Claude in Chrome was declined for that
    session.

### 4. Raw technical error messages shown to users — ✅ FIXED

- **Where:** `src/lib/weatherApi.js:48-56` builds messages like
  `Request failed (404) for https://api.zippopotam.us/us/00000`, rendered
  verbatim at `src/App.jsx:181` and `:326`.
- **Cases:**
  - nonexistent ZIP (zippopotam 404)
  - location outside NWS coverage, e.g. geolocation abroad (`/points` 404)
  - NWS 5xx outages
  - timeouts
- **Fix:**
  - Have `fetchJson` throw an `HttpError` carrying `status` and `url`.
  - Map it at the call sites:
    - `getLatLonFromZip` 404 → "We couldn't find that ZIP code."
    - `getZoneByPoint` 404 → "This location isn't covered by the National
      Weather Service."
    - anything else → "The weather service isn't responding right now. Try
      again in a minute."
  - Keep the URL and status in `console.error` for debugging.
- **Done:** implemented as described in `src/lib/weatherApi.js`.
  - Added `export class HttpError extends Error` (carries `status`, `url`,
    `timeout`), thrown by `fetchJson` instead of a plain `Error` for both
    a non-ok response and the existing timeout path.
  - Added a private `friendlyMessage(err, notFoundMessage)` helper: logs
    the technical detail to `console.error`, returns `notFoundMessage` for
    a 404 if one was given, otherwise the generic "The weather service
    isn't responding right now. Try again in a minute." for anything else
    (5xx, other 4xx, timeouts). Returns `null` for a non-`HttpError` (e.g.
    an `AbortError` from a superseded request), so the caller re-throws it
    unchanged rather than papering over it.
  - Wired in at all three call sites: `getLatLonFromZip` (404 → "We
    couldn't find that ZIP code.", and reworded the pre-existing
    empty-`places` case to the same text for consistency, since it's the
    same failure discovered a different way), `getZoneByPoint`'s
    `/points/` call (404 → "This location isn't covered by the National
    Weather Service."; its second call to `/zones/forecast/{zoneId}` has
    no 404-specific text since an unexpected 404 there isn't a "not
    covered" case), and `getActiveAlertsByPoint` (generic fallback only).
  - `App.jsx` needed no changes -- it already just renders `err.message`,
    which is now friendly text instead of the raw technical string.
  - **Verified** against real and simulated failures (Node, `libcopy` of
    the two files with a fixed relative-import extension so plain `node`
    could load them): nonexistent ZIP `00000` → "We couldn't find that ZIP
    code."; a real coordinate outside NWS coverage (London, UK) → "This
    location isn't covered by the National Weather Service."; a mocked
    zippopotam 500 → the generic fallback; a forced 10s timeout → the
    generic fallback. A real, working ZIP (55771) still succeeds
    unaffected. In every failing case the raw `Request failed (…) for
    https://…` / `Request timed out for https://…` string was confirmed
    going to `console.error`, not to the thrown message. `npm run lint`
    and `vite build` both pass.
  - **Out of scope, not changed:** a raw network failure with no HTTP
    response at all (e.g. `TypeError: Failed to fetch` from being
    offline, DNS failure, or a CORS rejection) isn't an `HttpError`, so
    `friendlyMessage` returns `null` for it and the browser's own message
    still reaches the user unwrapped. Not one of the four cases named in
    this item; flagging in case it's worth a follow-up.

### 5. Failed lookups are remembered and auto-retried on every visit — ✅ FIXED

- **Where:** `src/App.jsx:220` saves `frtcon_last_source = "browser"` before
  geolocation succeeds; `src/App.jsx:314-317` saves the ZIP and source
  before the lookup succeeds.
- **Scenario:** the user taps "Use Browser Location", denies permission, and
  leaves. Every later visit auto-runs geolocation and opens with the
  permission-denied error. The same happens with a 5-digit ZIP that doesn't
  exist.
- **Fix:**
  - Persist `frtcon_last_source` / `frtcon_last_zip` only after a successful
    lookup, e.g. in the success path of `runLookupFromCoordinates`.
  - Optionally, skip auto-resume of browser location when
    `navigator.permissions?.query({ name: "geolocation" })` reports
    `denied`.
- **Done:** implemented as described, both the required fix and the
  optional one, in `src/App.jsx`.
  - `runLookupFromCoordinates` now returns `true` on an actual landed
    result and `false` on failure or on being superseded by a newer
    lookup -- it was the one place that already knew the real outcome of
    both the browser-location and ZIP paths.
  - `handleUseBrowserLocation`'s `onSuccess` and `performZipLookup` each
    write `frtcon_last_source` (and, for ZIP, `frtcon_last_zip`) only when
    that return value is `true`, instead of unconditionally before the
    lookup even started.
  - The mount effect's silent auto-resume for `savedSource === "browser"`
    now calls `navigator.permissions.query({ name: "geolocation" })`
    first and skips the attempt if `state === "denied"`; if the
    Permissions API isn't available or the query itself rejects, it falls
    back to attempting the lookup exactly as before. Only the *silent*
    auto-resume is affected -- a manual click of "Use Browser Location"
    always still attempts it regardless of this check.
  - `npm run lint` and `vite build` both pass.
  - **Re-verified live in a real browser (2026-09-14)**, superseding the
    original hand-traced-only verification (no interactive browser was
    available in that earlier session -- see #3's note on the same
    limitation):
    - Nonexistent ZIP `00000` → friendly error shown, `frtcon_last_zip`/
      `frtcon_last_source` stay unset; reloading afterward shows a clean
      slate (no error, no status, empty ZIP field) -- confirms it doesn't
      silently auto-retry the failing lookup.
    - A successful ZIP (`55771`) persists `frtcon_last_zip`/`_source`;
      immediately submitting a failing ZIP (`00000`) afterward leaves that
      earlier good pair untouched in `localStorage` while still showing
      the new error -- confirms a later failure doesn't clobber an earlier
      success.
    - Manually clicking "Use Browser Location" with `navigator.geolocation
      .getCurrentPosition` mocked to call back with `PERMISSION_DENIED`
      shows the permission-denied error and leaves `frtcon_last_source`
      unset.
    - The mount-effect Permissions-API skip specifically needed
      intercepting `navigator.permissions`/`navigator.geolocation` before
      React's first render, which external page scripts can't win a race
      against -- so this one was verified by temporarily adding a shim
      `<script>` to the top of `index.html` (before the app's own
      `<script type="module">`) that shadows both, reverted immediately
      after (confirmed clean via `git diff --stat index.html` showing no
      changes, plus a re-run of lint/build). With `frtcon_last_source`
      pre-set to `"browser"` in `localStorage` and the shim reporting
      `state: "denied"`, reloading called `getCurrentPosition` **zero**
      times and showed no "Locating you..." flash and no error -- the
      silent auto-resume was correctly skipped. As a control, reporting
      `state: "prompt"` instead (same reload, same saved source) *did*
      call `getCurrentPosition`, confirming the skip is conditional on the
      reported state rather than a check that always skips.

### 6. Focus isn't restored after closing a modal opened from the menu — ✅ FIXED

- **Where:** `src/hooks/useModalBehavior.js:44`, `:81`;
  `src/App.jsx:390-393`, `:408-411`.
- **Problem:** the menu item that opens the modal is removed from the DOM in
  the same render that opens the modal. When the modal's effect runs,
  `document.activeElement` is already `<body>`, so on close focus goes to
  `<body>` rather than the menu button. The hook's comment says it handles
  exactly this case, but it doesn't. Keyboard and screen-reader users lose
  their place.
- **Fix:** add an optional `returnFocusRef` argument to `useModalBehavior`.
  Use it when the previously focused element is missing or
  `!el.isConnected`. Pass `menuButtonRef` from `App` to `RecipeModal` and
  `IOSInstallHelp`.
- **Done:** implemented largely as described, with one correction found
  during verification (see below).
  - `useModalBehavior` (`src/hooks/useModalBehavior.js`) now takes an
    optional fourth argument `returnFocusRef`. On close, it uses
    `previouslyFocusedRef.current` if that element is a real previous
    focus target, otherwise falls back to `returnFocusRef.current`.
  - **Correction to the planned fix:** `!el.isConnected` alone isn't
    enough to detect the "trigger unmounted" case, because
    `document.activeElement` never becomes `null`/disconnected on its
    own -- it falls back to `document.body`, which is always
    `.isConnected`. Checking only `isConnected` would never actually
    reach the fallback. The condition also excludes
    `previouslyFocused === document.body` specifically, so a "focus
    reverted to body" capture is treated the same as a missing one.
  - `RecipeModal` and `IOSInstallHelp` both now accept and forward a
    `returnFocusRef` prop to the hook; `App.jsx` passes its existing
    `menuButtonRef` to both.
  - **Verified live** in Chrome via `npm run dev` + browser automation
    (a real interactive browser was available this session, unlike #3/#5's
    sandbox): opened the French Toast Recipe modal from the hamburger
    menu (which unmounts the dropdown item on click, reproducing the bug
    scenario), confirmed focus lands inside the modal, then confirmed
    focus returns to the menu button -- not `<body>` -- both via Escape
    and via the modal's own Close button. Re-confirmed the fallback
    branch is actually what's firing (not passing for an unrelated
    reason) by checking `previouslyFocusedRef.current` was genuinely
    `document.body` at close time in this scenario. `IOSInstallHelp`
    wasn't exercised live (this browser's UA isn't iOS, so that menu item
    never renders), but it shares the identical hook call and prop wiring
    as `RecipeModal`, which was verified. `npm run lint` and `vite build`
    both pass.

### 7. iPad never sees "Add to Home Screen" — ✅ FIXED

- **Where:** `src/App.jsx:29-32`.
- **Problem:** iPadOS 13+ Safari reports a Macintosh user agent, so the
  `iPad|iPhone|iPod` regex fails. `window.MSStream` is an IE11-era
  leftover.
- **Fix:**
  `/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)`,
  and drop the `MSStream` check.
- **Related:** `src/components/IOSInstallHelp.jsx:34` says "in Safari's
  toolbar". Since iOS 16.4, other iOS browsers also offer Add to Home
  Screen from their share menus, so make the wording browser-neutral.
- **Done:** implemented exactly as described in `src/App.jsx`'s `isIOS`
  memo, plus the `IOSInstallHelp.jsx` wording change ("in Safari's
  toolbar" → "in your browser's toolbar").
  - **Verified live in a real browser.** `isIOS` is computed once via
    `useMemo` on mount, so testing different UAs needed intercepting
    `navigator.userAgent`/`navigator.maxTouchPoints` before React's first
    render -- same timing constraint as #5's Permissions-API check. Used
    the same technique: a temporary shim `<script>` added to the top of
    `index.html` (before the app's own `<script type="module">`),
    reverted immediately after each check (confirmed clean via `git diff
    --stat index.html`, plus a re-run of lint/build).
  - A real iPad UA (`Macintosh...Safari/605.1.15`, the exact string
    iPadOS 13+ Safari sends, with `maxTouchPoints: 5`) → the hamburger
    menu now shows "Add to Home Screen", which is what this fix exists
    to make true (the old `/iPad|iPhone|iPod/`-only regex, with no
    `Macintosh`+touch-points branch, would never match this UA).
  - Control: the same UA string with `maxTouchPoints: 0` (a real Mac
    desktop/laptop, no touchscreen) → the item stays absent, so the fix
    doesn't false-positive on real Macs.
  - Regression check: a real iPhone UA (`iPhone...Mobile/15E148`) still
    triggers it, and its modal shows the updated "in your browser's
    toolbar" wording.
  - `npm run lint` and `vite build` both pass.

---

## P3 — Cleanup / hygiene

### 8. Service worker proxies every subresource for no benefit — ✅ FIXED

- **Where:** `public/sw.js:76`.
- **Problem:** `event.respondWith(fetch(event.request))` routes all JS, CSS,
  images, and cross-origin API calls through the SW. This adds overhead and
  changes nothing on failure.
- **Fix:** for non-navigation requests, simply `return` without calling
  `respondWith`. The fetch handler still exists, so installability is
  unaffected.
- **Verify:** Chrome DevTools → Application → Manifest shows no
  installability errors.
- **Done:** implemented exactly as described -- the `fetch` handler's
  non-navigation tail (previously `event.respondWith(fetch(event.request))`)
  now just falls off the end of the handler with no `respondWith` call,
  replaced by a comment explaining why (no caching/rewriting happens for
  these requests, so routing them through the SW added a hop for no
  behavior change; leaving the handler installed at all is what
  installability actually requires).
  - **Verified live in a real browser.** Registered the SW fresh (explicit
    `unregister()` + reload, rather than relying on whatever was already
    cached from earlier testing sessions), confirmed it reached
    `activated` and was controlling the page, then fetched the *running*
    worker's own `scriptURL` and confirmed its live source both contains
    the new explanatory comment and no longer contains
    `event.respondWith(fetch(event.request))` -- i.e. this wasn't just
    "the file on disk changed," the deployed worker is actually running
    the new code. All 29 page-load subresource requests (JS modules,
    CSS, manifest, icons) still returned 200 as normal. `beforeinstallprompt`
    still fires with this change (confirmed via the "Install App" menu
    item still appearing), which is the one behavior this fix must not
    break. `npm run lint` and `vite build` both pass.

### 9. Leftover Vite starter CSS in `src/index.css` — ✅ FIXED

- **Problem:** the whole file is the create-vite template stylesheet and
  still applies:
  - `#root { width: 1126px; border-inline: 1px solid var(--border); display: flex; ... }`
    draws grey side borders in dark mode on desktop (`--border` is undefined
    in light mode).
  - `color-scheme: light dark`
  - `p { margin: 0 }`
  - `h1`/`h2` font and color rules
  - unused `#social`, `.counter`, `code`, `--accent*` rules
  - `styles.css:76-79` already flags this dependency as fragile.
- **Fix:** delete `index.css` and its import in `src/main.jsx`. Move over
  only the rules actually relied on (at least
  `div[role=dialog] { text-align: left }`; check what depends on
  `p { margin: 0 }`).
- **Verify:** compare before and after:
  - light and dark mode
  - desktop and phone widths
  - both modals
  - recipe print preview
- **Done:** deleted `src/index.css` and its import in `src/main.jsx`. Traced
  every rule in the deleted file against the actual component tree (not
  just the two the item called out) before moving anything, since a
  "leftover template" rule can still be silently load-bearing:
  - **Moved into `styles.css`** (genuinely relied on):
    - `div[role="dialog"] { text-align: left; }` -- as the item flagged.
      Real dependency: `IOSInstallHelp`'s modal is nested inside
      `.app-page` (which centers all text), so it needs this to stay
      left-aligned; `RecipeModal` (rendered outside `.app-page`) doesn't
      strictly need it, but one shared rule for both is simpler.
    - `p { margin: 0; }` -- as the item asked to check. Turned out to be
      needed by several components that only override *one* margin side
      themselves (`.body-text`, `.frtcon-condition-line`,
      `.frtcon-footnote`, `.nws-alert-area-desc`, `.nws-alert-headline`,
      `.nws-alert-description`, `.modal-paragraph`) -- without the
      reset, the browser's default ~1em <p> margin would reappear on
      whichever side each one doesn't already set.
    - `h1, h2 { font-family: system-ui, "Segoe UI", Roboto, sans-serif;
      font-weight: 500; }` -- **not called out by this item**, but found
      while tracing dependencies: `.app-title`/`.card-title`/`.modal-title`
      all set their own margin/font-size/color, but none set
      font-family or font-weight, so removing the file outright would
      have silently swapped headings from this font/weight to
      `.app-page`'s inherited Arial at browser-default bold. Dropped the
      `color: var(--text-h)` part of the original rule, since every
      current h1/h2 already sets its own `color` (confirmed unused).
    - `:root { font-size: 18px; line-height: 145%; letter-spacing:
      0.18px; ... }` plus its `@media (max-width: 1024px) { font-size:
      16px }` companion and the font-rendering hints
      (`font-synthesis`/`text-rendering`/`-webkit-font-smoothing`/
      `-moz-osx-font-smoothing`) -- **also not called out**, and the
      single biggest risk found in this cleanup: this is where the base
      font-size for most unstyled/under-styled text in the app
      (`.body-text`, `.modal-paragraph`, all the `.nws-alert-*`
      paragraphs, `.frtcon-condition-line`, etc. -- none of which set
      their own `font-size`) actually comes from, via inheritance.
      Deleting the file without preserving this would have silently
      shrunk most of the app's body text from 18px (16px under 1024px)
      to the fixed 16px browser default.
  - **Dropped entirely** (confirmed not relied on anywhere, by grepping
    the component tree for every selector/variable in the file): the
    `#root` rule this item exists to fix (`width: 1126px`, the buggy
    `border-inline: 1px solid var(--border)`, `min-height: 100svh`,
    the flex properties, and its `text-align: center` -- `.app-page`
    already independently provides the equivalent min-height/background/
    centering, per its own comment); the redundant `body { margin: 0 }`
    (styles.css's existing `html, body, #root` rule already covers it);
    `color-scheme: light dark`; the `:root` `color`/`background` and
    unused `--text`/`--bg`/`--accent*`/`--code-bg`/`--social-bg`/
    `--shadow` custom properties (all fully overridden or unreferenced);
    the entire `@media (prefers-color-scheme: dark)` block (this is
    where the buggy `--border` was actually *defined* -- it only bit in
    dark mode because light mode left it undefined); `#social
    .button-icon`, `.counter`, and `code` (grepped -- no `<code>`
    element or `.counter`/`#social` class anywhere in `src/`).
  - **Judgment call, not asked for by this item:** left `color-scheme:
    light dark` out rather than replacing it with `color-scheme: dark`
    to match the app's permanently-dark visual design. The app has no
    native form widgets beyond one fully custom-styled text input, so
    the only realistic effect is native scrollbar/focus-ring theming
    for OS-dark-mode users, which is minor and orthogonal to this
    cleanup either way -- flagging in case someone disagrees.
  - Updated the stale comment on `.app-page`'s `text-align: center`
    (it referenced "the leftover Vite template rule in index.css" as a
    coincidental duplicate that "could be cleaned out from under this
    later" -- that's exactly what just happened, so the comment now
    reflects that instead of describing it as a future risk).
  - **Verified live in a real browser**, using `git stash`/`git stash
    pop` to flip between the pre- and post-cleanup code on the same
    running dev server: loaded a real ZIP lookup (55771) so most
    affected components render (headings, `.body-text`, the FRTCON
    condition box's commentary lines and footnote, alert cards), and
    confirmed via `getComputedStyle` that h1/h2 font-family/weight,
    `.body-text`/`.frtcon-condition-line`/`.frtcon-footnote` margins,
    and the root font-size are byte-for-byte identical before and after
    (`system-ui, "Segoe UI", Roboto, sans-serif` / `500` / `0px`/`0px`
    margins / `18px` in both cases) -- not just visually similar,
    numerically unchanged. Screenshots of the main page and the
    `RecipeModal` are pixel-identical between the two states (aside from
    the FRTCON commentary's own intentional randomization). Opened
    `IOSInstallHelp` (via the same temporary `index.html` UA shim
    technique used for #7/#5, reverted after) and confirmed its dialog
    still computes `text-align: left` and the expected paragraph margins
    despite being nested in `.app-page`'s centered context.
  - **Not independently re-verified:** phone width (this sandbox's
    browser window has a fixed size that `resize_window` couldn't
    shrink below ~2560px, so no literal narrow-viewport screenshot was
    taken) and OS dark mode specifically (no tool here can emulate
    `prefers-color-scheme`). Neither carries real risk: the
    `@media (max-width: 1024px)` rule moved into `styles.css` is
    byte-for-byte the same selector/media-query text as before, so its
    behavior can't have changed by construction; and OS dark mode's
    only relevant effect (the `--border` bug) is fixed by deleting the
    rule that defined `--border` in the first place, regardless of
    which color scheme is active.
  - Recipe print preview needed no live check: `index.css` never
    contained any `@media print` rules, and the existing `@media print`
    block in `styles.css` was left untouched by this change, so print
    rendering cannot be affected either way.
  - `npm run lint` and `vite build` both pass (CSS bundle shrank from
    8.15 kB to 6.68 kB raw / 2.44 kB to 1.94 kB gzipped, consistent with
    removing genuinely dead rules rather than just moving everything).

### 10. README is out of date — ✅ FIXED

- `README.md:37-40` says classification matches event, headline, and
  description. Since `a2e3cd1` it matches `event` only, plus the description
  for the "significant ice" case.
- `README.md:93-103` reads as setup still to do, but those `<head>` tags are
  already in `index.html`.
- `README.md:105-110` says the SW's only job is installability. It now also
  serves the reconnect fallback (#2).
- **Done:** all three updated.
  - The classification paragraph now describes the actual current
    matching: primarily `event` (a fixed NWS-published string, not free
    text), with the "significant ice" qualifier on Winter Storm Warning as
    the one documented exception that still reads `description`.
  - The PWA `<head>` tags block is reframed from "requires X to be added"
    to "already present, listed here so anyone rebuilding `index.html`
    from scratch knows they're required" -- same content, no longer reads
    as an outstanding to-do.
  - The service worker paragraph now covers both jobs: satisfying
    Chrome's installability requirement, and (since #2) catching a failed
    navigation and serving the backoff/give-up "Reconnecting…" page
    instead of Chrome's own blank offline interstitial, with a pointer to
    `public/sw.js` for the retry logic.
  - Left the "Known limitations" → "No offline support" bullet as-is: it's
    still accurate (no cached content or offline browsing, just a
    retry-then-give-up page for a transient failure), so no change was
    needed there.
  - Other parts of the README not named in this item (e.g. no mention yet
    of the friendlier error messages from #4, the visibility-refresh
    timestamp from #3, or the FRTCON 4 move from #13) were left alone --
    out of this item's stated scope; flag if a fuller pass is wanted.
  - **Also updated `CONTEXT.md`** (per user, 2026-09-14), correcting the
    same two stale spots there: the PWA bullet no longer calls `sw.js`
    "deliberately-empty" and now describes the reconnect fallback (#2);
    the auto-resume bullet now notes `frtcon_last_source`/
    `frtcon_last_zip` are only written on success and that resume is
    skipped when geolocation is known `denied` (#5). Also added one new
    bullet (not a correction, a genuine addition) documenting the
    zone-vs-point alerts decision from #1, since that's exactly the kind
    of non-obvious "decision made and why" CONTEXT.md exists to capture
    and nothing there mentioned it before.

### 11. No tests for the classification logic — ✅ FIXED

- **Problem:** `src/lib/frtcon.js` was written to be testable, but there is
  no test suite. Tests would have guarded a change like `a2e3cd1`.
- **Fix:** add `vitest` as a dev dependency with a `"test": "vitest run"`
  script. Cover:
  - each level's representative events
  - "Winter Storm Warning" + "significant ice" → level 1
  - a Watch whose description mentions "Warning" stays level 4
  - regional variant "Hard Freeze Warning" still matches
  - `determineFrtcon`: empty list, non-winter-only list, lowest level wins,
    `matchingAlerts` sorted
  - `pickRandomItems` returns `min(count, length)` unique items
- **Done (2026-09-30, as part of #15 below):** `vitest` (^2.1.9, the same
  version the soupcon fork uses) added with `"test": "vitest run"`.
  `src/lib/frtcon.test.js` covers every bullet above plus #13's cases
  (Frost Advisory / Freeze Warning alone → 4; with a Winter Weather
  Advisory → 3; Freeze Warning + Winter Storm Warning → 2), non-winter
  alerts → null, and case-insensitivity. `vite.config.js` limits vitest to
  `src/**/*.test.{js,jsx}` so the nested, gitignored `soupcon/` checkout's
  own tests aren't picked up. 36 tests, all passing.

### 12. Minor — ✅ FIXED

- **`public/manifest.json`:** no `"purpose": "maskable"` icon, so Android
  shows the icon shrunk inside a white shape. Add a 512px maskable variant
  with safe-zone padding.
- **`index.html:35`:** `apple-mobile-web-app-capable` is deprecated and
  Chrome logs a warning. Add
  `<meta name="mobile-web-app-capable" content="yes" />`, keeping the Apple
  tag for older iOS.
- **`src/data/recipe.js:16`:** "Put a couple pieces of bread in the pan for
  a few seconds" should be the baking **dish** from step 3. "Pan" means the
  cast iron pan everywhere else.
- **`src/lib/cache.js:7-22`:** expired entries are only removed when the
  same key is read again, so per-location zone and alert keys pile up in
  localStorage forever. Tiny, but a startup sweep of expired `frtcon_*`
  keys would fix it.
- **`src/App.jsx:304-309` / `:155-159`:** `runLookupFromCoordinates` aborts
  `activeRequestRef.current`, which at that moment is `performZipLookup`'s
  own controller. It's harmless today (the `catch` that would care is
  unreachable because `runLookupFromCoordinates` never throws), but
  confusing. Consider passing the existing controller into
  `runLookupFromCoordinates` instead of creating a second one.
- **Done:** all five fixed.
  - **Maskable icon:** generated `public/icon-512-maskable.png` from the
    existing `icon-512.png` artwork (via ImageMagick, no new design
    tool) rather than a fresh asset -- composited the existing icon
    scaled to 70% (360x360) centered onto a full-bleed `#0b1f3a` square
    background (matching the icon's own background color exactly, so
    there's no visible seam between the original icon's own rounded
    corners and the new full-bleed backdrop). 70% was chosen over the
    more common 80% convention for extra safety margin: the source
    icon's snowflake tips already reach close to its own edges, and at
    literal 80% scale the tips would sit only ~2% inside the
    theoretical safe-zone circle (80% diameter / 40% radius) -- 70%
    puts them at a comfortable ~14% margin instead. Added the new icon
    to `manifest.json`'s `icons` array with `"purpose": "maskable"`,
    keeping the existing `"any"` entries unchanged.
  - **`mobile-web-app-capable`:** added to `index.html`, keeping the
    `apple-mobile-web-app-capable` tag alongside it (still needed for
    older iOS) rather than replacing it.
  - **`recipe.js`:** step 4's "in the pan" -> "in the dish", since at
    that point in the recipe the bread is being dipped in step 3's
    batter dish, not yet transferred to the cast-iron pan (that happens
    in step 5, "Butter your pan and add the bread").
  - **`cache.js`:** added `sweepExpiredCache()`, called once from
    `main.jsx` at startup. Iterates `Object.keys(localStorage)`,
    matches each key against the three TTL-cache prefixes
    (`ZIP_CACHE_PREFIX`/`ZONE_CACHE_PREFIX` at `CACHE_TTL_MS`,
    `ALERTS_CACHE_PREFIX` at the shorter `ALERTS_CACHE_TTL_MS`), and
    calls the existing `getCacheItem` on each match purely for its
    expiry-eviction side effect rather than duplicating that check.
    Leaves `frtcon_last_zip`/`frtcon_last_source`/anything else alone.
  - **`App.jsx` controller refactor:** `runLookupFromCoordinates` now
    accepts an optional `{ controller }` option; when given (as
    `performZipLookup` now does, passing its own controller through
    instead of letting `runLookupFromCoordinates` create and
    self-abort-into a second one), it's used directly instead of the
    original abort-whatever's-in-flight-then-create-a-new-one dance.
    Callers with no controller of their own (`handleUseBrowserLocation`
    -- geolocation has no `AbortController` equivalent) are unaffected
    and still get that original behavior, which is what's actually
    needed there to cancel a concurrent ZIP lookup.
  - **Verified live in a real browser** (all five, via `npm run dev` +
    browser automation):
    - Real ZIP lookup (55771) still works normally after the
      `runLookupFromCoordinates` refactor.
    - Fired two ZIP submissions back-to-back with no delay (55771 then
      90210) to specifically exercise the cancellation path the
      refactor must not weaken: the final rendered result and
      `frtcon_last_zip` both reflect only the second ZIP: network logs
      confirmed the *first* ZIP's own `zippopotam.us` request never
      even completed (only the second ZIP's requests appear at all,
      including the downstream `api.weather.gov` calls) -- genuinely
      aborted, not just superseded-after-completing.
    - Recipe modal now shows "Put a couple pieces of bread in the dish
      for a few seconds..." in the Steps list.
    - Fetched the live `manifest.json` through the running page and
      confirmed the new maskable icon entry is present alongside the
      unchanged `"any"` ones, and that `/icon-512-maskable.png` itself
      serves as a real 200 `image/png`; confirmed the new
      `mobile-web-app-capable` meta tag renders in the DOM.
    - Seeded `localStorage` with expired zone/zip/alerts entries, fresh
      zone/alerts entries, and the plain non-TTL
      `frtcon_last_zip`/`frtcon_last_source` keys, then reloaded:
      confirmed only the three expired entries were swept, the fresh
      ones and the non-TTL keys were left untouched.
    - Also spot-checked the maskable icon's design itself (not just
      that it's wired up) by simulating a full circular Android mask
      over it locally -- the snowflake stays comfortably inside.
  - `npm run lint` and `vite build` both pass; `manifest.json` confirmed
    valid JSON and the new icon confirmed present in `dist/` after a
    production build.

---

## Product changes (decided)

### 13. Lower Frost Advisory (and Freeze Warning) from FRTCON 3 to FRTCON 4 — ✅ FIXED

- **Where:** `src/lib/frtcon.js:74` (`event.includes("frost advisory")` in
  the level-3 check).
- **Why:** a Frost Advisory is mainly an agricultural alert. It's common in
  spring and fall far from real winter conditions, and doesn't mean going
  out is a bad idea. Two Frost Advisories were active nationally on
  2026-09-14.
  - Live test 2026-09-14, ZIP 55771 (Orr, MN → zone `MNZ011`): the only
    active alert was a zone-coded Frost Advisory, which the app scored as
    **FRTCON 3 "Moderate impacts active"** in mid-September. The zone query
    and the proposed `?point=` query (#1) returned the same result here,
    as expected for a zone-coded alert.
- **Fix:**
  - Move `event.includes("frost advisory")` from the level-3 `match` list
    to the level-4 list, beside `freeze watch`.
  - Update the comment above the level-3 cold hazards
    (`frtcon.js:71-72`) so it no longer covers frost.
  - Update the README FRTCON scale table (`README.md:33-34`): remove Frost
    Advisory from level 3 and add it to level 4.
  - Add a test case for it in #11: a Frost Advisory alone → level 4; a
    Frost Advisory plus a Winter Weather Advisory → level 3.
- **Watch for:** the level-4 wording ("Winter weather is being watched, but
  major impacts are not active yet") describes a Watch rather than an active
  advisory. It fits well enough, but check it reads sensibly next to a Frost
  Advisory tag.
- **Verify:** run the ZIP 55771 test script (or any ZIP with an active
  Frost Advisory and no other winter alerts); it should score FRTCON 4.
- **Done:** decided (per user, 2026-09-14) to move Freeze Warning to
  FRTCON 4 alongside Frost Advisory rather than leave it at level 3 —
  same reasoning (mostly agricultural, common outside real winter
  conditions), so both are now weighted equally. Implemented in
  `src/lib/frtcon.js`: both `frost advisory` and `freeze warning` moved
  from the level-3 `match` list to the level-4 list, with comments at both
  sites explaining why. Updated the README FRTCON scale table to match.
  Verified with synthetic alerts covering: Frost Advisory alone → 4,
  Freeze Warning alone → 4, Frost Advisory + Winter Weather Advisory → 3
  (the more severe alert still wins), Freeze Warning + Winter Storm
  Warning → 2, and sanity checks that Freeze Watch (level 4) and Cold
  Weather Advisory (still level 3) were untouched. Re-ran the live ZIP
  55771 test (Orr, MN — lone Frost Advisory): now scores **FRTCON 4**
  instead of the previous FRTCON 3. `npm run lint` and `vite build` both
  pass.
  - **Considered and left alone (per user, 2026-09-14):** the level-4
    title/reason ("Being watched, no major impacts yet" / "Winter weather
    is being watched, but major impacts are not active yet") and its
    flavor text in `src/data/alertMessages.js` were written for a Watch --
    weather that hasn't arrived yet -- and read a little differently next
    to an active Frost Advisory or Freeze Warning. Decided not to special-
    case the copy for this: those alerts aren't significant enough in this
    context to warrant their own wording, so sharing level 4's existing
    "low-stakes" framing is fine as-is. No change made.
  - **Still open:** automated test coverage for this (#11) -- verified
    manually above, not yet captured in a test suite.

## Backports from the soupcon fork (2026-09-30)

The soupcon.org fork (a local copy sits in `soupcon/`, gitignored and
excluded from lint/tests) grew several fixes to the plumbing both apps
share. Reviewed both codebases side by side; these five were taken as-is or
lightly adapted. Its Sources chart, gridpoint/`relativeLocation` label and
Open-Meteo worldwide path were **not** taken: the chart needs a
FRTCON-specific design, and worldwide support would need a second,
forecast-based FRTCON scale since Open-Meteo has no alerts. Neither is
started; both are listed under "Ideas for later" in README.md.

### 14. Recipe modal fell back to a serif font — ✅ FIXED

- **Problem:** `RecipeModal` renders outside `.app-page` (so it prints on
  its own), so it never inherited the app's Arial and used the browser's
  default serif. Found and fixed in soupcon (its SOUP_PLAN item 17).
- **Done:** `.modal-card` in `src/styles.css` sets the same `font-family`
  as `.app-page`. Verified in headless Chrome: a recipe list item's
  computed font is `Arial, Helvetica, sans-serif` on screen and under
  print media emulation.

### 15. Test suite (vitest) — ✅ FIXED

- **Done:** see #11 for the classifier tests. Also added
  `src/lib/weatherApi.test.js` (9 tests, `fetch` stubbed the way soupcon's
  suite does): `fetchJson` throws an `HttpError` with status/URL and flags
  its own timeout as `timeout: true`; `getLatLonFromZip` gives the friendly
  not-found message on a 404 and on a 200 with no places, and the generic
  message (no URL) on a 500; `getZoneByPoint` returns id/name and gives the
  "isn't covered" message on a `/points` 404; `getActiveAlertsByPoint`
  queries `?point=` (guards #1). `eslint.config.js` ignores `soupcon/` too
  (its built `dist/` bundle otherwise produced 152 lint errors).

### 16. Browser-geolocation errors showed the browser's raw text — ✅ FIXED

- **Problem:** the final geolocation error was `${geoError.message} Try
  entering a ZIP code instead.`, so a timeout read "Timeout expired Try
  entering a ZIP code instead." -- Chrome's bare wording, nothing
  actionable, after a ~45 s wait. Reported against soupcon by a user in
  Romania (its SOUP_PLAN item 23); the same code was here.
- **Done:** new `src/lib/geolocationError.js` (from soupcon):
  `geolocationErrorMessage` gives plain text per error code (timeout says
  the device didn't report its location within 45 seconds; position
  unavailable; permission denied keeps the existing iPhone instructions;
  anything else is generic), each ending with `ZIP_FALLBACK_HINT` ("You can
  enter a ZIP code below instead."). The "no geolocation support" message
  uses the same hint. The two timeouts are now the named constants
  `GEOLOCATION_FAST_TIMEOUT_MS`/`GEOLOCATION_PRECISE_TIMEOUT_MS`, used by
  `App.jsx`, so the "45 seconds" can't drift from the real wait. The
  low-accuracy-then-high-accuracy retry is unchanged (soupcon tried
  removing it and reverted; see CONTEXT.md). Soupcon's hint also points
  non-US visitors at its city search; not applicable here, FRTCON is
  US-only. 4 tests in `geolocationError.test.js`. Verified in headless
  Chrome with a stubbed `navigator.geolocation` failing with codes 3, 2
  and 1: each showed the expected message; codes 3/2 made the retry
  (2 calls), code 1 didn't (1 call).

### 17. `?lat=&lon=` URL parameters — ✅ FIXED

- **Done:** ported from soupcon (its SOUP_PLAN item 21). `App.jsx` reads
  `?lat=..&lon=..` once at module load (`readUrlLocation`); both must be
  numeric and in range, else they're ignored. When valid they win over the
  remembered lookup on load (source `"url"`) and are **not** saved to
  `frtcon_last_source`/`frtcon_last_zip`, so a shared link doesn't replace
  a visitor's own remembered method. While that location is on screen,
  "Using Lat: {lat} Lon: {lon}" shows beside Search ZIP
  (`.custom-location-note`). A step toward the shelved "server-rendered
  share previews" idea, which would use the same parameters.
- **Verified in headless Chrome** (`vite preview` of the production
  build, live NWS): Duluth coordinates → FRTCON result with the note, and
  nothing saved; with a saved ZIP, the URL still wins and the saved ZIP is
  left intact; a ZIP search afterwards removes the note and saves
  `zip`; `lat=999`, a lone `lat` and `lat=abc` are ignored (no lookup, no
  note); London → "This location isn't covered by the National Weather
  Service."; 390 px width has no horizontal overflow.
- **Not unit-tested:** `readUrlLocation` is inline in `App.jsx` (module
  load), covered by the browser checks above only.

### 18. CONTEXT.md gotchas learned in the fork — ✅ FIXED

- **Done:** added to CONTEXT.md's gotchas: `mod_headers` was off on the
  shared Apache (fixed there with `a2enmod headers`; confirmed live that
  frtcon.com now sends its `Link` header), Vite 8's Node version floor, and
  how to run headless Chrome on this host. Also checked live that
  frtcon.com's `robots.txt` is served as written, i.e. Cloudflare's managed
  robots.txt (enabled on the soupcon.org zone) is not on for this zone.

## Features

### 19. 48-hour winter outlook chart — ✅ FIXED

- **Ask (per owner, 2026-09-30):** adapt soupcon's Sources chart for FRTCON,
  plotting snowfall, temperature and chance of precipitation from NWS's
  gridpoint data. Leave the location label (the NWS zone name) alone.
- **Changed from what was proposed, and why:**
  - **Three stacked charts instead of one.** The proposal was one chart
    (snowfall bars, a temperature line and a chance-of-precipitation
    area), which needs three y-scales. Split into three small charts on
    one time axis with a synced hover instead.
  - **Snow as per-period blocks, not hourly bars.** Probed live: NWS gives
    `snowfallAmount` as 6-hour totals (Fairbanks: 20.32 mm in one 6 h
    block). Soupcon's `expandGridValues` repeats a value across its
    interval, which would have multiplied these by 6, and hourly bars
    would imply a timing NWS doesn't forecast. Each period is drawn as one
    block at its total. Ice accumulation was added the same way, since
    freezing rain drives FRTCON 1-2.
- **Done:**
  - `src/lib/winterOutlook.js` (pure): `gridPeriods` parses ISO 8601
    intervals; `buildOutlook(raw, now)` returns 48 hourly slots from the
    current hour. Temperature and chance of precipitation are repeated per
    hour; snow and ice carry their period's total. It also returns the
    periods overlapping the window and their totals (a period already
    under way counts in full). Converts °C→°F and mm→in. `formatSnow`
    rounds to 0.1 in, `formatIce` to 0.01 in.
  - `getWinterOutlook` in `weatherApi.js`: `/points` → `forecastGridData`,
    keeping only the four layers. Cached under `frtcon_grid_url_` (1 h)
    and `frtcon_outlook_` (30 min), both added to `sweepExpiredCache`.
    Uses the same friendly-error handling as the other lookups.
  - `WinterOutlookPanel.jsx`: a collapsible "48-hour winter outlook" under
    Active Alerts, collapsed by default. Fetches only while open and
    refetches on each main refresh (a failed refresh keeps the last data).
    Loaded data is tagged with its location. Shows a note that it's
    reference only, the 48-hour snow/ice totals (or "No snow or ice..."),
    the chart, and a collapsed "Details" table view (amount periods, then
    every hour).
  - `WinterOutlookChart.jsx` (`React.lazy`, uPlot ^1.6.32, ~24 KB gzipped
    separate chunk): three synced uPlot charts with no uPlot legends and
    one readout line, e.g. "Thu 2 AM: 34°F, 49% chance of precipitation.
    Snow 0.1 in (2 AM-8 AM), ice 0.25 in (12 AM-6 AM)."
    - Snow and ice use stepped blocks, with an HTML legend (swatch plus
      text).
    - Temperature always keeps 32°F in range, with a dashed, labeled
      freezing line.
    - Chance of precipitation is a stepped area from 0-100%.
    - Colors are dataviz palette dark slots 1-2, validated on `#122b4d`
      with the skill's validator (all checks pass).
  - `App.jsx` renders the panel. Styles are under a new
    `.outlook-*` section in `styles.css`.
  - Tests: `winterOutlook.test.js` (9) and 2 `getWinterOutlook` tests in
    `weatherApi.test.js`. 60/60 pass; lint and build pass.
- **Verified in headless Chrome** (`vite preview`, live NWS):
  - Fairbanks, which had snow forecast:
    - Neither uPlot's chunk nor `/gridpoints/` is requested until the
      panel is opened.
    - Totals read "1.0 in of snow". The Details table matches the NWS
      periods (0.1 / 0.8 / 0.1 in).
    - Hovering any chart moves all three cursors to the same x and fills
      the readout; moving away resets it.
    - At 390 px there's no horizontal overflow and all three plot areas
      are the same width.
  - Switching to ZIP 55771 keeps the panel open and shows that place's
    "No snow or ice..." line.
  - Ice: injected into the gridpoint response by request interception.
    Totals, orange blocks, the readout and Details are all correct.
  - Screenshots checked at 900 and 390 px.
- **Found and fixed by that check:**
  - The bottom chart's plot area was 25 px narrower (uPlot made room for
    its last time label), so hover lined up with different hours. Fixed
    by giving all three charts the same padding.
  - The "0 in" label was clipped on the upper charts.
  - An all-zero ice series drew an orange line over the snow's zero
    baseline. It's now hidden, with the legend reading
    "Ice (none forecast)".
  - The readout labeled ice with the snow period's hours. Each now gets
    its own range.
  - Vertical time gridlines were added to the upper charts.
- **Not verified:** touch interaction on a real phone (uPlot's default
  touch handling, as in soupcon), and real-world ice (only injected).
  Wind chill was left out of scope.

### 20. Rain (and precipitation type) on the outlook chart — ✅ FIXED

- **Ask (per owner, 2026-09-30):** include rain on the outlook chart, "even
  if it is just changing the color of the bar." Before this, snow and ice
  amounts were charted, and the chance-of-precipitation chart didn't say
  what kind.
- **Done:**
  - **Data.** `getWinterOutlook` also keeps the gridpoint `weather` layer,
    with each condition trimmed to coverage/weather/intensity. A cached
    entry without it counts as a miss, so older 30-minute entries don't
    render without types.
    - In `winterOutlook.js`, `precipTypeOf` maps NWS's full weather-type
      enum (checked against api.weather.gov's OpenAPI spec) to ice (freezing
      rain, freezing drizzle, sleet), snow (snow, snow showers) or rain
      (rain, rain showers, drizzle, thunderstorms, hail). Non-precipitation
      types are ignored.
    - A mix takes the most hazardous category (ice > snow > rain) and keeps
      every type's word. `buildOutlook` adds `precipType` per hour.
    - `precipChanceByCategory` splits the chance into one series per type
      (plus "none") and adds a closing point after each run, so stepped
      blocks meet without a one-hour gap. The exception is a type resuming
      after a single hour: closing there would join its two runs across
      the other type's hour, so it's left as a gap. `listWords` joins the
      type words for display.
  - **Chart.** The chance-of-precipitation chart draws four colored series:
    - aqua `#199e70` = rain (new)
    - blue = snow
    - orange = freezing rain / sleet (legend later shortened to "Sleet",
      per owner; the readout still names freezing rain/drizzle exactly)
    - gray `#7d8ca3` = type not given (legend later renamed
      "Unspecified", per owner)
    Blue and orange keep the meaning they have in the snow/ice chart. The
    three category colors were validated with `--pairs all` on `#122b4d`
    (all pass), and the gray has 4.2:1 contrast. The chart has its own
    legend, which shows "Type not given" (now "Unspecified") only when
    some hour needs it.
    Legends wrap at phone width.
  - **Readout and Details** name the types, e.g. "80% chance of freezing
    rain and sleet" or "60% chance of snow and rain". With no type given,
    they still say "chance of precipitation".
  - **Not added:** a rain amount. NWS's `quantitativePrecipitation` is the
    liquid equivalent of all precipitation, not rain alone, so it can't be
    shown as rain the way snow and ice are.
  - Tests: 17 new in `winterOutlook.test.js` (every precipitation type,
    mix precedence, ignored types, per-hour assignment, run closing and the
    one-hour-resume case, `listWords`), plus the weather-trimming
    assertion in `weatherApi.test.js`. 77/77 pass; lint and build pass.
- **Verified in headless Chrome** (`vite preview`):
  - Live Fairbanks: blue snow blocks, gray where NWS gives a chance but no
    type, and readouts "49% chance of snow" / "14% chance of
    precipitation".
  - An injected sequence (rain, then freezing rain + sleet, then snow +
    rain, then no type) drew aqua, orange, blue and gray blocks meeting
    with no gaps. The readouts said "40% chance of rain", "80% chance of
    freezing rain and sleet" and "60% chance of snow and rain".
  - 390 px: legends wrap, no overflow.

### 21. Forecast snow/ice lifts a no-alert FRTCON 5 to 4 — ✅ FIXED

- **Report (per owner, 2026-09-30):** Fairbanks showed FRTCON 5 while the
  outlook had ~1 in of snow in the next 48 hours. Checked live: the NWS
  text forecast said "New snow accumulation of around one inch possible"
  tonight and Thursday. The only active alert was a Special Weather
  Statement ("about 1 inch or less is expected around Fairbanks"), which
  FRTCON ignores. An inch is too routine in Fairbanks for an advisory.
- **Options put to the owner:**
  1. Let forecast snow/ice lift 5 to 4.
  2. Keep 5 with different wording.
  3. Read Special Weather Statements' free text for snow (advised
     against).

  **Owner chose option 1, with a 1 in snow threshold** (rather than any
  measurable 0.1 in). Any ice counts.
- **Done:**
  - `determineFrtcon(alerts, forecast)` in `src/lib/frtcon.js`: when no
    winter alert matches (none, or only non-winter ones), >= 1.0 in snow or
    any ice in `forecast` (`{ snow, ice }`, buildOutlook's 48-hour totals)
    returns level 4 with `forecastDriven: true`.
    - Title is "Snow (or Ice) in the forecast, no winter alerts yet".
    - Reason is "NWS forecasts 1.0 in of snow [and 0.10 in of ice] in the
      next 48 hours, but no winter weather alerts are active."
    - Snow is compared at its displayed 0.1 in precision, so a float sum
      like 0.1 + 0.8 + 0.1 can't show "1.0 in" but score 5. Ice is
      compared at 0.01 in.
    - Winter alerts always win. The result is never above 4, and with no
      forecast the rule is alert-only as before.
    - `FORECAST_SNOW_MIN_IN` is exported for the panel's note.
  - `App.jsx` now loads the outlook with every lookup, after
    `getZoneByPoint`, which caches the grid URL from its `/points`
    response, so there's still one `/points` request.
    - Its failure is caught: the score is alert-only and `outlookError`
      goes to the panel.
    - `refreshAlerts` also refreshes it, through its 30-minute cache, and
      keeps the last good outlook on failure.
    - `outlook` is built once in `App` and used for both the score and the
      panel. The panel no longer fetches anything; its note now explains
      the 5-to-4 rule.
    - A "Forecast driving the score" block, e.g. "Snow: 1.0 in in 48
      hours", shows where "Winter alerts driving the score" would.
  - Cost, checked live: the gridpoint request is ~60 ms and ~10 KB
    gzipped (175 KB raw).
  - Tests: 6 new in `frtcon.test.js` covering:
    - the threshold
    - display-precision rounding, including a 0.1 + 0.8 + 0.1 float sum
    - ice and combined wording
    - non-winter alerts only
    - never overriding a winter alert or exceeding 4
    - no or light forecast

    83/83 pass; lint and build pass.
- **Verified in headless Chrome** (`vite preview`, live NWS):
  - Fairbanks → FRTCON 4, "Snow in the forecast, no winter alerts yet",
    "Forecast driving the score: Snow: 1.0 in in 48 hours", and the
    #FRTCON4 headline, with one `/points` request.
  - Duluth → still FRTCON 5 ("No snow or ice in the forecast").
  - Fairbanks with the gridpoint request forced to 503 → the lookup still
    succeeds at alert-only FRTCON 5, and the panel shows "Couldn't load the
    forecast...".
- **Known effect, accepted:** the 48-hour total counts an NWS period
  already under way in full (#19), so a forecast-driven 4 can last until
  that period ends even after the snow has fallen.
- **Not verified:** the refresh path in a browser (it reuses the tested
  lookup pieces); ice-only triggering against live data.

### 22. "Check your SOUPCON" link on rain alerts — ✅ FIXED

- **Ask (per owner, 2026-09-30):** the mirror of soupcon.org's "Snow
  soon, check your FRTCON!" link. Show a link to SOUPCON when a rain alert
  (e.g. a Flood Watch) is active.
- **Done:**
  - `isRainAlert(alert)` in `src/lib/frtcon.js` matches events containing
    "flood", except Coastal Flood and Lakeshore Flood (tide/surge/wind
    driven). Checked against api.weather.gov/alerts/types, that covers
    Flood and Flash Flood Watch/Warning/Advisory/Statement. Not included:
    Severe Thunderstorm, tropical and Hydrologic Outlook alerts, which are
    about wind/hail/storms or are outlooks rather than rain events.
  - `App.jsx`: when any active alert matches, a "Rain alert, check your
    SOUPCON!" link (`https://soupcon.org`, new tab, `noopener noreferrer`)
    appears after the Share button.
  - `styles.css`: `.soupcon-crosslink-pill`, a violet `#a78bfa` pill with
    `#1a0f2e` text (6.7:1). It joins the status row's shared
    height/font-size rule and wraps to its own line on a phone.
  - Tests: 13 new in `frtcon.test.js` (all 7 flood-family events match;
    Coastal/Lakeshore Flood, Severe Thunderstorm, Winter Storm and
    Hydrologic Outlook don't; missing event). 96/96 pass; lint and build
    pass.
- **Verified in headless Chrome** against live alerts:
  - A point inside an active Flood Warning (Jewell/Mitchell County, KS)
    showed the link at 900 px, inline after Share, 40 px tall like the
    others, with the correct href/target/rel.
  - A point inside an active Flood Advisory (Oklahoma City area) at 390 px
    showed the link wrapped onto its own line, with no overflow.
  - Duluth (no alerts) showed no link.
  - Screenshots checked.
- **Considered, not done:** triggering on the outlook's rain forecast
  instead. That would show the link on most rainy days rather than for
  significant rain.

### 23. "Lets make French Toast!" pill at FRTCON 1-2 — ✅ FIXED

- **Ask (per owner, 2026-09-30):** like soupcon's "Lets make {soup}!"
  pill, show "Lets make French Toast!" when the level is FRTCON 1 or 2.
- **Done:**
  - `App.jsx`: when `frtcon.level <= 2`, a button in the status row (after
    Share, before the SOUPCON link) opens the recipe modal. Focus returns
    to the pill on close, since `useModalBehavior` restores the element
    that opened the modal. That's better than soupcon, which always sends
    focus back to the menu button.
  - `styles.css`: `.french-toast-pill` is cream `#fff7e6` with a 2 px
    amber `#f59e0b` border and `#3f2b00` text (12.7:1), matching the
    condition box. It joins the status row's shared height/font rule.
    Soupcon's solid amber was not used because it read as a second badge
    beside the orange `#f97316` FRTCON 2 badge.
- **Verified in headless Chrome** (`vite preview`, alerts injected by
  request interception, since no real location is at 1-2 in September):
  - A Blizzard Warning (FRTCON 1, 390 px) and a Winter Storm Warning
    (FRTCON 2, 900 px) both showed the pill, 40 px tall like its
    neighbors. At 390 px it wraps to its own line with no overflow.
  - Enter on the pill opened "Jeff's French Toast Recipe" with focus
    inside; Escape closed it and focus returned to the pill.
  - A Winter Weather Advisory (FRTCON 3) and no alerts (FRTCON 5) showed
    no pill.
  - Screenshots checked. Lint and build pass; no unit test (JSX condition
    only).

## Checked, no change needed

- Request race handling (AbortController plus the geolocation sequence
  counter) is sound.
- No XSS risk: all NWS text is rendered as React text nodes.
- The SW fallback page's inline script isn't blocked by CSP (the synthesized
  response has no CSP header).
- Dropdown and modal keyboard handling work apart from #6.

## Suggested order

1. **#1 + #3 together** (alerts source, `result` shape, refresh effect)
2. **#2** (SW offline loop)
3. **#4, #5** (errors, remembered failures)
4. **#6, #7** (a11y, iPad)
5. **#11 then #13** (add classification tests, then move Frost Advisory to
   FRTCON 4 with a test covering it)
6. **#8–#10, #12** (cleanup, docs)
