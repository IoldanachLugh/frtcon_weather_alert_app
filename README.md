# FRTCON — French Toast Conditions

A small weather app that checks live National Weather Service alerts for your
location and translates them into a **French Toast Condition (FRTCON)** level
— a tongue-in-cheek severity scale for "should I make French toast and stay
home today?"

Live at [frtcon.com](https://frtcon.com).

## What it does

- Looks up active NWS winter weather alerts for your location, either via
  browser geolocation or a manually entered ZIP code.
- Classifies the most severe active alert into a 5-level FRTCON scale (see
  below), with a randomized bit of commentary per level. With no winter
  alert, 1 inch or more of forecast snow (or any ice) in the next 48 hours
  makes it FRTCON 4 rather than 5.
- Remembers whichever method (location or ZIP) you used last, and
  automatically re-runs it on your next visit — no need to click a button
  again.
- Accepts optional `lat` and `lon` URL parameters (e.g.
  `https://frtcon.com/?lat=46.7867&lon=-92.1005`) to load a specific
  location on page load. Both are required and must be in range, otherwise
  they're ignored. They take priority over the remembered lookup method,
  and a URL-driven lookup is not saved as the "last used" method.
- If browser location fails, explains why in plain language (timed out,
  position unavailable, or permission denied) rather than showing the
  browser's own terse error text.
- Lists every raw active NWS alert covering your location, not just the one
  driving the FRTCON score.
- Has a collapsible "48-hour winter outlook" under the alerts: the next 48
  hours of NWS's gridpoint forecast as three small charts sharing one time
  axis and one hover readout -- snow and ice (NWS's total per forecast
  period, usually 6 hours, drawn as blocks spanning that period),
  temperature (°F, with a 32°F freezing line), and chance of precipitation
  colored by the type NWS expects (rain, snow, or sleet -- which also covers
  freezing rain and freezing drizzle; a
  mix takes the most hazardous, and the hover readout names every type)
  -- plus the 48-hour snow/ice totals and a collapsed "Details" table view.
  The forecast is loaded with every lookup (its totals feed the 5-vs-4
  rule above); the chart is drawn with
  [uPlot](https://github.com/leeoniya/uPlot), downloaded as a separate
  ~24 KB (gzipped) chunk only when the panel is opened.
- Has a printable recipe modal (Jeff's French Toast recipe) that prints
  cleanly on its own, independent of the rest of the page.
- Has a "Share" button (Facebook-blue, next to the alert count) that copies
  the on-screen FRTCON condition text to the clipboard and opens Facebook's
  share dialog in a new tab, so the user pastes the text into their post.
  Facebook's `sharer.php` only accepts a URL (no custom text), which is why
  the text goes via clipboard; the link card comes from the `u` param.
- Installable as a home-screen app on Android (via the in-app "Install App"
  menu item) and iOS (via a guided "Add to Home Screen" flow, since iOS has
  no programmatic install API).

### The FRTCON scale

| Level | Meaning | Example triggering NWS alerts |
|---|---|---|
| **1** | Severe — stay inside, this is not a drill | Blizzard Warning, Ice Storm Warning, Heavy Freezing Spray Warning, Winter Storm Warning w/ significant ice |
| **2** | Major weather warning active | Winter Storm Warning, Lake Effect Snow Warning, Snow Squall Warning, Freezing Rain Warning, Extreme Cold Warning |
| **3** | Moderate impacts active | Winter Weather Advisory, Freezing Fog/Rain Advisory, Snow/Blowing Snow Advisory, Cold Weather Advisory |
| **4** | Being watched, no major impacts yet | Winter Storm/Blizzard/Lake Effect Snow/Ice Storm/Extreme Cold/Freeze Watch, Heavy Freezing Spray Watch, Frost Advisory, Freeze Warning — **or** no winter alert, but ≥1 in of snow or any ice forecast in the next 48 hours |
| **5** | All clear | No winter alerts (none at all, or only unrelated ones) and less than 1 in of snow and no ice forecast |

Classification is done via keyword matching against each alert's `event`
field (see `src/lib/frtcon.js`) — NWS draws `event` from a fixed, published
list of alert-type strings rather than free text, so this is closer to
matching a canonical code than parsing prose. The one exception: whether a
Winter Storm Warning specifically involves "significant ice" isn't a
distinct event type, so that one case also checks the alert's free-text
`description`. This is still not NWS's structured VTEC codes, so it's
possible for an unusual event string to be missed. When multiple winter
alerts are active at once, the **most severe** (lowest-numbered) level
wins, but every matching alert is listed under "Winter alerts driving the
score."

**The one forecast-based rule.** Alerts alone would leave a place at
FRTCON 5 ("all clear") with snow on the way whenever the amount is too
routine locally for NWS to issue an advisory -- e.g. an inch in Fairbanks,
where NWS put out only a Special Weather Statement. So when no winter alert
is active and NWS's gridpoint forecast totals **1 inch or more of snow, or
any ice accumulation, in the next 48 hours**, the level is 4 instead of 5,
shown as "Forecast driving the score". The forecast never raises anything
above 4 and never overrides an alert: levels 1-3 still come only from
alerts, which NWS calibrates to what's normal in each area (the same inch
in Atlanta usually does get an advisory, so it scores 3 there). If the
forecast fails to load, scoring falls back to alerts only. See
`determineFrtcon` in `src/lib/frtcon.js`.

## Tech stack

- React + Vite
- Plain CSS (no CSS-in-JS, no Tailwind) — see `src/styles.css`
- `vitest` for the classification logic's and API layer's test suites
- No backend — this is a fully static, client-side app. All data comes
  directly from public APIs, called from the browser.
- No build-time API keys or secrets of any kind are required.

## Project structure

```
src/
  App.jsx                   — top-level state + orchestration
  styles.css                — all styling, semantically class-named
  lib/
    weatherApi.js            — fetch/network layer (NWS + ZIP lookup APIs)
    weatherApi.test.js       — vitest suite for the API layer's errors
                                and request shape (fetch stubbed)
    cache.js                 — localStorage caching helpers (TTL-based)
    frtcon.js                — pure classification logic (classifyAlert,
                                determineFrtcon) — no React/DOM dependency,
                                covered by frtcon.test.js
    frtcon.test.js           — vitest suite for the above
    geolocationError.js      — plain-language browser-geolocation errors and
                                the lookup timeouts (+ geolocationError.test.js)
    winterOutlook.js         — turns NWS gridpoint layers into the outlook
                                chart's data (+ winterOutlook.test.js)
  data/
    alertMessages.js          — the FRTCON 1–5 headline/title/commentary content
    recipe.js                 — Jeff's French Toast recipe content
  hooks/
    useModalBehavior.js       — shared modal a11y: focus trap, focus
                                restore, body scroll lock, Escape-to-close
  components/
    SnowOverlay.jsx
    FrtconBadge.jsx
    FrtconMessage.jsx          — the condition status box
    AlertCard.jsx
    WinterOutlookPanel.jsx     — the collapsible 48-hour winter outlook
    WinterOutlookChart.jsx     — its three synced uPlot charts (lazy-loaded)
    RecipeModal.jsx
    IOSInstallHelp.jsx
```

## Getting started

```
npm install
npm run dev       # local dev server
npm run build      # production build, outputs to dist/
npm run test       # run the test suites once
```

Vite 8 needs Node `^20.19.0 || >=22.12.0` (see CONTEXT.md).

## Deployment notes

This app is served as static files (currently via Apache, behind a
Cloudflare Tunnel). A few things beyond the built `dist/` output need to be
in place for full functionality:

- **PWA install support** relies on `manifest.json`, `sw.js`, `icon-192.png`,
  `icon-512.png`, and `icon-512-maskable.png` living in `public/` (so Vite
  includes them in the build) and landing at the site root, plus these tags
  already present in `index.html`'s `<head>` — listed here so anyone
  rebuilding `index.html` from scratch knows they're required, not because
  they're currently missing:

  ```html
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#0b1f3a" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  ```

  `icon-512-maskable.png` is a separate asset from `icon-512.png`, not a
  duplicate reference to it: Android applies its own shape mask (circle,
  squircle, etc.) to a `purpose: "maskable"` icon, so it needs the artwork
  pre-shrunk into the center safe zone with a full-bleed background —
  unlike `icon-192.png`/`icon-512.png` (`purpose: "any"`), which have
  transparent corners around a rounded-square icon and are meant to be
  shown as-is.

  The service worker is intentionally minimal — it does not cache anything
  and always defers to the network. This is deliberate: FRTCON shows live
  alert data, so serving a stale cached response (even briefly, even
  offline) would be actively misleading rather than just inconvenient. Its
  main job is satisfying Chrome's installability requirement (a registered
  service worker with a fetch handler); it also catches a failed page
  navigation (e.g. the network genuinely not being ready yet during an
  Android cold start) and serves a small self-contained "Reconnecting…"
  page that retries with backoff and then gives up with a manual Retry
  button, rather than spinning forever or falling through to Chrome's own
  blank-looking offline interstitial — see `public/sw.js` for the
  retry/give-up logic.

- **Crawler/agent files** in `public/`: `robots.txt` (content signals + AI
  crawler rules), `sitemap.xml`, `index.md` (served for `Accept:
  text/markdown` on `/`), and `.htaccess` (that rewrite plus `Link`
  headers; requires Apache `mod_rewrite`/`mod_headers` and `AllowOverride
  All`). Note `.htaccess` is a dotfile — copy `dist/` with something that
  includes hidden files (e.g. `cp -a dist/. target/`, not `dist/*`).

- **File permissions matter.** Static assets need to be world-readable by
  whatever user your web server runs as (e.g. `www-data`) — files left at
  owner-only permissions will fail to serve with no obvious error, which
  will silently break the PWA install flow specifically (Chrome just never
  fires its install-eligibility event, with nothing logged to explain why).

## APIs used

- **[api.weather.gov](https://www.weather.gov/documentation/services-web-api)**
  (National Weather Service) — zone lookup and active alerts, plus (only
  while the winter outlook panel is open) the raw gridpoint forecast's
  temperature, chance of precipitation, expected precipitation type
  (`weather`), snowfall and ice accumulation. No
  API key required.
- **[api.zippopotam.us](https://www.zippopotam.us/)** — ZIP code → lat/lon
  lookup, used as an alternative to browser geolocation. No API key
  required.

Note: NWS's API documentation asks server-side consumers to identify
themselves via a `User-Agent` header. This is intentionally **not** set on
requests from this app — browsers won't let client-side JS set a real
custom `User-Agent` (Chrome/Firefox silently ignore it; Safari sends it as
a genuine custom header, which then fails CORS preflight since NWS doesn't
allow it in `Access-Control-Allow-Headers`, breaking every request
specifically on iOS). If a server-side proxy is ever introduced, that would
be the right place to add proper NWS attribution.

## Known limitations

- No offline support, by design (see service worker note above).
- The "Install App" button only appears on Android/Chrome once Chrome
  decides the app is install-eligible (includes an engagement heuristic —
  it won't appear instantly on first load even after deploying this).
- On iOS, there is no way to trigger installation programmatically at
  all — the in-app menu instead shows manual "Add to Home Screen" steps.

## Ideas for later (not yet built)

- **Worldwide lookups** (soupcon uses Open-Meteo outside the US): the
  plumbing would port, but Open-Meteo has no alerts, so non-US FRTCON would
  need a second, forecast-based scale. Also note Open-Meteo's free tier is
  non-commercial, which conflicts with the affiliate idea below.
- **Web Share API on mobile**: the Facebook Share button (see "What it
  does") covers the desktop-style flow; a native share sheet on mobile
  (carrying the condition text + a link directly) is not built.
- **Server-rendered share previews**: accept ZIP/coordinates as URL
  parameters, render the initial page server-side with those inputs, and
  set Open Graph meta tags to match — so a shared link shows an accurate,
  personalized condition preview instead of a generic one. Requires moving
  off a purely static/client-side model.
- **Push notifications**: update a home-screen badge automatically on a
  schedule (not just on app open), which requires a small backend to poll
  NWS and push updates.
- **Affiliate integration**: Walmart/Amazon product links for winter
  gear or French-toast-adjacent groceries, potentially using Walmart's
  Recipes API against the actual recipe ingredient list. Requires a
  server-side credential proxy either way.
