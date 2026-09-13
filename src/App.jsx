import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { isValidZip, getLatLonFromZip, getZoneByPoint, getActiveAlertsByZone, ALERTS_AUTO_REFRESH_MS } from "./lib/weatherApi";
import { safeGetItem, safeSetItem } from "./lib/cache";
import { determineFrtcon } from "./lib/frtcon";
import { SnowOverlay } from "./components/SnowOverlay";
import { FrtconBadge } from "./components/FrtconBadge";
import { FrtconMessage } from "./components/FrtconMessage";
import { AlertCard } from "./components/AlertCard";
import { RecipeModal } from "./components/RecipeModal";
import { IOSInstallHelp } from "./components/IOSInstallHelp";

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

  // iOS never fires beforeinstallprompt and never will (no such API exists
  // in WebKit) -- this is a one-time UA check, not something that changes
  // at runtime, so no need to re-derive it on every render.
  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
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
      // public_html/dev (for review) or gets promoted to public_html itself.
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

  const frtcon = useMemo(() => {
    return result?.alerts ? determineFrtcon(result.alerts) : null;
  }, [result]);

  const snowCount = frtcon
    ? {
        1: 140,
        2: 100,
        3: 65,
        4: 30,
        5: 8,
      }[frtcon.level] || 8
    : 8;

  const runLookupFromCoordinates = useCallback(async (lat, lon, inputSource, { skipCache = false } = {}) => {
    // Cancel any lookup still in flight so its result can't clobber this one.
    if (activeRequestRef.current) {
      activeRequestRef.current.abort();
    }
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const { signal } = controller;

    setLoading(true);
    setError("");

    try {
      const zone = await getZoneByPoint(lat, lon, { signal });
      const alerts = await getActiveAlertsByZone(zone.zoneId, { signal, skipCache });

      if (signal.aborted) return;

      setStatusMessage("");
      setResult({
        source: inputSource,
        zone,
        alerts,
      });
    } catch (err) {
      if (signal.aborted) return;
      setResult(null);
      setStatusMessage("");
      setError(err instanceof Error ? err.message : "Something went wrong during lookup.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  // Keep alerts fresh for whatever zone is currently displayed, without the
  // user needing to manually re-search. Deliberately bypasses the TTL cache
  // (skipCache: true below) rather than waiting for it to expire -- this is
  // live weather data, so every tick genuinely hits the network. Note this
  // interval (ALERTS_AUTO_REFRESH_MS) and the alerts cache TTL
  // (ALERTS_CACHE_TTL_MS in lib/cache.js) are independently defined but
  // currently equal; if either is ever tuned, check whether that's still
  // the intended relationship.
  useEffect(() => {
    if (!result?.zone?.zoneId) return;

    const intervalId = setInterval(() => {
      getActiveAlertsByZone(result.zone.zoneId, { skipCache: true })
        .then((alerts) => {
          setResult((prev) =>
            prev && prev.zone.zoneId === result.zone.zoneId ? { ...prev, alerts } : prev
          );
        })
        .catch(() => {
          // Silently ignore background refresh failures; the user still has
          // the last good data and can manually re-search if needed.
        });
    }, ALERTS_AUTO_REFRESH_MS);

    return () => clearInterval(intervalId);
  }, [result?.zone?.zoneId]);

  function handleUseBrowserLocation() {
    setSource("browser");
    setError("");
    setStatusMessage("Locating you... this can take a few seconds.");
    // Remember which method was used so a return visit can skip straight
    // to it instead of waiting for another button press.
    safeSetItem("frtcon_last_source", "browser");

    // Claim this lookup's sequence number now, before the (unabortable)
    // geolocation call even starts. If the user kicks off another lookup
    // (browser or ZIP) before this one resolves, requestSeqRef will have
    // moved on and the callbacks below will recognize themselves as stale.
    const mySeq = ++requestSeqRef.current;

    if (!navigator.geolocation) {
      setStatusMessage("");
      setError("This browser does not support geolocation. Try entering a ZIP code.");
      return;
    }

    setLoading(true);

    const onSuccess = async (position) => {
      if (mySeq !== requestSeqRef.current) return; // superseded by a newer lookup
      const lat = Number(position.coords.latitude.toFixed(4));
      const lon = Number(position.coords.longitude.toFixed(4));
      await runLookupFromCoordinates(lat, lon, "browser");
    };

    const onFinalError = (geoError) => {
      if (mySeq !== requestSeqRef.current) return; // superseded by a newer lookup
      setLoading(false);
      setStatusMessage("");

      if (geoError?.code === geoError?.PERMISSION_DENIED) {
        setError(
          "Location access is turned off for this site. On iPhone: tap the \"Aa\" icon in the address bar, " +
            "Website Settings, and set Location to Ask or Allow, then try again — or just enter a ZIP code below."
        );
        return;
      }

      const message = geoError?.message || "Unable to read browser location.";
      setError(`${message} Try entering a ZIP code instead.`);
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
          timeout: 30000,
          maximumAge: 0,
        });
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 600000,
      }
    );
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
        safeSetItem("frtcon_last_zip", zipValue);
        // Remember which method was used so a return visit can skip
        // straight to it instead of waiting for another button press.
        safeSetItem("frtcon_last_source", "zip");
        const location = await getLatLonFromZip(zipValue, { signal });
        if (signal.aborted || mySeq !== requestSeqRef.current) return;
        await runLookupFromCoordinates(location.lat, location.lon, "zip");
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

    const savedSource = safeGetItem("frtcon_last_source");
    if (savedSource === "browser") {
      handleUseBrowserLocation();
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
                  <div className="dropdown-menu">
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

        <IOSInstallHelp open={iosHelpOpen} onClose={() => setIosHelpOpen(false)} />

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
            </form>
          </div>

          {statusMessage ? <div className="status-box">{statusMessage}</div> : null}
          {error ? <div className="error-box">{error}</div> : null}
        </div>

        {result && frtcon ? (
          <div className="section-stack">
            <div className="card section-spacing">
              <h2 className="card-title">Current FRTCON</h2>
              <div className="frtcon-status-row">
                <FrtconBadge level={frtcon.level} />
                <span className="alert-tag">
                  {result.alerts.length} active alert{result.alerts.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="frtcon-title-large">{frtcon.title}</div>
              <p className="body-text">{frtcon.reason}</p>

              <FrtconMessage level={frtcon.level} zoneName={result.zone.zoneName} />

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
              <div className="active-alerts-heading">Active Zone Alerts</div>
              {result.alerts.length === 0 ? (
                <div className="card">No active alerts were returned for this zone.</div>
              ) : (
                result.alerts.map((feature) => <AlertCard key={feature.id} feature={feature} />)
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>

    <RecipeModal open={recipeOpen} onClose={() => setRecipeOpen(false)} />
    </>
  );
}
