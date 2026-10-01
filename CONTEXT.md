# FRTCON — Design Notes

> Shared for portfolio & demonstration purposes. All rights reserved.

This is the background you can't get from reading the code: how the site is
hosted, why things were built the way they were, problems that have already
been hit once, and ideas considered but not built. For what the app does and
how the code is laid out, see the [README](README.md).

## Background

FRTCON ("French Toast Conditions") is a static React/Vite app with no
backend. It checks live National Weather Service (NWS) alerts for a location
and rates them on a 5-level "should I make French toast and stay home"
scale.

**SOUPCON** ("Soup Conditions", [soupcon.org](https://soupcon.org)) is a
fork of this codebase focused on rain, deployed separately. Fixes it made to
the shared code were brought back here (see items 14–18 in
[PLAN.md](PLAN.md)). If a local copy of the fork sits in `soupcon/` for
reference, it's ignored by git, lint, and tests.

## Hosting

- **Domain and DNS.** `frtcon.com` is registered at Namecheap, with DNS
  hosted on Cloudflare's free plan.
- **Cloudflare Tunnel.** The origin is a home server reached through a
  Cloudflare Tunnel, so no public IP or open ports are exposed, and no
  dynamic DNS is needed. The tunnel's ingress rules are kept in a config file
  on the server rather than managed in the dashboard.
- **Web server.** Apache serves the built files. New builds go to a `/dev/`
  subdirectory first for review, then get promoted to the site root.
- **TLS.** certbot with the Cloudflare DNS plugin (DNS-01 validation), using
  an API token limited to editing DNS on this one zone. The certificate
  covers `frtcon.com` and `www.frtcon.com`.

## Frontend conventions

- `App.jsx` handles orchestration. `lib/` holds the pure logic and network
  calls, `data/` holds static content, and `components/` holds the UI.
- **Styling** is plain CSS in `src/styles.css` with semantic kebab-case
  classes (`.frtcon-condition-status`, `.frtcon-badge--level-N`). Inline
  styles are used only for values that differ per element, such as each
  snowflake's random position.
- **Testing.** `lib/frtcon.js` has no React or DOM dependency, so it's easy
  to unit test. The API layer is tested with `fetch` stubbed out.

## Design decisions

### Alerts are looked up by point, not by zone

The app calls `/alerts/active?point={lat},{lon}`, not
`/alerts/active/zone/{zoneId}`. The zone endpoint quietly leaves out alerts
issued by county or storm polygon, and Snow Squall Warnings (FRTCON 2) are
issued that way. A live comparison confirmed the zone query missed alerts
that the point query found. The zone lookup is still made, but only to show
the area's name.

### The service worker never caches

FRTCON shows live alert data, so showing a cached copy, even briefly, would
be misleading rather than just stale. The service worker exists because
Chrome won't offer to install an app without one. It also catches failed
page loads (common during an Android cold start, before the network is up)
and shows a small "Reconnecting…" page. That page retries a few times with
growing delays, then stops and offers a Retry button instead of spinning
forever.

The service worker's path is relative to the build's base URL, so it works
from `/dev/`. `manifest.json` hardcodes `/` as the app's start URL and scope,
though, so installing the app can only really be tested in production.

### Remembering the last lookup

A returning visitor's last lookup method (geolocation or ZIP) runs again
automatically. It's saved only after a lookup succeeds. An earlier version
saved it before the lookup ran, so a denied permission or a bad ZIP got
remembered and failed again on every visit. The automatic geolocation
lookup is also skipped if the browser reports location permission as
denied.

### `?lat=&lon=` links

A link with valid coordinates loads that location first and is never saved
as the visitor's own location, so opening a link someone shared doesn't
replace your saved location. This is also the first step toward
server-rendered share previews (see Ideas for later).

### The 48-hour winter outlook

- **Three small charts instead of one.** Snow and ice, temperature, and
  chance of precipitation have different units, and a chart with several
  y-axes is hard to read. The three charts use the same padding and axis
  width, so a given hour lines up across all of them, and they share one
  text readout.
- **Snow and ice are shown as totals per forecast period.** NWS gives these
  as totals over (usually) 6-hour periods. Repeating each total for every
  hour would multiply it, and splitting it into hourly amounts would invent
  timing NWS doesn't provide. So each period is drawn as one block at its
  total.
- **Precipitation type** comes from NWS's gridpoint `weather` layer, grouped
  into ice, snow, or rain. When a period has a mix, it's colored by the most
  hazardous type (ice, then snow, then rain), and the readout lists every
  type. Rain amounts aren't charted, because NWS's precipitation amount
  includes all types melted down, not rain alone.
- **Fetching.** The forecast is loaded with every lookup, since it feeds
  the scoring rule below. It reuses the `/points` response the zone lookup
  already made, and it's cached for 30 minutes. If it fails, the score falls
  back to alerts only and the lookup still succeeds.
- **Colors** come from a dataviz palette and were checked for contrast
  against the card background and against each other.

### Forecast snow can raise "all clear" to FRTCON 4

Fairbanks once showed FRTCON 5 with an inch of snow forecast. The only alert
was a Special Weather Statement, which FRTCON ignores, because an inch is too
routine there for an advisory. The options considered:

1. Let forecast snow or ice move a 5 up to a 4.
2. Keep the 5 but change the wording.
3. Read the text of Special Weather Statements to look for snow.

Option 1 was chosen, with a 1-inch snow threshold, and any ice counts. The
rule can't raise the level above 4 and never applies while a winter alert is
active, because NWS already tunes its alerts to local norms and a raw
snowfall number isn't. Option 3 was rejected because the classifier
deliberately avoids matching on free text.

One side effect is accepted: a forecast period already under way counts in
full, so a forecast-driven 4 can last until that period ends.

### Smaller UI decisions

- **Share button.** Facebook's share link only accepts a URL, so the button
  copies the on-screen condition text to the clipboard first, then opens
  Facebook. The copy has to happen first, because opening the new tab first
  made Chrome ask for clipboard permission. The random commentary is picked
  once in `App.jsx`, so the shared text always matches what's on screen.
- **"Lets make French Toast!" button** (FRTCON 1–2). It's cream with an
  amber border, not solid amber, so it doesn't look like a second level
  badge next to the orange FRTCON 2 badge. The spelling "Lets" matches
  SOUPCON's equivalent button.
- **SOUPCON link.** It appears only for flood alerts (Flood and Flash Flood
  watches, warnings, advisories, and statements), not for rain in the
  forecast, so it shows up for significant rain rather than every drizzle.
  Coastal and Lakeshore Flood alerts are excluded, since tides and wind
  drive those.
- **Geolocation.** The app first tries a fast, low-accuracy location fix (15
  seconds, accepting one up to 10 minutes old). If that fails for any reason
  except denied permission, it retries once at high accuracy (30 seconds).
  Error messages are written in plain language and never show the
  browser's own error text.

## Crawler and AI-agent support

After running a Cloudflare "agent readiness" scan, I added the following to
`public/`:

- `robots.txt`, which allows search and AI answers but opts out of AI
  training (`Content-Signal: ai-train=no`), and blocks known training
  crawlers.
- `sitemap.xml`.
- `index.md` plus `.htaccess`. A request for `/` with
  `Accept: text/markdown` gets a markdown summary of the app, and `Link`
  headers point to the sitemap and the markdown version.

AI-discovery DNS records and Cloudflare's own bot settings live in the
Cloudflare dashboard, not this repo.

## Gotchas

These have each caused a problem once already.

- **Never set a custom `User-Agent` on requests to api.weather.gov.** Chrome
  and Firefox ignore it. Safari, which every iOS browser is built on, sends
  it, and that makes NWS reject the request, breaking the app on every
  iPhone. It was added once and caused exactly this.
- **Deployed files must be world-readable.** Files left owner-only fail to
  serve with no visible error. This once broke the PWA install prompt, and
  nothing explained why.
- **Check that Apache's `mod_headers`, `mod_rewrite`, and `mod_mime` are
  enabled.** Every rule in `.htaccess` is wrapped in a check for its module,
  so a missing module produces no error, just a missing header. Use
  `curl -I` against the live site to confirm the headers are actually sent.
- **Vite 8 needs Node `^20.19.0` or `>=22.12.0`.** On older Node versions
  the build fails, and `npm install` can quietly skip a native dependency,
  leaving `node_modules` broken until it's reinstalled.
- **Install certbot through snap only.** Having snap and apt versions
  installed at the same time causes "unrecognized arguments" errors that
  look like a plugin problem.
- **A `cloudflared tunnel login` certificate covers only one zone.** Routing
  a hostname in a different zone doesn't fail clearly. It creates a broken
  DNS record in the zone it does have access to. Log in again and authorize
  the new zone first.
- **Service workers update slowly.** After deploying a new `sw.js`, an
  installed app may need to be fully closed and reopened twice before the
  new version takes over. To test a service worker change, uninstall and
  reinstall the app.
- **Rule out caching first.** One "layout looks broken on iOS" report turned
  out to be a stale cache, which a private window confirmed.
- **Testing in a headless browser.** When a desktop browser isn't available
  to automate, install `chrome-headless-shell` with `@puppeteer/browsers`,
  drive it with `puppeteer-core`, and run it against `vite preview`. Use
  `?lat=&lon=` links to load a location directly, and replace
  `navigator.geolocation` with a stub to test location errors.

## Decided against

- **Dropping the high-accuracy geolocation retry** to fail faster. SOUPCON
  tried this and reverted it, because the low-accuracy attempt alone doesn't
  always work.
- **Cloudflare Bot Fight Mode.** The site has no login or payment pages to
  protect, and the free version can't make exceptions for legitimate bots.
- **A native app.** Not worth App Store cost and review when installing the
  web app gets most of the benefit.
- **A home-screen icon that changes with the FRTCON level.** No web API
  lets an installed web app change its own icon. The Badging API, which adds
  a small number or dot, is the closest option.

## Ideas for later

- **Native share sheet on mobile** (Web Share API).
- **Server-rendered share previews.** Accept a ZIP code or coordinates in
  the URL, render the page on the server, and set Open Graph tags so a
  shared link's preview shows that location's actual condition.
- **Push notifications** when conditions change, from a small backend that
  polls NWS.
- **Affiliate links** for winter gear or French toast ingredients. Any
  product API would need a server-side proxy to keep its credentials
  private.

The last three all need a backend, so they'd make sense to build together.
