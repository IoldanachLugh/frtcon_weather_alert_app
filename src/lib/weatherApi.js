import { getCacheItem, setCacheItem, makeZoneCacheKey, ZIP_CACHE_PREFIX, ALERTS_CACHE_PREFIX, ALERTS_CACHE_TTL_MS } from "./cache";

export const WEATHER_GOV_BASE = "https://api.weather.gov";
export const ZIP_API_BASE = "https://api.zippopotam.us/us";
export const FETCH_TIMEOUT_MS = 10000;
export const ALERTS_AUTO_REFRESH_MS = 5 * 60 * 1000;

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
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }

    return await response.json();
  } catch (err) {
    if (timeoutController.signal.aborted && !(signal && signal.aborted)) {
      throw new Error(`Request timed out for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

export async function getLatLonFromZip(zip, { signal } = {}) {
  const cached = getCacheItem(`${ZIP_CACHE_PREFIX}${zip}`);
  if (cached) {
    return cached;
  }

  const data = await fetchJson(`${ZIP_API_BASE}/${zip}`, { signal });
  const place = data?.places?.[0];

  if (!place) {
    throw new Error("ZIP code lookup did not return a location.");
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
  const pointData = await fetchJson(`${WEATHER_GOV_BASE}/points/${lat},${lon}`, { signal });
  const zoneUrl = pointData?.properties?.forecastZone;
  const zoneId = extractZoneIdFromUrl(zoneUrl);

  if (!zoneId) {
    throw new Error("Could not determine the NWS forecast zone for this location.");
  }

  const zoneData = await fetchJson(`${WEATHER_GOV_BASE}/zones/forecast/${zoneId}`, { signal });

  const value = {
    zoneId,
    zoneName: zoneData?.properties?.name || zoneId,
  };

  // Cached by rounded lat/lon (see makeZoneCacheKey) so a repeat visit from
  // roughly the same spot skips both requests above entirely for an hour.
  setCacheItem(cacheKey, value);
  return value;
}

export async function getActiveAlertsByZone(zoneId, { signal, skipCache = false } = {}) {
  const cacheKey = `${ALERTS_CACHE_PREFIX}${zoneId}`;

  if (!skipCache) {
    const cached = getCacheItem(cacheKey, ALERTS_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  const data = await fetchJson(`${WEATHER_GOV_BASE}/alerts/active/zone/${zoneId}`, { signal });
  const value = data?.features || [];

  setCacheItem(cacheKey, value);
  return value;
}
