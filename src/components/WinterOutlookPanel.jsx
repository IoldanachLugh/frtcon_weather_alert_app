import { lazy, Suspense, useState } from "react";
import { FORECAST_SNOW_MIN_IN } from "../lib/frtcon";
import { formatIce, formatSnow, listWords, OUTLOOK_HOURS } from "../lib/winterOutlook";

// uPlot only downloads once someone opens the panel.
const WinterOutlookChart = lazy(() => import("./WinterOutlookChart"));

// Collapsible "48-hour winter outlook" under the alerts: NWS's gridpoint
// forecast for snow, ice, temperature and chance of precipitation, so a
// visitor can see what's coming before (or without) any alert. App.jsx
// fetches it with every lookup/refresh (its totals can lift a no-alert
// FRTCON 5 to 4) and passes the built `outlook` (buildOutlook) or the
// fetch `error` in; this only displays it.
function dayTime(ms) {
  return new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric" });
}

function periodLabel(period) {
  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric" });
  return `${dayTime(period.start)} to ${time(period.end)}`;
}

function TotalsLine({ outlook }) {
  const { snow, ice } = outlook.totals;
  if (snow === 0 && ice === 0) {
    return <p className="outlook-totals">No snow or ice in the forecast for the next {OUTLOOK_HOURS} hours.</p>;
  }
  return (
    <p className="outlook-totals">
      Next {OUTLOOK_HOURS} hours: <strong>{formatSnow(snow)} of snow</strong>
      {ice > 0 ? (
        <>
          {" "}
          and <strong>{formatIce(ice)} of ice</strong>
        </>
      ) : null}
      .
    </p>
  );
}

// The chart's table view: the amount periods, then every hour.
function Details({ outlook }) {
  const amounts = [
    ...outlook.snowPeriods.filter((p) => p.inches > 0).map((p) => ({ ...p, text: `${formatSnow(p.inches)} snow` })),
    ...outlook.icePeriods.filter((p) => p.inches > 0).map((p) => ({ ...p, text: `${formatIce(p.inches)} ice` })),
  ].sort((a, b) => a.start - b.start);
  return (
    <details className="outlook-details">
      <summary>Details</summary>
      {amounts.length > 0 ? (
        <ul className="outlook-list">
          {amounts.map((p) => (
            <li key={`${p.start}-${p.text}`}>
              {periodLabel(p)}: {p.text}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="outlook-list">
        {outlook.times.map((seconds, i) => (
          <li key={seconds}>
            {dayTime(seconds * 1000)}: {outlook.temperatureF[i] == null ? "n/a" : `${Math.round(outlook.temperatureF[i])}°F`},{" "}
            {outlook.precipChance[i] == null ? "n/a" : `${outlook.precipChance[i]}%`} chance of{" "}
            {outlook.precipType[i] ? listWords(outlook.precipType[i].words) : "precipitation"}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function WinterOutlookPanel({ outlook, error }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="outlook nws-alert-card">
      <button
        type="button"
        className="outlook-toggle active-alerts-heading"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {/* One right-pointing triangle, rotated when open (see styles.css). */}
        <span className="outlook-marker" aria-hidden="true">
          {"▶"}
        </span>
        {OUTLOOK_HOURS}-hour winter outlook
      </button>

      {open ? (
        <div className="outlook-body">
          <p className="nws-alert-area-desc outlook-note">
            NWS forecast. Your FRTCON level comes from active alerts; this forecast only moves an all-clear FRTCON 5 up to 4, when{" "}
            {FORECAST_SNOW_MIN_IN} in or more of snow, or any ice, is forecast with no winter alert. Snow and ice are NWS&apos;s totals
            for each forecast period (usually 6 hours).
          </p>
          {error && !outlook ? <p className="nws-alert-description">Couldn&apos;t load the forecast. {error}</p> : null}
          {!outlook && !error ? <p className="nws-alert-description">Loading forecast...</p> : null}
          {outlook && !outlook.hasData ? (
            <p className="nws-alert-description">The weather service didn&apos;t return a forecast for this location.</p>
          ) : null}
          {outlook?.hasData ? (
            <>
              <TotalsLine outlook={outlook} />
              <Suspense fallback={<p className="nws-alert-description">Loading chart...</p>}>
                <WinterOutlookChart outlook={outlook} />
              </Suspense>
              <Details outlook={outlook} />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
