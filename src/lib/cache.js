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

export function makeAlertsCacheKey(lat, lon) {
  return `${ALERTS_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

// getCacheItem only evicts an expired entry when that exact key is read
// again -- a zone/alerts cache key for a location the user never revisits
// just sits in localStorage forever. Harmless individually, but with one
// key per distinct lat/lon rounding bucket, it adds up over time. Call once
// at app startup to sweep anything already expired.
const TTL_MS_BY_PREFIX = {
  [ZIP_CACHE_PREFIX]: CACHE_TTL_MS,
  [ZONE_CACHE_PREFIX]: CACHE_TTL_MS,
  [ALERTS_CACHE_PREFIX]: ALERTS_CACHE_TTL_MS,
};

export function sweepExpiredCache() {
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      const prefix = Object.keys(TTL_MS_BY_PREFIX).find((p) => key.startsWith(p));
      if (prefix) {
        // Reuses getCacheItem's own expiry check and eviction rather than
        // duplicating it -- the return value doesn't matter here, only
        // the side effect of removing the key when it's expired.
        getCacheItem(key, TTL_MS_BY_PREFIX[prefix]);
      }
    }
  } catch {
    // Ignore storage failures (see safeGetItem/safeSetItem above for why
    // this can throw) -- worst case, the sweep just doesn't happen.
  }
}

// For the handful of plain (non-TTL) localStorage reads/writes elsewhere in
// the app -- e.g. remembering the last-used ZIP/lookup method -- that don't
// go through getCacheItem/setCacheItem above. Touching localStorage at all
// can throw (Safari with all cookies/site data blocked, some hardened
// privacy extensions, certain embedded webviews), so every direct call site
// needs the same try/catch treatment the TTL cache already has.
export function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
