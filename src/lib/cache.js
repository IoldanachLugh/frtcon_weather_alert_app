export const CACHE_TTL_MS = 60 * 60 * 1000;
export const ZIP_CACHE_PREFIX = "frtcon_zip_lookup_";
export const ZONE_CACHE_PREFIX = "frtcon_zone_lookup_";
export const ALERTS_CACHE_PREFIX = "frtcon_alerts_";
export const ALERTS_CACHE_TTL_MS = 5 * 60 * 1000;

export function getCacheItem(key, ttlMs = CACHE_TTL_MS) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > ttlMs) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export function setCacheItem(key, value) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        timestamp: Date.now(),
        value,
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

export function makeZoneCacheKey(lat, lon) {
  return `${ZONE_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}
