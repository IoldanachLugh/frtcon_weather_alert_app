# FRTCON — Development Context

This document exists to re-establish context for a new development session
(with Claude or otherwise) without needing to replay prior conversation
history. It covers infrastructure, decisions made and why, known gotchas,
and shelved work — things that aren't visible just from reading the code.
For what the app *does* and how the code is organized, see `README.md`.

## What this project is

FRTCON ("French Toast Conditions") is a personal side project: a static
React/Vite app with no backend, that checks live NWS weather alerts for a
location and classifies them into a 5-level "should I make French toast and
stay home" severity scale. Live at frtcon.com. The owner is primarily a
backend developer using this project to build frontend and AI-assisted
development experience — development has been done largely via Claude,
with the owner directing architecture, reviewing/testing, and owning
infrastructure decisions.

A fork, **SOUPCON** ("Soup Conditions", soupcon.org), was built from this
codebase and deployed separately on the same origin. It grew fixes to the
shared plumbing; the ones that applied here were backported on 2026-09-30
(PLAN.md items 14-18). A local copy of the fork may sit in `soupcon/` for
reference: it's gitignored and excluded from lint and tests, and is not
part of this app.

## Infrastructure summary

- **Domain**: `frtcon.com`, registered at **Namecheap** (migrated from
  Squarespace registration).
- **DNS**: The `frtcon.com` zone is hosted on **Cloudflare** (free plan).
  Nameservers point to Cloudflare.
- **Traffic routing**: A **Cloudflare Tunnel** named `home-server`
  (tunnel ID begins `dd742d1d-...`) connects the origin server to
  Cloudflare's edge — no public IP is exposed, no port forwarding, no
  dynamic-DNS/ddclient setup was ultimately needed (a tunnel makes that
  moot, since it's an outbound-only connection regardless of the origin's
  IP). Ingress rules (in `config.yml` on the origin server, **not**
  dashboard-managed) route `frtcon.com` and `www.frtcon.com` to Apache on
  `localhost:443`.
- **Origin server**: hostname `elephant`, primary user `frtcon`.
  `cloudflared` runs as its own dedicated system user (`cloudflared`), not
  as `frtcon` — CLI management commands (`cloudflared tunnel list`,
  `route dns`, etc.) must be run as `sudo -u cloudflared cloudflared ...`
  to see the right tunnel/auth context.
- **Web server**: Apache2. Site config lives at
  `/etc/apache2/sites-available/frtcon.conf`, serving from
  `/home/frtcon/public_html`. A **dev instance** exists at
  `public_html/dev` — this is the first place changes get reviewed before
  going to production, not a separate server or deployment target.
- **TLS**: **certbot**, installed via **snap** (not apt — do not have both
  installed simultaneously, they conflict and produce confusing
  "unrecognized arguments" errors). Uses the `certbot-dns-cloudflare`
  plugin (also a separate snap, connected via
  `snap connect certbot:plugin certbot-dns-cloudflare`) for DNS-01
  validation. The certificate covers `frtcon.com` and `www.frtcon.com` as
  SANs. Credentials live in `/etc/letsencrypt/cloudflare.ini`
  (permissions `600`, root-only) — contains a Cloudflare API token scoped
  to `Zone.DNS:Edit` on the `frtcon.com` zone. To add a new hostname to
  the cert later: re-run certbot with the full desired name list,
  `--expand`.

## Frontend architecture & conventions

- React + Vite, **no backend**, no build-time secrets.
- Code is split into modules (see README for the tree):
  `App.jsx` (orchestration only), `lib/` (pure logic + network calls),
  `data/` (static content), `components/`.
- **Styling**: plain CSS in `src/styles.css`, semantic kebab-case class
  names (e.g. `.frtcon-condition-status` for the condition box,
  `.frtcon-badge--level-N` modifier classes for severity colors). No
  CSS-in-JS, no inline `style={}` except for genuinely per-instance
  dynamic values (e.g. each snowflake's randomized position/timing in
  `SnowOverlay.jsx`).
- `lib/frtcon.js` (`classifyAlert`, `determineFrtcon`) is pure — no
  React/DOM dependency — and is covered by `src/lib/frtcon.test.js`
  (`vitest`, `npm run test`); the API layer has `weatherApi.test.js` with
  `fetch` stubbed.
- PWA support exists: `manifest.json`, a no-cache/network-first `sw.js`
  (deliberate — this app shows live alert data, so caching would be
  actively misleading, not just stale), and install-flow UI in the
  hamburger menu (Android gets a real install button via
  `beforeinstallprompt`; iOS gets manual "Add to Home Screen"
  instructions, since no programmatic install API exists on iOS/WebKit,
  ever, at any effort level). The service worker registers at a path
  relative to `import.meta.env.BASE_URL` (so it works whether the build
  is in `public_html/dev` or promoted to the root), but `manifest.json`'s
  `start_url` and `scope` are deliberately left hardcoded to `"/"` — a
  JSON file has no build-time templating, so making those environment-
  aware isn't worth it for a review-only instance. Practical effect:
  install/PWA behavior can't be meaningfully tested from `/dev/`, only
  from production. `sw.js` also catches a failed page navigation (a bare
  `fetch()` failure, notably during Android cold-start before the OS has
  finished bringing the network stack back up) and serves a small
  self-contained "Reconnecting…" page instead of falling through to
  Chrome's own blank-looking offline interstitial — that page retries
  with capped backoff, then gives up with a manual Retry button rather
  than spinning forever on a real outage/airplane-mode; see `public/sw.js`
  for the retry/give-up logic.
- Active alerts are fetched by point (`/alerts/active?point={lat},{lon}`),
  not by forecast zone (`/alerts/active/zone/{zoneId}`) — the zone
  endpoint silently omits alerts issued by county or storm polygon (UGC
  `xxCnnn`) rather than by forecast zone (UGC `xxZnnn`), which includes
  some winter alert types the FRTCON scale relies on (e.g. Snow Squall
  Warning). Confirmed against live NWS data during a 2026-09-14 review:
  several currently-active county/polygon-coded alerts were present via
  `?point=` and absent from the zone endpoint for the same coordinates.
  `getZoneByPoint` (`/points/` → `/zones/forecast/{zoneId}`) is still
  used, just only for the human-readable zone name shown in the UI, not
  for filtering which alerts are shown.
- The app auto-resumes a returning visitor's last-used lookup method
  (browser geolocation vs. ZIP) on load, tracked via a
  `frtcon_last_source` localStorage key — but that key (and
  `frtcon_last_zip`) is only written once a lookup actually succeeds, and
  the silent auto-resume is skipped entirely if
  `navigator.permissions` reports geolocation as `denied`. (Earlier this
  persisted before the lookup even ran, so a denied permission or a
  nonexistent ZIP got "remembered" as the preferred method and silently
  re-failed on every later visit — a manual click of "Use Browser
  Location" is unaffected either way.)
- **`?lat=&lon=` URL parameters** (PLAN.md #17, ported from soupcon):
  parsed once at module load in `App.jsx` (`readUrlLocation`); both must be
  numeric and in range or they're ignored. A valid pair wins over the
  remembered lookup on load (source `"url"`), is never written to
  `frtcon_last_source`/`frtcon_last_zip` (a shared link shouldn't replace a
  visitor's own remembered method), and shows "Using Lat: .. Lon: .." beside
  Search ZIP while it's the location on screen. Coordinates outside NWS
  coverage get the normal "isn't covered" error. This is the input half of
  the shelved server-rendered share previews idea.
- **48-hour winter outlook** (PLAN.md #19; `WinterOutlookPanel`,
  `WinterOutlookChart`, `lib/winterOutlook.js`, `getWinterOutlook`). Its
  48-hour snow/ice totals also feed one scoring rule (PLAN.md #21, below);
  otherwise it's display only. Design calls:
  - **Three small charts, not one.** Snow/ice (in), temperature (°F) and
    chance of precipitation (%) have different units; a dual-axis chart was
    ruled out. They share x padding and y-axis width so one hour sits at
    the same x in each (without equal padding uPlot narrowed only the
    bottom chart, to fit its last time label, and hover lined up with
    different hours), and sync their cursors into one text readout above
    them (no uPlot legends).
  - **Snow/ice are period totals, not hourly.** NWS gridpoint
    `snowfallAmount`/`iceAccumulation` are totals per interval (6 h,
    checked live), so repeating them per hour (right for temperature and
    chance of precipitation) would multiply them, and splitting them into
    hours would invent timing NWS doesn't give. Each hour carries its
    period's total, drawn as a stepped block across the period. The
    48-hour total counts a period that started before the current hour in
    full. Ice keeps its own period range in the readout, since snow and ice
    periods needn't line up.
  - **Fetching:** `/points` → `forecastGridData`, with every lookup and
    refresh (since #21), in `App.jsx`; the panel only displays it.
    `getZoneByPoint` caches the grid URL from its own `/points` response,
    and the outlook request waits for it, so there's still one `/points`
    request per lookup. Only the five layers are cached (`weather` trimmed to
    type/coverage/intensity; entries cached before it existed are
    refetched): `frtcon_grid_url_` 1 h,
    `frtcon_outlook_` 30 min, both swept. The full response is ~175 KB
    (~10 KB gzipped, ~60 ms when checked). Refetched with the main 5-minute
    refresh (usually a cache hit); a failed refresh keeps the last good
    outlook, and a failed first load leaves scoring alert-only and the
    panel showing the error, without failing the lookup. Units are converted from NWS's `wmoUnit:degC`/`mm`.
  - **Precipitation type** (PLAN.md #20): the chance-of-precipitation
    blocks are colored by NWS's gridpoint `weather` layer. Its type enum
    (from api.weather.gov's OpenAPI spec) maps to ice (freezing rain,
    freezing drizzle, sleet), snow (snow, snow showers) or rain (rain, rain
    showers, drizzle, thunderstorms, hail). Non-precipitation types (fog,
    frost, blowing snow...) are ignored. A mixed period takes the most
    hazardous color, in FRTCON order (ice > snow > rain), rather than a
    fourth "mix" color; the readout lists every type. Hours with a chance
    but no type are gray. Rain has no amount chart: NWS's
    `quantitativePrecipitation` is liquid-equivalent for all types, not a
    rain amount. Each type is its own uPlot series, and
    `precipChanceByCategory` adds a closing point after each run so stepped
    blocks meet with no gap (except where a type resumes after a single
    hour, where closing would join the runs across it).
  - **Colors:** dataviz reference palette dark slots 1-3, validated against
    the card surface `#122b4d` with all pairs checked (types can sit next
    to each other in any order): blue `#3987e5` = snow (and the temperature
    line), orange `#d95926` = ice (legend "Sleet", also covering freezing
    rain/drizzle), aqua `#199e70` =
    rain. Gray `#7d8ca3` (4.2:1) = "Unspecified" (a chance of
    precipitation with no type given). The meanings are the same
    in both charts. With no ice forecast, the ice amount series is hidden
    (otherwise an orange line covers the zero baseline) and its legend says
    "Ice (none forecast)".
- **Forecast snow/ice can lift FRTCON 5 to 4** (PLAN.md #21, owner's
  decision 2026-09-30, after Fairbanks showed FRTCON 5 with an inch of snow
  forecast and only a Special Weather Statement active). In
  `determineFrtcon(alerts, forecast)`: with no *winter* alert active (none,
  or only unrelated ones), >= 1.0 in of snow (compared at its displayed
  0.1 in precision, `FORECAST_SNOW_MIN_IN`) or any ice (> 0 at 0.01 in) in
  the outlook's 48-hour totals makes it level 4 (`forecastDriven: true`,
  its own title/reason, "Forecast driving the score" in the UI; the level-4
  commentary lines are shared). Deliberately capped at 4 and never applied
  when any winter alert is active: alerts are calibrated by NWS to local
  norms, a raw inch count isn't. Options considered and not taken: keeping
  5 with different wording, and reading Special Weather Statements' free
  text for snow (the classifier deliberately avoids free-text matching).
  Known effect: the 48-hour total counts a period already under way in
  full, so the 4 can linger until that period ends.
- **Browser-geolocation lookup:** a low-accuracy try (15 s, accepts a fix
  up to 10 min old), then, for any failure except permission-denied, one
  high-accuracy retry (30 s). Timeouts are the constants in
  `src/lib/geolocationError.js`, which also writes the plain-language
  error per error code (never the browser's own text, e.g. Chrome's bare
  "Timeout expired"), and quotes the 45 s total from those constants.

- **Facebook Share button** (`handleShare` in `App.jsx`). Facebook's
  `sharer.php` accepts only a URL, so the button copies the text to the
  clipboard and opens `sharer.php?u=https://frtcon.com` in a new tab; the
  user pastes. Decisions: (1) the copied text is exactly what the
  `.frtcon-condition-status` box shows (headline, title, the same random
  commentary lines) -- so the random line selection lives in `App.jsx`
  (`frtconMessage`), not inside `FrtconMessage`, so share and display can't
  diverge; footnote omitted. (2) No URL in the copied text -- the link card
  already carries it. (3) Clipboard write runs *before* `window.open()`:
  opening the tab first shifted focus and made Chrome show a "wants to see
  text and images copied to the clipboard" permission prompt. (4) Toast
  after, not a confirm dialog before -- user's choice, to avoid an extra
  click. (5) Plain text only: no way to bold the headline on Facebook
  (Unicode-bold trick was offered and declined). The "f" icon is a
  hand-built SVG, not Meta's official brand asset.

## Agent readiness (added 2026-09-25, after a Cloudflare agent-readiness scan)

The scan flagged: no robots.txt, sitemap, Link headers, AI-discovery DNS,
markdown negotiation, AI crawler rules, or content signals. Addressed in
`public/` (ships with `dist/`):

- `robots.txt` -- `Content-Signal: search=yes, ai-input=yes, ai-train=no`,
  explicit `Disallow` for known training crawlers (GPTBot, ClaudeBot, CCBot,
  Google-Extended, Bytespider, Applebot-Extended, meta-externalagent), and a
  `Sitemap:` line. The ai-train=no stance is the owner's policy call; flip
  it there if that changes.
- `sitemap.xml` -- just `/` (single-page app).
- `index.md` + `.htaccess` -- `Accept: text/markdown` on `/` rewrites to
  `index.md` (mod_rewrite), with `Vary: Accept`; `Link` headers advertise
  the sitemap and the markdown alternate. `.htaccess` works because the
  vhost has `AllowOverride All`; every block is `<IfModule>`-guarded. Tested
  against a scratch Apache with curl. There's deliberately no `api-catalog`
  Link: the app has no API of its own.
- **Not done (outside the repo):** AI-discovery DNS records live in the
  Cloudflare zone, and Cloudflare's own "Markdown for Agents"/managed
  robots.txt/AI-crawler toggles are dashboard settings. If Cloudflare's
  managed robots.txt is ever enabled it may prepend/override the file above.
  (Checked 2026-09-30: the live frtcon.com `robots.txt` is this file as
  written, so it's off for this zone. It *is* on for soupcon.org's zone.)

## Known gotchas (things that already bit us once)

- **`mod_headers` was not enabled on this origin's Apache**, which
  silently disabled `.htaccess`'s `Link` headers for frtcon.com (the rules
  are `<IfModule>`-wrapped, so no error, just no header). Found during the
  soupcon.org rollout on the same Apache and fixed there with `a2enmod
  headers` + reload; confirmed live 2026-09-30 that frtcon.com now sends
  its `Link` header. If the origin is ever rebuilt, check `mod_headers`,
  `rewrite` and `mime` are on, and check with `curl -I` against the live
  site -- `.htaccess` reading correctly proves nothing.
- **Vite 8 (so `npm run dev`/`build`/`test`) needs Node `^20.19.0 ||
  >=22.12.0`.** Older Node fails in `vite build`/`vitest`, and `npm install`
  under npm 9 (Node 18) can silently skip a platform-specific optional
  binding (e.g. `@rolldown/binding-linux-x64-gnu`, npm/cli#4828), leaving
  `node_modules` broken until reinstalled. This host has nvm with a default
  that satisfies this (`nvm current`).
- **Browser testing without Claude in Chrome.** The system Chromium is a
  snap and won't start from a non-snap shell ("not a snap cgroup").
  Instead: `npx @puppeteer/browsers install chrome-headless-shell@stable
  --path <scratch>`, launch it with `--no-sandbox` (AppArmor blocks
  Chrome's user-namespace sandbox here) via `puppeteer-core`, and drive it
  against `vite preview` of the production build. `?lat=&lon=` URLs load a
  location directly; a stubbed `navigator.geolocation` (via
  `evaluateOnNewDocument`) exercises the geolocation error paths. The app's
  geolocation accepts a 10-minute-old fix, so changing the emulated
  position mid-session may still return the old one.

- **Never set a custom `User-Agent` header on `fetch()` calls to
  api.weather.gov.** Chrome/Firefox silently ignore it, but Safari
  (all iOS browsers, since iOS mandates WebKit) sends it as a real
  header, which fails NWS's CORS preflight and breaks every request
  specifically on iPhone. This was already added once, caused exactly
  this bug, and was removed — don't re-add it without a server-side
  proxy to hold it instead.
- **Static file permissions must be world-readable (644, correct
  owner:group matching the rest of the deployed site) or Apache silently
  fails to serve them.** This specifically broke the PWA manifest/service
  worker/icons once (root-owned 600 files) with no visible error — Chrome
  just never fired `beforeinstallprompt`, with nothing to indicate why.
- **Don't install certbot via both snap and apt simultaneously** — the
  DNS plugin snap only registers with the snap `certbot` binary; a
  coexisting apt install causes "unrecognized arguments" errors that look
  like a plugin problem but are actually a PATH/installation conflict.
- **`cloudflared tunnel login`'s resulting `cert.pem` is scoped to a
  single zone**, chosen at authorization time. Running
  `cloudflared tunnel route dns` for a hostname in a zone that wasn't
  authorized doesn't error clearly — it silently creates a garbage
  record by concatenating the hostname onto whichever zone it does have
  access to, rather than the intended one. If another domain/zone is ever
  added to this account or tunnel, re-run `tunnel login` and explicitly
  authorize the additional zone before routing hostnames in it.
- A one-off layout report (iOS: right-side margin missing) turned out to
  be a **caching artifact**, not a real CSS bug — confirmed via incognito
  testing. Worth ruling out caching first for any "looks different on a
  specific device" report before assuming it's a real rendering issue.
- **Service workers update lazily, not on next deploy.** Shipping a new
  `sw.js` doesn't mean a device picks it up the next time the app opens —
  the *old* SW instance is still active and controlling the page. The
  update cycle is: new SW installs in the background on the next visit →
  `skipWaiting()`/`clients.claim()` force it to take over on that load →
  but in practice this can mean the app needs to be fully closed and
  reopened **twice** after a `sw.js` deploy before the new one is actually
  active. To force it immediately for testing, uninstall and reinstall the
  PWA rather than assuming one relaunch is enough to confirm a fix (or a
  regression) in service-worker behavior specifically.

## Deliberately decided against (don't re-litigate without new info)

- **Dropping the high-accuracy geolocation retry** (to report a failing
  lookup after 15 s instead of 45 s): tried and reverted in the soupcon
  fork -- low accuracy doesn't always work, and the retry is what catches
  those cases. Same code here.

- **Cloudflare Bot Fight Mode**: left off. No login/payment/auth surface
  on FRTCON itself for it to meaningfully protect, and the Free-tier
  version has no exception/allowlist mechanism, with a known false-positive
  track record.
- **Native app / App Store distribution**: considered and rejected as
  disproportionate. The PWA install flow (manifest + service worker) gets
  most of the practical benefit without App Store review/cost/maintenance.
- **Dynamic per-state home-screen icon** (different icon graphic per
  FRTCON level, auto-refreshing): confirmed **not possible** on the web
  platform at all, on either OS, at any level of engineering effort — no
  API lets a web app swap its own installed icon post-install. The
  Badging API (`navigator.setAppBadge`) is the closest real capability
  (a small number/dot overlay, not a full icon swap) if revisited.

## Shelved for later (not started, but scoped)

- **Web Share API on mobile** (native share sheet carrying condition text +
  link). The Facebook Share button itself is built (see below); this
  mobile variant is not.
- **Server-rendered share previews.** Agreed shape: accept ZIP or
  coordinates as URL parameters, server-render the initial page using
  those inputs, and set Open Graph meta tags to match the resulting
  condition — so a shared link's preview (and the link itself) reflects
  a specific real location, and doubles as a genuinely useful "check this
  location" link for whoever receives it. Requires moving off a purely
  static/client-rendered model — this is the prerequisite for both this
  and the next item.
- **Push notifications** for badge/condition updates while the app isn't
  open (not just on open). Requires a small backend that polls NWS on a
  schedule and pushes updates to subscribed clients.
- **Affiliate integration** (Walmart and/or Amazon) for winter-gear /
  French-toast-adjacent products. Walmart's affiliate program was applied
  for; requires no business entity (individual + SSN/W-9 is sufficient).
  Walmart's "Recipes and Bundle API" is a good fit given it can map an
  ingredient list (the recipe already on-site) to purchasable products.
  Any product-API-based approach (Walmart or Amazon PA-API) requires a
  server-side credential proxy — the API keys involved cannot be exposed
  client-side the way an AdSense publisher ID or Google Analytics ID can.
  Google AdSense itself was also discussed as a simpler, contextual-only
  (not manually curated) alternative if a full product-API integration
  ends up being more than it's worth.

All three shelved items converge on the same prerequisite: introducing a
real backend/server-rendering layer. Worth treating as one combined
migration rather than three separate ones when the time comes.
