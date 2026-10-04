# FRTCON — French Toast Conditions

> Shared for portfolio & demonstration purposes. All rights reserved.

FRTCON checks live National Weather Service alerts for your location and turns
them into a **French Toast Condition** level: a tongue-in-cheek 1–5 scale
answering the important question, "should I make French toast and stay home
today?"

It's live at [frtcon.com](https://frtcon.com).

## About this project

FRTCON is a personal side project. My background is mostly backend
development, and I built this to get hands-on with modern frontend work
(React, PWAs, accessibility, charting) and with AI-assisted development. I
used Claude as a pair programmer throughout. I set the architecture and
product direction, reviewed and tested every change, and owned the
infrastructure.

There's more detail in the other docs:

- [`CONTEXT.md`](CONTEXT.md) covers the design decisions, how it's hosted,
  and the gotchas I ran into.
- [`PLAN.md`](PLAN.md) is the log from a full code review, with each issue
  found, how it was fixed, and how the fix was checked.

## Features

- **Two ways to look up a location:** browser geolocation or a ZIP code.
  Whichever one worked last time runs again automatically on your next
  visit. A failed lookup is never remembered.
- **A link to a specific location.** Add `lat` and `lon` to the URL, e.g.
  `https://frtcon.com/?lat=46.7867&lon=-92.1005`. Both must be valid or
  they're ignored. A link like this doesn't overwrite the visitor's own
  saved location.
- **A FRTCON level with commentary.** The most severe active winter alert
  sets the level, and each level shows a randomly picked bit of commentary.
- **Every active alert listed,** not just the one setting the level.
- **A 48-hour winter outlook.** This collapsible panel shows three small
  charts on one time axis with a shared hover readout:
  - snow and ice amounts, drawn as blocks over each NWS forecast period
  - temperature, with a 32°F freezing line
  - chance of precipitation, colored by type (rain, snow, or sleet/freezing
    rain)

  The panel also gives 48-hour totals and has a table view. The charts use
  [uPlot](https://github.com/leeoniya/uPlot), which is loaded as a separate
  ~24 KB chunk only when the panel is opened.
- **Plain-language errors.** "We couldn't find that ZIP code" instead of
  `Request failed (404)`, and a clear explanation when the browser can't
  get your location.
- **Share to Facebook.** This copies the on-screen condition to the
  clipboard and opens Facebook's share dialog. Facebook's share link only
  accepts a URL, so you paste the text in yourself.
- **A printable French toast recipe.** It prints cleanly on its own, and a
  "Lets make French Toast!" button appears at FRTCON 1 or 2.
- **A link to [SOUPCON](https://soupcon.org)** whenever a flood alert is
  active. SOUPCON is a rain-focused sibling app forked from this one.
- **A contact box** at the bottom of the page with a `mailto:` link to
  contact@frtcon.com, for feedback and bug reports.
- **Installable** as a home-screen app on Android (via an Install button)
  and iOS (via guided "Add to Home Screen" steps).

## The FRTCON scale

| Level | Meaning | Example NWS alerts |
|---|---|---|
| **1** | Severe — stay inside, this is not a drill | Blizzard Warning, Ice Storm Warning, Heavy Freezing Spray Warning, Winter Storm Warning with significant ice |
| **2** | Major weather warning active | Winter Storm Warning, Lake Effect Snow Warning, Snow Squall Warning, Freezing Rain Warning, Extreme Cold Warning |
| **3** | Moderate impacts active | Winter Weather Advisory, Freezing Fog/Rain Advisory, Snow/Blowing Snow Advisory, Cold Weather Advisory |
| **4** | Being watched, no major impacts yet | Winter Storm/Blizzard/Lake Effect Snow/Ice Storm/Extreme Cold/Freeze Watch, Heavy Freezing Spray Watch, Frost Advisory, Freeze Warning — **or** no winter alert, but 1 in or more of snow or any ice forecast in the next 48 hours |
| **5** | All clear | No winter alerts, and less than 1 in of snow and no ice in the forecast |

**How alerts are classified.** Each alert's `event` field is matched against
keywords (see `src/lib/frtcon.js`). NWS takes `event` from a fixed, published
list of alert types, so this is closer to matching a code than parsing
prose. The one exception is "Winter Storm Warning with significant ice",
which isn't its own event type, so that case also checks the alert's
description. When several winter alerts are active, the most severe one
wins, and all of them are listed.

**The one forecast-based rule.** Going by alerts alone, a place could show
"all clear" with snow on the way, if that much snow is too routine there for
NWS to issue an advisory. Fairbanks with an inch of snow coming is the
example that prompted this rule. So, when no winter alert is active but the
forecast shows **1 inch or more of snow, or any ice, in the next 48 hours**,
the level is 4 instead of 5. The forecast can't raise the level any higher
than that, and it never overrides an alert. NWS already tunes its alerts to
local norms, and a raw snowfall number isn't tuned that way.

## Tech stack

- React + Vite
- Plain CSS with semantic class names (no CSS-in-JS, no Tailwind)
- Vitest for the classification, API, outlook, and error-message logic
- No backend. It's a fully static app, and the browser calls public APIs
  directly. No API keys or secrets are needed.

## Project structure

```
src/
  App.jsx                    top-level state and orchestration
  styles.css                 all styling
  lib/
    weatherApi.js            network layer (NWS and ZIP lookup), caching, friendly errors
    cache.js                 localStorage caching with expiry
    frtcon.js                pure classification logic, no React or DOM
    geolocationError.js      plain-language geolocation errors and timeouts
    winterOutlook.js         turns NWS gridpoint data into chart data
    *.test.js                Vitest suites for each of the above
  data/
    alertMessages.js         headlines and commentary for each level
    recipe.js                the French toast recipe
  hooks/
    useModalBehavior.js      shared modal accessibility: focus trap, focus
                             restore, scroll lock, Escape to close
  components/
    FrtconBadge.jsx, FrtconMessage.jsx, AlertCard.jsx,
    WinterOutlookPanel.jsx, WinterOutlookChart.jsx (lazy-loaded),
    RecipeModal.jsx, IOSInstallHelp.jsx, SnowOverlay.jsx
public/
  manifest.json, sw.js, icons        PWA support
  robots.txt, sitemap.xml, index.md, .htaccess   crawler and agent support
```

## Running it locally

Requires Node `^20.19.0` or `>=22.12.0` (Vite 8's minimum).

```
npm install
npm run dev       # local dev server
npm run test      # run the test suites
npm run lint
npm run build     # production build in dist/
```

## Deployment notes

The production build is a set of static files, currently served by Apache
behind a Cloudflare Tunnel. A few things to know when deploying:

- **PWA files.** `manifest.json`, `sw.js`, and the icons live in `public/`,
  so they end up at the site root. The maskable icon is a separate image:
  Android crops maskable icons to its own shape, so the artwork has to be
  shrunk into a safe zone with a full-bleed background.
- **The service worker doesn't cache anything.** That's on purpose. FRTCON
  shows live alerts, and an out-of-date cached copy would be misleading.
  The service worker exists because Chrome requires one before it will
  offer to install the app. It also catches a failed page load (for
  example, an Android cold start before the network is up) and shows a
  small "Reconnecting…" page. That page retries with increasing delays, then
  stops and shows a Retry button.
- **Copy the hidden files too.** `.htaccess` (which handles markdown content
  negotiation and `Link` headers) is a dotfile, so use `cp -a dist/. target/`
  rather than `dist/*`. It requires Apache's `mod_rewrite`, `mod_headers`,
  and `AllowOverride All`.
- **Files must be world-readable.** If they aren't, Apache fails to serve
  them without any visible error, and the PWA install prompt just never
  appears.

## APIs used

- **[api.weather.gov](https://www.weather.gov/documentation/services-web-api)**
  (National Weather Service): location lookup, active alerts, and the
  gridpoint forecast used for the winter outlook. No key required.
- **[api.zippopotam.us](https://www.zippopotam.us/)**: converts a ZIP code to
  coordinates. No key required.

NWS asks server-side clients to identify themselves with a `User-Agent`
header. This app deliberately doesn't set one. Browsers won't let page code
set a real `User-Agent`, and Safari sends the custom header anyway, which
makes NWS reject the request and breaks the app on every iPhone. If a
server-side proxy is ever added, that's where the header should go.

## Known limitations

- No offline mode, by design (see the service worker note above).
- On Android, the Install button only appears once Chrome decides the app
  is installable, which includes an engagement check, so it may not show on
  a first visit.
- iOS has no way for a site to trigger installation, so iPhone and iPad
  users get step-by-step "Add to Home Screen" instructions instead.

## Ideas for later

- **Worldwide coverage.** SOUPCON uses Open-Meteo outside the US, but
  Open-Meteo has no alerts, so FRTCON would need a second, forecast-based
  scale there.
- **Native share sheet on mobile** (Web Share API), carrying the condition
  text and a link together.
- **Server-rendered share previews**, so a shared link shows that
  location's actual condition in its preview card.
- **Push notifications** when the condition changes, which needs a small
  backend to poll NWS.

Server-rendered previews and push notifications both need a backend, so
they'd make sense to build together.

## License

Copyright © 2026 Jeffrey Morton. All rights reserved.

This code is shared publicly for portfolio and demonstration purposes only.
No license is granted to use, copy, modify, or distribute it. See
[`LICENSE`](LICENSE).
