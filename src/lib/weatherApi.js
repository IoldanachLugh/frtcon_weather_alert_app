import { getCacheItem, setCacheItem, makeZoneCacheKey, makeAlertsCacheKey, ZIP_CACHE_PREFIX, ALERTS_CACHE_TTL_MS } from "./cache";

export const WEATHER_GOV_BASE = "https://api.weather.gov";
export const ZIP_API_BASE = "https://api.zippopotam.us/us";
export const FETCH_TIMEOUT_MS = 10000;
export const ALERTS_AUTO_REFRESH_MS = 5 * 60 * 1000;

// Mobile browsers throttle or freeze setInterval timers for background tabs
// and suspended/installed PWAs, so ALERTS_AUTO_REFRESH_MS alone can't be
// trusted to catch up promptly when the app is reopened from the
// background -- how quickly (if at all) a frozen interval fires again
// varies by browser. So the app also refreshes on visibilitychange, but
// only if the data on screen is already at least this stale -- otherwise
// switching tabs for a couple seconds would trigger a needless refetch.
export const STALE_ON_VISIBLE_MS = 60 * 1000;

// Note: api.weather.gov asks consumers to identify themselves via a
// User-Agent header, but that's only practical from server-side code.
// Browsers won't let a page set a real custom User-Agent: Chrome/Firefox
// silently ignore the value, while Safari (all iOS browsers, since they're
// required to use WebKit) actually sends it as a genuine custom header --
// which then requires api.weather.gov's CORS preflight to explicitly allow
// "User-Agent" in Access-Control-Allow-Headers, which it doesn't. The result
// is every request failing specifically on iOS/Safari with a CORS error.
// So this header is intentionally left off client-side fetches below.

export function isValidZip(zip) {
  return /^\d{5}$/.test(zip.trim());
}

export function extractZoneIdFromUrl(url) {
  if (!url) return null;
  const parts = url.split("/");
  return parts[parts.length - 1] || null;
}

// Carries the technical detail (status code, URL, whether it was a timeout)
// separately from the message shown to the user -- fetchJson itself has no
// idea what a failure should say to a person, since that depends on which
// lookup was in flight (a 404 means something different for a ZIP lookup
// than for a coordinate lookup). See friendlyMessage() below, which is
// where that detail gets translated, one call site at a time.
export class HttpError extends Error {
  constructor(message, { status, url, timeout = false } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.timeout = timeout;
  }
}

export async function fetchJson(url, { signal } = {}) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);

  // Combine an external abort signal (e.g. a stale request being superseded)
  // with our own timeout, so either can cancel the request.
  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/geo+json, application/json",
      },
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      throw new HttpError(`Request failed (${response.status}) for ${url}`, { status: response.status, url });
    }

    return await response.json();
  } catch (err) {
    if (timeoutController.signal.aborted && !(signal && signal.aborted)) {
      throw new HttpError(`Request timed out for ${url}`, { url, timeout: true });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

// Turns a raw HttpError into copy a person can actually act on -- never a
// URL, a status code, or the word "fetch". The technical detail isn't
// thrown away, just moved: it still goes to the console for whoever's
// debugging, it's just not what ends up in the app's error box.
// `notFoundMessage` is optional -- only some call sites have something
// specific to say about a 404; everything else (5xx, other 4xx, timeouts)
// falls back to the same generic "try again" message regardless of source.
// Returns null for anything that isn't an HttpError, so the caller knows to
// fall back to its own handling instead.
function friendlyMessage(err, notFoundMessage) {
  if (!(err instanceof HttpError)) return null;

  console.error(err.timeout ? `Request timed out for ${err.url}` : `Request failed (${err.status}) for ${err.url}`);

  if (err.status === 404 && notFoundMessage) {
    return notFoundMessage;
  }
  return "The weather service isn't responding right now. Try again in a minute.";
}

export async function getLatLonFromZip(zip, { signal } = {}) {
  const cached = getCacheItem(`${ZIP_CACHE_PREFIX}${zip}`);
  if (cached) {
    return cached;
  }

  let data;
  try {
    data = await fetchJson(`${ZIP_API_BASE}/${zip}`, { signal });
  } catch (err) {
    const message = friendlyMessage(err, "We couldn't find that ZIP code.");
    throw message ? new Error(message) : err;
  }
  const place = data?.places?.[0];

  if (!place) {
    // Same "not found" case as the 404 above, just discovered a different
    // way -- zippopotam.us returns 200 with an empty places array for some
    // malformed-but-numeric inputs instead of 404ing. Same user-facing
    // message either way.
    throw new Error("We couldn't find that ZIP code.");
  }

  const value = {
    lat: Number(place.latitude),
    lon: Number(place.longitude),
  };

  setCacheItem(`${ZIP_CACHE_PREFIX}${zip}`, value);
  return value;
}

export async function getZoneByPoint(lat, lon, { signal } = {}) {
  const cacheKey = makeZoneCacheKey(lat, lon);
  const cached = getCacheItem(cacheKey);
  if (cached) {
    return cached;
  }

  // Documented path per NWS's own API docs: /points/{lat},{lon} resolves a
  // coordinate to its forecast zone URL, then /zones/forecast/{zoneId}
  // gets that zone's details. (An earlier version of this function tried
  // an undocumented /zones/forecast?point= shortcut first, which wasn't in
  // NWS's published spec and had no guaranteed behavior if NWS ever changed
  // or removed it -- not worth the risk for saving one request.)
  let pointData;
  try {
    pointData = await fetchJson(`${WEATHER_GOV_BASE}/points/${lat},${lon}`, { signal });
  } catch (err) {
    const message = friendlyMessage(err, "This location isn't covered by the National Weather Service.");
    throw message ? new Error(message) : err;
  }
  const zoneUrl = pointData?.properties?.forecastZone;
  const zoneId = extractZoneIdFromUrl(zoneUrl);

  if (!zoneId) {
    throw new Error("Could not determine the NWS forecast zone for this location.");
  }

  let zoneData;
  try {
    zoneData = await fetchJson(`${WEATHER_GOV_BASE}/zones/forecast/${zoneId}`, { signal });
  } catch (err) {
    // No notFoundMessage here: a 404 at this step would be unexpected (the
    // zoneId just came from a successful /points/ response, not user
    // input), so it isn't a distinct "not covered" case -- just falls
    // through to the generic message like any other failure.
    const message = friendlyMessage(err);
    throw message ? new Error(message) : err;
  }

  const value = {
    zoneId,
    zoneName: zoneData?.properties?.name || zoneId,
  };

  // Cached by rounded lat/lon (see makeZoneCacheKey) so a repeat visit from
  // roughly the same spot skips both requests above entirely for an hour.
  setCacheItem(cacheKey, value);
  return value;
}

export async function getActiveAlertsByPoint(lat, lon, { signal, skipCache = false } = {}) {
  // Deliberately NOT /alerts/active/zone/{forecastZoneId}: that endpoint
  // only returns alerts coded to the forecast zone (UGC "xxZnnn"). Some
  // winter alert types -- Snow Squall Warning among them -- are issued by
  // county or storm polygon (UGC "xxCnnn") instead, and a zone-only query
  // silently misses those entirely. /alerts/active?point= matches on the
  // actual alert geometry/UGC coverage regardless of which kind it is, so
  // it catches both. Confirmed live: zone-coded county/polygon alerts
  // (Flash Flood Warning, Flood Advisory, Flood Warning) were absent from
  // the zone endpoint but present via ?point= for the same coordinates.
  const cacheKey = makeAlertsCacheKey(lat, lon);

  if (!skipCache) {
    const cached = getCacheItem(cacheKey, ALERTS_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  let data;
  try {
    data = await fetchJson(`${WEATHER_GOV_BASE}/alerts/active?point=${lat},${lon}&status=actual`, { signal });
  } catch (err) {
    const message = friendlyMessage(err);
    throw message ? new Error(message) : err;
  }
  const value = data?.features || [];

  setCacheItem(cacheKey, value);
  return value;
}
