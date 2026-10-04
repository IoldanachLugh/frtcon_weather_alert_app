# FRTCON — Code Review Log

> Shared for portfolio & demonstration purposes. All rights reserved.

In September 2026 I did a full review of the codebase (starting at commit
`7ff8fdb`). This log records what the review found and what was done about
each issue. It also covers the fixes brought back from the SOUPCON fork and
the features added afterward. Each entry gives the problem, the fix, and how
the fix was verified.

All items below are done. Line references point to the code as it was at
review time.

**Contents**

- [Correctness](#correctness): 1–2
- [UX and robustness](#ux-and-robustness): 3–7
- [Cleanup](#cleanup): 8–12
- [Product changes](#product-changes): 13
- [Backports from SOUPCON](#backports-from-soupcon): 14–18
- [New features](#new-features): 19–23
- [Checked, no change needed](#checked-no-change-needed)

---

## Correctness

### 1. Alerts query missed county- and polygon-based warnings ✅

**Problem.** Alerts were fetched with `/alerts/active/zone/{zoneId}`, which
only returns alerts tied to a forecast zone. Alerts issued by county or storm
polygon were silently dropped, including Snow Squall Warnings (a FRTCON 2
alert type). For four county-based alerts active at the time, the zone query
returned none of them, and `/alerts/active?point=` returned all four.

**Fix.** Replaced it with `getActiveAlertsByPoint(lat, lon)`, which caches by
rounded coordinates. The auto-refresh now runs per coordinate rather than per
zone, and the zone lookup is used only for the area's display name.

**Verified** live against an active county-based Flash Flood Warning: the
old query returned 0 alerts, and the new one returned the warning.

### 2. The offline fallback page reloaded forever ✅

**Problem.** When a page load failed, the service worker's "Reconnecting…"
page reloaded every 1.5 seconds with no limit. In airplane mode or during
an outage, the installed app would spin forever and drain the battery.

**Fix.** Retries now back off (1.5s, 3s, 6s, 6s) with the attempt count kept
in `sessionStorage`. After 4 attempts, or right away if the browser reports
being offline, the page says "Can't reach FRTCON" and shows a Retry button.
The browser's `online` event triggers a retry too, and a successful app load
resets the counter.

**Verified** by running the exact HTML the service worker produces in a real
browser: the delays grow as expected, the page gives up after 4 attempts,
offline detection is immediate, and Retry and the `online` event both
restart the cycle. *Not yet tested:* an installed app on a real device in
airplane mode.

---

## UX and robustness

### 3. No refresh when the app came back to the foreground ✅

**Problem.** Mobile browsers pause timers in background tabs and suspended
apps, so a reopened app could show alerts from hours ago with no sign that
they were old.

**Fix.** Each result records when it was fetched. When the page becomes
visible again and the data is more than 60 seconds old, it refreshes right
away. The current-conditions card now shows "Updated h:mm".

**Verified** in a browser: returning to the tab while the data was fresh made
no request. After 65 seconds, returning made exactly one request, and the
timestamp updated.

### 4. Raw technical errors were shown to users ✅

**Problem.** Users saw messages like
`Request failed (404) for https://api.zippopotam.us/us/00000`.

**Fix.** `fetchJson` now throws an `HttpError` that carries the status and
URL. Each call site translates it into a plain message:

- Unknown ZIP: "We couldn't find that ZIP code."
- Outside NWS coverage: "This location isn't covered by the National
  Weather Service."
- Anything else: "The weather service isn't responding right now. Try again
  in a minute."

The technical details still go to the browser console.

**Verified** with a nonexistent ZIP, a London coordinate, a simulated 500
error, and a forced timeout. *Left as is:* a network failure with no HTTP
response at all, such as being offline, still shows the browser's own
message.

### 5. Failed lookups were remembered and retried on every visit ✅

**Problem.** The "last used method" was saved before the lookup ran. A user
who denied location permission once would see the permission error on every
later visit, and a bad ZIP behaved the same way.

**Fix.** It's now saved only after a lookup succeeds. The automatic
geolocation lookup on page load is also skipped if the Permissions API
reports location access as `denied`. A manual click still always tries.

**Verified** in a browser: a bad ZIP isn't remembered, a later failure
doesn't overwrite an earlier success, and the automatic lookup is skipped
when permission is `denied` but still runs when it's `prompt`.

### 6. Focus wasn't restored after closing a modal opened from the menu ✅

**Problem.** The menu item that opens a modal is removed in the same render
that opens it, so on close, focus went to `<body>`. Keyboard and
screen-reader users lost their place.

**Fix.** `useModalBehavior` takes an optional `returnFocusRef` to fall back
on. The planned check (`!el.isConnected`) turned out to be wrong:
`document.activeElement` falls back to `<body>`, which is always connected.
So the fallback is also used when the previously focused element is
`<body>`.

**Verified** in a browser: closing the recipe modal with Escape or with its
Close button returns focus to the menu button.

### 7. iPads never saw "Add to Home Screen" ✅

**Problem.** iPadOS Safari identifies itself as a Mac, so the
`iPad|iPhone|iPod` check failed.

**Fix.** iPads are now detected as a Mac user agent with a touchscreen
(`maxTouchPoints > 1`). The outdated IE11 check was removed, and the
instructions now say "your browser's toolbar", since iOS browsers other
than Safari can add to the home screen too.

**Verified** with the iPad, Mac (no touch), and iPhone user agents. Each
behaved correctly.

---

## Cleanup

### 8. The service worker passed every request through itself for no reason ✅

The service worker passed every script, image, and API call through itself
without changing anything. It now ignores everything except page loads.
Installability only needs the fetch handler to exist. **Verified** that the
running service worker had the new code, every resource still loaded, and
the Install option still appeared.

### 9. Leftover Vite starter CSS ✅

`src/index.css` was the stylesheet from Vite's starter template. Among other
things, it drew gray side borders in dark mode. I traced every rule in it
before deleting it, since template leftovers can still be holding something
up. Four rules turned out to matter and were moved into `styles.css`:

- the dialog text alignment
- `p { margin: 0 }`
- the heading font
- the base font size of 18px (16px on narrow screens)

The base font size was the important catch. Without it, most of the app's
body text would have quietly shrunk.

**Verified** by switching between the old and new code on one running dev
server. Fonts, margins, and sizes were identical in the browser, and
screenshots matched pixel for pixel. The CSS bundle shrank from 2.44 kB to
1.94 kB gzipped.

### 10. README was out of date ✅

Updated to match the code: how classification works, the PWA tags that were
already in place, and the service worker's reconnect page. Updated the same
details in CONTEXT.md.

### 11. No tests for the classification logic ✅

Added Vitest. `frtcon.test.js` covers representative alerts at every level,
the "significant ice" case, Watch vs. Warning wording, regional variants,
picking the most severe alert, and the Frost Advisory change in #13.

### 12. Minor fixes ✅

- **Maskable icon.** Android shrank the icon inside a white shape. I added
  a maskable version with the artwork at 70% scale on a full-bleed
  background, leaving room inside Android's crop circle, and checked it
  against a simulated circular mask.
- **Meta tag.** Added `mobile-web-app-capable` alongside the Apple-specific
  tag, which Chrome now flags as deprecated.
- **Recipe wording.** Step 4 said "pan" where it meant the dish.
- **Cache cleanup.** Expired cache entries piled up in localStorage
  forever, so a cleanup now runs on startup.
- **Request cancellation.** A ZIP lookup created a second AbortController
  and then cancelled its own first one. It now passes its controller
  through. **Verified** that two ZIP searches submitted back to back cancel
  the first one's network request.

---

## Product changes

### 13. Frost Advisory and Freeze Warning moved from FRTCON 3 to 4 ✅

**Why.** Both are mostly agricultural alerts. They're common in spring and
fall, nowhere near real winter weather. In mid-September, a lone Frost
Advisory in northern Minnesota was scoring FRTCON 3, "Moderate impacts
active."

**Change.** Both now score 4, next to Freeze Watch. A more severe alert
still wins: a Frost Advisory with a Winter Weather Advisory still scores 3.
Level 4's "being watched" wording was written for Watches. I decided it
still reads fine next to these alerts, so they don't get their own text.

**Verified** with test alerts and the live Minnesota example, which now
scores 4.

---

## Backports from SOUPCON

[SOUPCON](https://soupcon.org) was forked from this codebase and fixed
several things in the code the two apps share. I compared both codebases
side by side and brought these five back. Its worldwide coverage, which uses
Open-Meteo, wasn't brought back: Open-Meteo has no alerts, so FRTCON would
need a separate forecast-based scale.

### 14. The recipe modal fell back to a serif font ✅

The modal is rendered outside the main page container so it can print on its
own, which meant it never inherited the app's font. **Verified** the font is
correct both on screen and in print.

### 15. Test suite ✅

Added `weatherApi.test.js`, with `fetch` stubbed out. It covers `HttpError`
and timeouts, friendly ZIP and coverage errors, and that alerts are fetched
by point (protecting fix #1).

### 16. Geolocation errors showed the browser's raw text ✅

A user abroad reported a timeout that read "Timeout expired Try entering a
ZIP code instead." That was Chrome's own wording, shown after a 45-second
wait. There's now a plain-language message for each kind of error. The
timeouts are named constants, so the "45 seconds" in the message can't drift
from the actual wait. **Verified** with a stubbed geolocation for each error
code, including that permission-denied doesn't retry.

### 17. `?lat=&lon=` links ✅

Valid coordinates in the URL load that location first and are never saved as
the visitor's own location. While a linked location is on screen, a "Using
Lat/Lon" note appears. **Verified:**

- Invalid or partial values are ignored.
- A location outside the US gets the "isn't covered" message.
- A visitor's saved ZIP isn't overwritten.
- Nothing overflows at phone width.

### 18. Lessons learned in the fork, added to CONTEXT.md ✅

These are the Apache `mod_headers` check, Vite's minimum Node version, and
how to run headless Chrome for testing.

---

## New features

### 19. 48-hour winter outlook chart ✅

**Original plan:** one chart combining snowfall, temperature, and chance of
precipitation. **What changed:**

- **Three stacked charts** on one time axis with a shared hover readout,
  instead of one chart with three y-axes.
- **Snow drawn as blocks per forecast period.** NWS gives snowfall as
  6-hour totals. SOUPCON's approach of repeating each value for every hour
  would have multiplied those totals by six.
- **Ice was added the same way,** since freezing rain drives FRTCON 1–2.

**Built:**

- `winterOutlook.js` turns NWS gridpoint data into 48 hourly points. It's
  pure logic, with no React or DOM.
- The forecast is fetched and cached in `weatherApi.js`.
- `WinterOutlookPanel` is a collapsible panel with totals and a details
  table.
- `WinterOutlookChart` holds three synced uPlot charts. It's lazy-loaded as
  a ~24 KB chunk.

**Verified** with live data for Fairbanks:

- Nothing loads until the panel is opened.
- The totals match NWS's own periods.
- Hovering lines up all three charts.
- Nothing overflows at phone width.

Ice was tested by injecting it into the forecast response.

**Bugs this testing caught:**

- One chart's plot area was 25px narrower than the others, so hover lined
  up with the wrong hours.
- An axis label was clipped.
- An all-zero ice line covered the snow baseline.
- The readout labeled ice with the snow period's times.

### 20. Precipitation type on the chart ✅

The chance-of-precipitation chart is now colored by type: aqua for rain,
blue for snow, orange for sleet and freezing rain, and gray when NWS doesn't
give a type. Every NWS weather type was mapped from api.weather.gov's API
spec. Mixed periods take the most hazardous color, and the readout names
every type, for example "80% chance of freezing rain and sleet." Rain
amounts aren't charted, because NWS's precipitation amount includes all
types melted down. **Verified** with live data and an injected sequence
covering every type.

### 21. Forecast snow or ice can raise an "all clear" to FRTCON 4 ✅

**Report.** Fairbanks showed FRTCON 5 with about an inch of snow forecast,
because the only alert was a Special Weather Statement. The options I
considered are covered in [CONTEXT.md](CONTEXT.md). I went with this rule:
with no winter alert active, 1 inch or more of snow or any ice in the next
48 hours scores 4.

**Details:**

- Snow is compared at the precision it's displayed with (0.1 in), so a
  float sum like 0.1 + 0.8 + 0.1 can't display as "1.0 in" but still score
  5.
- The forecast now loads with every lookup and reuses the existing
  `/points` request. That adds about 60 ms and 10 KB.
- If the forecast fails, scoring falls back to alerts only.

**Verified** with live data: Fairbanks scores 4, Duluth stays at 5, and a
forced forecast failure falls back cleanly. 6 new tests.

### 22. "Check your SOUPCON" link for rain alerts ✅

This mirrors SOUPCON's "Snow soon, check your FRTCON!" link. It appears for
Flood and Flash Flood alerts, checked against NWS's list of alert types, and
not for Coastal or Lakeshore Flood alerts. **Verified** against live flood
alerts in Kansas and Oklahoma, at desktop and phone widths. 13 new tests.

### 23. "Lets make French Toast!" button at FRTCON 1–2 ✅

The button opens the recipe, and focus returns to the button when the recipe
is closed. It's styled cream and amber, so it doesn't look like a second
level badge. **Verified** with injected Blizzard and Winter Storm Warnings,
since nowhere was at FRTCON 1–2 in September. It appears at levels 1–2 and
not at 3 or 5.

### 24. Contact box at the bottom of the page ✅

A card under the "48-hour winter outlook" toggle says "If you like the site,
let me know! If you find a bug, tell me!" with a `mailto:` link to
contact@frtcon.com. It's always shown, so before a lookup it sits under the
lookup card. The link is bold white, because the browser's default link blue
is hard to read on the dark card. **Verified** in headless Chrome against
`vite preview` with a Duluth `?lat=&lon=` link, at desktop and phone widths:
the box comes right after the results and the link points to the address.
Lint, tests and the build pass.

---

## Checked, no change needed

- Handling of requests that overlap or race each other is sound.
- No XSS risk: all NWS text is rendered as plain React text.
- The offline page's inline script isn't blocked by a Content Security
  Policy.
- Keyboard handling for the menu and modals works, apart from #6.
