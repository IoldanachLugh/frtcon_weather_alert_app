// How long the browser-geolocation lookup waits: a quick low-accuracy try,
// then (unless permission was denied) one high-accuracy retry. The messages
// below quote the total, so App.jsx uses these same constants.
export const GEOLOCATION_FAST_TIMEOUT_MS = 15000;
export const GEOLOCATION_PRECISE_TIMEOUT_MS = 30000;
const WAIT_SECONDS = (GEOLOCATION_FAST_TIMEOUT_MS + GEOLOCATION_PRECISE_TIMEOUT_MS) / 1000;

export const ZIP_FALLBACK_HINT = "You can enter a ZIP code below instead.";

// GeolocationPositionError codes (the browser's own `message` text, e.g.
// Chrome's bare "Timeout expired", says nothing a person can act on).
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

// Plain-language text for a failed browser-geolocation lookup, including the
// ZIP fallback hint. `geoError` is a GeolocationPositionError (or anything
// with a numeric `code`).
export function geolocationErrorMessage(geoError) {
  switch (geoError?.code) {
    case PERMISSION_DENIED:
      return (
        "Location access is turned off for this site. On iPhone: tap the \"Aa\" icon in the address bar, " +
        `Website Settings, and set Location to Ask or Allow, then try again. ${ZIP_FALLBACK_HINT}`
      );
    case POSITION_UNAVAILABLE:
      return `Your device couldn't work out where it is. Check that location services are turned on and that you have a signal, then try again. ${ZIP_FALLBACK_HINT}`;
    case TIMEOUT:
      return `Your device didn't report its location within ${WAIT_SECONDS} seconds. Check that location services are turned on, then try again. ${ZIP_FALLBACK_HINT}`;
    default:
      return `We couldn't read your location. ${ZIP_FALLBACK_HINT}`;
  }
}
