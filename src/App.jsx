import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  isValidZip,
  getLatLonFromZip,
  getZoneByPoint,
  getActiveAlertsByPoint,
  getWinterOutlook,
  ALERTS_AUTO_REFRESH_MS,
  STALE_ON_VISIBLE_MS,
} from "./lib/weatherApi";
import { safeGetItem, safeSetItem } from "./lib/cache";
import {
  geolocationErrorMessage,
  ZIP_FALLBACK_HINT,
  GEOLOCATION_FAST_TIMEOUT_MS,
  GEOLOCATION_PRECISE_TIMEOUT_MS,
} from "./lib/geolocationError";
import { determineFrtcon, pickRandomItems, isRainAlert } from "./lib/frtcon";
import { buildOutlook, formatIce, formatSnow } from "./lib/winterOutlook";
import { alertMessages } from "./data/alertMessages";
import { SnowOverlay } from "./components/SnowOverlay";
import { FrtconBadge } from "./components/FrtconBadge";
import { FrtconMessage } from "./components/FrtconMessage";
import { AlertCard } from "./components/AlertCard";
import { WinterOutlookPanel } from "./components/WinterOutlookPanel";
import { RecipeModal } from "./components/RecipeModal";
import { IOSInstallHelp } from "./components/IOSInstallHelp";
import { PrivacyNote } from "./components/PrivacyNote";

// Optional `?lat=..&lon=..` URL parameters point the app at a specific
// location. Both must be present and in range, otherwise they're ignored
// and the normal saved-lookup behavior applies. Parsed once at module load.
function readUrlLocation() {
  const params = new URLSearchParams(window.location.search);
  const rawLat = params.get("lat")?.trim();
  const rawLon = params.get("lon")?.trim();
  if (!rawLat || !rawLon) return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };
}
const URL_LOCATION = readUrlLocation();

export default function App() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [source, setSource] = useState("browser");
  const [result, setResult] = useState(null);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [shareToast, setShareToast] = useState("");

  // iOS never fires beforeinstallprompt and never will (no such API exists
  // in WebKit) -- this is a one-time UA check, not something that changes
  // at runtime, so no need to re-derive it on every render.
  //
  // iPadOS 13+ Safari reports a plain "Macintosh" user agent (no "iPad"),
  // indistinguishable from a real Mac by UA string alone -- so the
  // iPad|iPhone|iPod regex is paired with a touch-points check, since a
  // real Mac laptop/desktop has no touchscreen but an iPad always reports
  // maxTouchPoints > 1.
  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }, []);

  useEffect(() => {
    // Don't offer to install an app that's already installed and running.
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    setIsStandalone(standaloneQuery.matches || window.navigator.standalone === true);

    const onInstallPromptAvailable = (event) => {
      // Chrome fires this unprompted; suppress its default mini-infobar and
      // hold onto the event so our own menu item can trigger it on demand.
      event.preventDefault();
      setInstallPromptEvent(event);
    };
    const onInstalled = () => {
      setInstallPromptEvent(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onInstallPromptAvailable);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPromptAvailable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Base-relative rather than a hardcoded "/sw.js": that literal path
      // only resolves correctly when the app is served from the domain
      // root. import.meta.env.BASE_URL tracks whatever `base` vite.config.js
      // is set to, so this keeps working whether the build lands in
      // /dev/ (for review) or gets promoted to the site root.
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        // Non-fatal: the app works fine without it, it just won't be
        // installable from Chrome's own in-app menu item in that case.
      });
    }
  }, []);

  const handleInstallClick = async () => {
    if (!installPromptEvent) return;
    setMenuOpen(false);
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    // Whether accepted or dismissed, a given prompt event can only be used
    // once -- clear it either way, letting `appinstalled` (if it fires)
    // update isStandalone through the effect above.
    setInstallPromptEvent(null);
  };

  // Guards against race conditions: if a new lookup starts before an older
  // one resolves, the older one's AbortController is cancelled and its
  // eventual result/error is ignored instead of overwriting fresher state.
  const activeRequestRef = useRef(null);

  // Separate guard for geolocation specifically: navigator.geolocation has
  // no AbortController equivalent, so a slow GPS fix can still resolve well
  // after the user has moved on to (and finished) a ZIP search. Every
  // user-initiated lookup -- browser or ZIP -- bumps this counter; a
  // geolocation callback only acts if its own sequence number is still the
  // latest one, otherwise it's a stale result and gets silently dropped.
  const requestSeqRef = useRef(0);

  const menuButtonRef = useRef(null);
  const dropdownRef = useRef(null);
  const shareToastTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (shareToastTimeoutRef.current) clearTimeout(shareToastTimeoutRef.current);
    };
  }, []);

  // Keyboard support for the hamburger dropdown, matching what the modals
  // already do: Escape closes it (and returns focus to the button that
  // opened it), Up/Down arrows cycle focus between items, and opening the
  // menu moves focus onto its first item for keyboard users.
  useEffect(() => {
    if (!menuOpen) return undefined;

    const items = dropdownRef.current
      ? Array.from(dropdownRef.current.querySelectorAll(".dropdown-item"))
      : [];
    items[0]?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();

      const currentItems = dropdownRef.current
        ? Array.from(dropdownRef.current.querySelectorAll(".dropdown-item"))
        : [];
      if (currentItems.length === 0) return;

      const currentIndex = currentItems.indexOf(document.activeElement);
      const nextIndex =
        event.key === "ArrowDown"
          ? (currentIndex + 1) % currentItems.length
          : (currentIndex - 1 + currentItems.length) % currentItems.length;

      currentItems[nextIndex]?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  // The 48-hour outlook (chart data + snow/ice totals), rebuilt on every
  // refresh so its window moves forward. null when it didn't load.
  const outlook = useMemo(() => (result?.outlook ? buildOutlook(result.outlook) : null), [result]);

  // Alerts decide the level; forecast snow/ice can only lift a 5 to a 4 (see
  // determineFrtcon). Without the outlook it's purely alert-based.
  const frtcon = useMemo(() => {
    return result?.alerts ? determineFrtcon(result.alerts, outlook?.totals ?? null) : null;
  }, [result, outlook]);

  // Computed here (rather than inside FrtconMessage) so the Share button can
  // reuse the exact headline/title/commentary lines already on screen,
  // instead of calling pickRandomItems a second time and sharing a
  // different random selection than what the user is actually looking at.
  // Re-randomizes only when the level itself changes, not on every
  // background refresh that leaves the level unchanged.
  const frtconMessage = useMemo(() => {
    if (!frtcon) return null;
    const message = alertMessages[frtcon.level] || alertMessages[5];
    return {
      headline: message.headline,
      title: message.title,
      lines: pickRandomItems(message.body, 4),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frtcon?.level]);

  const snowCount = frtcon
    ? {
        1: 140,
        2: 100,
        3: 65,
        4: 30,
        5: 8,
      }[frtcon.level] || 8
    : 8;

  // Resolves to true if it actually landed a result, false otherwise
  // (failed, or superseded by a newer lookup before it finished) -- callers
  // use this to decide whether the lookup is worth remembering for next
  // visit (see the frtcon_last_source/frtcon_last_zip writes below), so a
  // denied permission or a bad ZIP doesn't get silently auto-retried and
  // re-shown as the first thing a returning visitor sees.
  // `controller`, if given, is one the caller already owns and has set as
  // activeRequestRef.current (performZipLookup does this while resolving
  // the ZIP -> lat/lon step) -- reusing it here instead of creating a
  // second one avoids immediately self-aborting that still-fresh
  // controller for no reason right as it's handed off. Callers with no
  // controller of their own (geolocation has no AbortController
  // equivalent) fall back to the original abort-whatever's-in-flight-then-
  // create-a-new-one behavior, which is still what actually cancels a
  // concurrent ZIP lookup if the user switches methods mid-request.
  const runLookupFromCoordinates = useCallback(
    async (lat, lon, inputSource, { skipCache = false, controller: existingController } = {}) => {
      let controller = existingController;
      if (!controller) {
        // Cancel any lookup still in flight so its result can't clobber this one.
        if (activeRequestRef.current) {
          activeRequestRef.current.abort();
        }
        controller = new AbortController();
        activeRequestRef.current = controller;
      }
      const { signal } = controller;

      setLoading(true);
      setError("");

      try {
        // Fetched independently, not chained: getZoneByPoint is only needed
        // for the human-readable zone name, while alerts come from a direct
        // point query (see getActiveAlertsByPoint for why that's not a
        // zone-based lookup) -- neither depends on the other's result, so
        // there's no reason to wait for one before starting the other.
        //
        // The winter outlook waits for the zone lookup, which caches the
        // grid URL from the same /points response (no second /points
        // request). It can only lift a 5 to a 4, so its failure doesn't
        // fail the lookup: the score is then alert-only, and the outlook
        // panel shows the error.
        const zonePromise = getZoneByPoint(lat, lon, { signal });
        const [zone, alerts, outlookResult] = await Promise.all([
          zonePromise,
          getActiveAlertsByPoint(lat, lon, { signal, skipCache }),
          zonePromise
            .then(() => getWinterOutlook(lat, lon, { signal }))
            .then((outlook) => ({ outlook, outlookError: "" }))
            .catch((err) => ({ outlook: null, outlookError: err instanceof Error ? err.message : "Unknown error." })),
        ]);

        if (signal.aborted) return false;

        setStatusMessage("");
        setResult({
          source: inputSource,
          lat,
          lon,
          zone,
          alerts,
          ...outlookResult,
          fetchedAt: Date.now(),
        });
        return true;
      } catch (err) {
        if (signal.aborted) return false;
        setResult(null);
        setStatusMessage("");
        setError(err instanceof Error ? err.message : "Something went wrong during lookup.");
        return false;
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    []
  );

  // Shared by both refresh paths below (the interval and the
  // visibilitychange catch-up). Deliberately bypasses the TTL cache
  // (skipCache: true) rather than waiting for it to expire -- this is live
  // weather data, so every refresh genuinely hits the network. Only applies
  // its result if the location it was fetched for is still the one on
  // screen -- guards against a slow refresh landing after the user has
  // since searched somewhere else.
  // The outlook refreshes alongside, through its own 30-minute cache (NWS
  // regenerates the grid about hourly); if that fails, the last good
  // outlook is kept, like any other refresh failure.
  const refreshAlerts = useCallback((lat, lon) => {
    return Promise.all([getActiveAlertsByPoint(lat, lon, { skipCache: true }), getWinterOutlook(lat, lon).catch(() => null)])
      .then(([alerts, outlook]) => {
        setResult((prev) =>
          prev && prev.lat === lat && prev.lon === lon
            ? { ...prev, alerts, ...(outlook ? { outlook, outlookError: "" } : {}), fetchedAt: Date.now() }
            : prev
        );
      })
      .catch(() => {
        // Silently ignore background refresh failures; the user still has
        // the last good data and can manually re-search if needed.
      });
  }, []);

  // Keep alerts fresh for whatever location is currently displayed, without
  // the user needing to manually re-search. Keyed on lat/lon (not zoneId)
  // since alerts are now fetched by point, not by zone -- see
  // getActiveAlertsByPoint. Note this interval (ALERTS_AUTO_REFRESH_MS) and
  // the alerts cache TTL (ALERTS_CACHE_TTL_MS in lib/cache.js) are
  // independently defined but currently equal; if either is ever tuned,
  // check whether that's still the intended relationship.
  useEffect(() => {
    if (result?.lat == null || result?.lon == null) return undefined;

    const intervalId = setInterval(() => {
      refreshAlerts(result.lat, result.lon);
    }, ALERTS_AUTO_REFRESH_MS);

    return () => clearInterval(intervalId);
  }, [result?.lat, result?.lon, refreshAlerts]);

  // Mobile browsers throttle or freeze the setInterval above for background
  // tabs and suspended/installed PWAs, so it can't be trusted to catch up
  // promptly when the app is reopened from the background -- how quickly
  // (if at all) it fires again varies by browser. This app's whole point is
  // never showing stale alerts, so when the page becomes visible again,
  // refresh immediately if the data on screen is already stale rather than
  // waiting on the interval.
  useEffect(() => {
    if (result?.lat == null || result?.lon == null) return undefined;

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (result.fetchedAt == null || Date.now() - result.fetchedAt >= STALE_ON_VISIBLE_MS) {
        refreshAlerts(result.lat, result.lon);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [result?.lat, result?.lon, result?.fetchedAt, refreshAlerts]);

  function handleUseBrowserLocation() {
    setSource("browser");
    setError("");
    setStatusMessage("Locating you... this can take a few seconds.");

    // Claim this lookup's sequence number now, before the (unabortable)
    // geolocation call even starts. If the user kicks off another lookup
    // (browser or ZIP) before this one resolves, requestSeqRef will have
    // moved on and the callbacks below will recognize themselves as stale.
    const mySeq = ++requestSeqRef.current;

    if (!navigator.geolocation) {
      setStatusMessage("");
      setError(`This browser does not support geolocation. ${ZIP_FALLBACK_HINT}`);
      return;
    }

    setLoading(true);

    const onSuccess = async (position) => {
      if (mySeq !== requestSeqRef.current) return; // superseded by a newer lookup
      const lat = Number(position.coords.latitude.toFixed(4));
      const lon = Number(position.coords.longitude.toFixed(4));
      const succeeded = await runLookupFromCoordinates(lat, lon, "browser");
      // Remember which method was used so a return visit can skip straight
      // to it instead of waiting for another button press -- but only once
      // it's actually worked. Persisting this before the lookup resolves
      // (as this used to) meant a denied-permission or offline failure
      // got saved as "last successful method" too, so every later visit
      // silently re-ran the same failing lookup and opened straight on an
      // error instead of the last good result.
      if (succeeded) safeSetItem("frtcon_last_source", "browser");
    };

    const onFinalError = (geoError) => {
      if (mySeq !== requestSeqRef.current) return; // superseded by a newer lookup
      setLoading(false);
      setStatusMessage("");
      // Plain-language text per error code, never the browser's own message
      // (e.g. Chrome's bare "Timeout expired").
      setError(geolocationErrorMessage(geoError));
    };

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (geoError) => {
        if (mySeq !== requestSeqRef.current) return; // superseded by a newer lookup

        // A permission denial won't change on retry, so don't bother — go
        // straight to the actionable message instead of a pointless second
        // attempt (which would also flash a misleading "still locating"
        // message right before failing again).
        if (geoError?.code === geoError?.PERMISSION_DENIED) {
          onFinalError(geoError);
          return;
        }

        setStatusMessage("Still locating you... trying a more precise lookup.");
        navigator.geolocation.getCurrentPosition(onSuccess, onFinalError, {
          enableHighAccuracy: true,
          timeout: GEOLOCATION_PRECISE_TIMEOUT_MS,
          maximumAge: 0,
        });
      },
      {
        enableHighAccuracy: false,
        timeout: GEOLOCATION_FAST_TIMEOUT_MS,
        maximumAge: 600000,
      }
    );
  }

  // Facebook's sharer.php dialog only accepts a URL, not custom text/quote
  // parameters (see CONTEXT.md), so there's no way to make the resulting
  // post auto-populate with the FRTCON status. Instead, this copies the
  // status text to the clipboard and opens the sharer in a new tab, so the
  // user can paste it into the post once they get there.
  function handleShare() {
    if (!frtcon || !frtconMessage || !result?.zone) return;

    // Mirrors exactly what's rendered in the .frtcon-condition-status box
    // (FrtconMessage) -- headline, title, and the same randomized
    // commentary lines currently on screen -- rather than the shorter
    // frtcon.title/frtcon.reason summary shown above it. No URL here --
    // the sharer.php dialog already attaches frtcon.com as a link card via
    // its own `u` param, so repeating it as plain text in the pasted body
    // would just duplicate it.
    const shareText = [
      `${frtconMessage.headline} - ${result.zone.zoneName} is currently at French Toast Condition #${frtcon.level}.`,
      frtconMessage.title,
      ...frtconMessage.lines,
    ].join("\n");

    if (shareToastTimeoutRef.current) clearTimeout(shareToastTimeoutRef.current);

    const showToast = (message) => {
      setShareToast(message);
      shareToastTimeoutRef.current = setTimeout(() => setShareToast(""), 5000);
    };

    // window.open() can shift focus to the new tab, and Chrome's
    // auto-granted (silent) clipboard write only takes that fast path
    // while this document still has focus -- once focus moves, a write
    // falls back to an explicit permission prompt instead. So the write
    // has to happen first, while frtcon.com still definitely has focus,
    // with window.open() following it. The write itself resolves almost
    // instantly, well within the few seconds a click's "user activation"
    // stays valid, so this doesn't risk window.open() getting popup-blocked.
    const openFacebook = () => {
      window.open("https://www.facebook.com/sharer/sharer.php?u=https://frtcon.com", "_blank", "noopener,noreferrer");
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(shareText)
        .then(() => {
          openFacebook();
          showToast("Copied! Paste it into your Facebook post.");
        })
        .catch(() => {
          openFacebook();
          showToast("Couldn't copy automatically — copy your FRTCON status before posting.");
        });
    } else {
      openFacebook();
      showToast("Couldn't copy automatically — copy your FRTCON status before posting.");
    }
  }

  const performZipLookup = useCallback(
    async (zipValue) => {
      if (!isValidZip(zipValue)) {
        setError("Enter a valid 5-digit US ZIP code.");
        return;
      }

      // Bump the shared sequence counter so that a geolocation lookup still
      // in flight (which can't be aborted the way a fetch can) recognizes
      // itself as stale once it eventually resolves, instead of overwriting
      // this ZIP search's result.
      const mySeq = ++requestSeqRef.current;

      // Cancel any in-flight lookup before starting the ZIP resolution step,
      // so an older request can't overwrite this one once it's done.
      if (activeRequestRef.current) {
        activeRequestRef.current.abort();
      }
      const controller = new AbortController();
      activeRequestRef.current = controller;
      const { signal } = controller;

      setLoading(true);

      try {
        const location = await getLatLonFromZip(zipValue, { signal });
        if (signal.aborted || mySeq !== requestSeqRef.current) return;
        const succeeded = await runLookupFromCoordinates(location.lat, location.lon, "zip", { controller });
        // Remember the ZIP and method used so a return visit can skip
        // straight to it instead of waiting for another button press --
        // but only once it's actually worked. Persisting this before the
        // lookup resolves (as this used to) meant a nonexistent ZIP or a
        // network failure got saved as "last successful method" too, so
        // every later visit silently re-ran the same failing lookup and
        // opened straight on an error instead of the last good result.
        if (succeeded) {
          safeSetItem("frtcon_last_zip", zipValue);
          safeSetItem("frtcon_last_source", "zip");
        }
      } catch (err) {
        if (signal.aborted || mySeq !== requestSeqRef.current) return;
        setLoading(false);
        setResult(null);
        setStatusMessage("");
        setError(err instanceof Error ? err.message : "ZIP lookup failed.");
      }
    },
    [runLookupFromCoordinates]
  );

  async function handleZipLookup(event) {
    event.preventDefault();
    setSource("zip");
    setError("");
    setStatusMessage("");
    await performZipLookup(zip);
  }

  // On load, silently resume whichever method the visitor used last time,
  // rather than making a returning visitor click a button again. Runs once
  // on mount only -- intentionally does not re-run on every render.
  useEffect(() => {
    const savedZip = safeGetItem("frtcon_last_zip");
    if (savedZip && isValidZip(savedZip)) {
      setZip(savedZip);
    }

    // A location in the URL wins over the remembered method. It's a
    // one-off link, so it's deliberately not saved as the last source/ZIP.
    if (URL_LOCATION) {
      setSource("url");
      requestSeqRef.current++;
      runLookupFromCoordinates(URL_LOCATION.lat, URL_LOCATION.lon, "url");
      return;
    }

    const savedSource = safeGetItem("frtcon_last_source");
    if (savedSource === "browser") {
      // A permission denial won't have changed on its own since the last
      // visit, so silently auto-retrying it would just flash "Locating
      // you..." right before failing again with the same error. Check
      // first where the browser supports it (best-effort: the Permissions
      // API isn't universal, and Safari in particular can be unreliable
      // for "geolocation" specifically -- if the check itself fails or
      // isn't available, just fall back to attempting the lookup as
      // before). Note this only skips the *silent auto-resume*; a manual
      // click of "Use Browser Location" always still attempts it.
      if (navigator.permissions?.query) {
        navigator.permissions
          .query({ name: "geolocation" })
          .then((status) => {
            if (status.state !== "denied") handleUseBrowserLocation();
          })
          .catch(() => handleUseBrowserLocation());
      } else {
        handleUseBrowserLocation();
      }
    } else if (savedSource === "zip" && savedZip && isValidZip(savedZip)) {
      setSource("zip");
      performZipLookup(savedZip);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
    <div className="frtcon-app-root app-page">
      <SnowOverlay count={snowCount} />

      <div className="app-wrap">
        <div className="app-header">
          <div className="header-top-row">
            <h1 className="app-title">What&apos;s my French Toast condition?</h1>

            <div className="menu-button-wrap">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                className="menu-button"
              >
                <span className="menu-icon">{menuOpen ? "\u2715" : "\u2630"}</span>
              </button>

              {menuOpen ? (
                <>
                  {/* Invisible click-catcher so tapping anywhere outside the
                      menu closes it, same pattern as the modal overlays. */}
                  <div onClick={() => setMenuOpen(false)} className="menu-backdrop" />
                  <div ref={dropdownRef} className="dropdown-menu">
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        setMenuOpen(false);
                        setRecipeOpen(true);
                      }}
                    >
                      French Toast Recipe
                    </button>

                    {!isStandalone && installPromptEvent ? (
                      <button type="button" className="dropdown-item" onClick={handleInstallClick}>
                        Install App
                      </button>
                    ) : null}

                    {!isStandalone && isIOS ? (
                      <button
                        type="button"
                        className="dropdown-item"
                        onClick={() => {
                          setMenuOpen(false);
                          setIosHelpOpen(true);
                        }}
                      >
                        Add to Home Screen
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="app-subtitle">
            Check active winter alerts for your area and see your current French Toast Condition.
          </div>
        </div>

        <IOSInstallHelp
          open={iosHelpOpen}
          onClose={() => setIosHelpOpen(false)}
          returnFocusRef={menuButtonRef}
        />

        <div className="card section-spacing">
          <h2 className="card-title">Lookup a Location</h2>
          <div className="button-row">
            <button className="btn-primary" onClick={handleUseBrowserLocation} disabled={loading}>
              {loading && source === "browser" ? "Looking up..." : "Use Browser Location"}
            </button>

            <form onSubmit={handleZipLookup} className="button-row">
              <label htmlFor="frtcon-zip-input" className="visually-hidden-label">
                ZIP code
              </label>
              <input
                id="frtcon-zip-input"
                className="zip-input"
                type="text"
                inputMode="numeric"
                placeholder="Enter ZIP code"
                aria-label="ZIP code"
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              />
              <button className="btn-secondary" type="submit" disabled={loading}>
                {loading && source === "zip" ? "Looking up..." : "Search ZIP"}
              </button>
              {source === "url" && URL_LOCATION ? (
                <span className="custom-location-note">
                  Using Lat: {URL_LOCATION.lat} Lon: {URL_LOCATION.lon}
                </span>
              ) : null}
            </form>
          </div>

          {statusMessage ? <div className="status-box">{statusMessage}</div> : null}
          {error ? <div className="error-box">{error}</div> : null}
        </div>

        {result && frtcon ? (
          <div className="section-stack">
            <div className="card section-spacing">
              <div className="frtcon-status-row">
                <FrtconBadge level={frtcon.level} />
                <span className="alert-tag">
                  {result.alerts.length} alert{result.alerts.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="share-fb-button"
                  onClick={handleShare}
                  aria-label="Share on Facebook"
                >
                  <svg className="share-fb-icon" viewBox="0 0 320 512" aria-hidden="true" focusable="false">
                    <path
                      fill="currentColor"
                      d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z"
                    />
                  </svg>
                  <svg
                    className="share-fb-arrow"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M4 17v-3a4 4 0 0 1 4-4h11" />
                    <path d="M14 5l5 5-5 5" />
                  </svg>
                  <span className="share-fb-label">Share</span>
                </button>

                {/* At FRTCON 1-2 (stay home), a nudge to the recipe -- the
                    same pill soupcon.org shows for its soup of the day.
                    Focus returns here when the recipe closes
                    (useModalBehavior restores the opener). */}
                {frtcon.level <= 2 ? (
                  <button type="button" className="french-toast-pill" onClick={() => setRecipeOpen(true)}>
                    Lets make French Toast!
                  </button>
                ) : null}

                {/* Cross-link to soupcon.org, the rain-focused sibling app,
                    when a flood-family alert is active -- the mirror of its
                    own "check your FRTCON" link on snow. Not part of the
                    score. */}
                {result.alerts.some(isRainAlert) ? (
                  <a
                    href="https://soupcon.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="soupcon-crosslink-pill"
                  >
                    Rain alert, check your SOUPCON!
                  </a>
                ) : null}
              </div>

              {shareToast ? (
                <span className="share-toast" role="status" aria-live="polite">
                  {shareToast}
                </span>
              ) : null}

              <FrtconMessage
                level={frtcon.level}
                zoneName={result.zone.zoneName}
                headline={frtconMessage.headline}
                title={frtconMessage.title}
                lines={frtconMessage.lines}
              />

              <div className="frtcon-title-large">{frtcon.title}</div>
              <p className="body-text">{frtcon.reason}</p>

              {result.fetchedAt ? (
                <div className="frtcon-updated-at">
                  Updated{" "}
                  {new Date(result.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </div>
              ) : null}

              {frtcon.forecastDriven && outlook ? (
                <div className="frtcon-matching-alerts">
                  <div className="frtcon-matching-alerts-title">Forecast driving the score</div>
                  <div>
                    {outlook.totals.snow > 0 ? <span className="alert-tag">Snow: {formatSnow(outlook.totals.snow)} in 48 hours</span> : null}
                    {outlook.totals.ice > 0 ? <span className="alert-tag">Ice: {formatIce(outlook.totals.ice)} in 48 hours</span> : null}
                  </div>
                </div>
              ) : null}

              {frtcon.matchingAlerts.length > 0 ? (
                <div className="frtcon-matching-alerts">
                  <div className="frtcon-matching-alerts-title">Winter alerts driving the score</div>
                  <div>
                    {frtcon.matchingAlerts.map(({ alert, classification }) => (
                      <span key={alert.id} className="alert-tag">
                        {classification.label}: {alert.properties.event}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <div className="active-alerts-heading">Active Alerts</div>
              {result.alerts.length === 0 ? (
                <div className="card">No active alerts were returned for this location.</div>
              ) : (
                result.alerts.map((feature) => <AlertCard key={feature.id} feature={feature} />)
              )}

              <WinterOutlookPanel outlook={outlook} error={result.outlookError} />
            </div>
          </div>
        ) : null}

        {/* Always shown, so it sits at the bottom of the page whether or
            not a lookup has run. */}
        <div className="card contact-card">
          <p className="body-text">
            If you like the site, let me know! If you find a bug, tell me!{" "}
            <a href="mailto:contact@frtcon.com">contact@frtcon.com</a>
          </p>
        </div>

        <PrivacyNote />
      </div>
    </div>

    <RecipeModal
      open={recipeOpen}
      onClose={() => setRecipeOpen(false)}
      returnFocusRef={menuButtonRef}
    />
    </>
  );
}
