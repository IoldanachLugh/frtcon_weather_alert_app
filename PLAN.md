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
  and reload. `npm run lint` and `vite build` both pass. Not yet verified
  in an actual installed PWA under airplane mode (needs a device;
  recommend a manual check before relying on it in production).

---

## P2 — UX / robustness

### 3. No refresh when the app returns to the foreground

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

### 4. Raw technical error messages shown to users

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

### 5. Failed lookups are remembered and auto-retried on every visit

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

### 6. Focus isn't restored after closing a modal opened from the menu

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

### 7. iPad never sees "Add to Home Screen"

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

---

## P3 — Cleanup / hygiene

### 8. Service worker proxies every subresource for no benefit

- **Where:** `public/sw.js:76`.
- **Problem:** `event.respondWith(fetch(event.request))` routes all JS, CSS,
  images, and cross-origin API calls through the SW. This adds overhead and
  changes nothing on failure.
- **Fix:** for non-navigation requests, simply `return` without calling
  `respondWith`. The fetch handler still exists, so installability is
  unaffected.
- **Verify:** Chrome DevTools → Application → Manifest shows no
  installability errors.

### 9. Leftover Vite starter CSS in `src/index.css`

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

### 10. README is out of date

- `README.md:37-40` says classification matches event, headline, and
  description. Since `a2e3cd1` it matches `event` only, plus the description
  for the "significant ice" case.
- `README.md:93-103` reads as setup still to do, but those `<head>` tags are
  already in `index.html`.
- `README.md:105-110` says the SW's only job is installability. It now also
  serves the reconnect fallback (#2).

### 11. No tests for the classification logic

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

### 12. Minor

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
