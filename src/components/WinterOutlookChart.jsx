import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatIce, formatSnow, listWords, precipChanceByCategory } from "../lib/winterOutlook";

// The 48-hour winter outlook: three small charts stacked on one shared time
// axis (snow & ice, temperature, chance of precipitation), since the three
// measures have different units and a dual-axis chart would mislead. Hover
// is synced across all three and read out in one line above them. Loaded
// lazily by WinterOutlookPanel (React.lazy), so uPlot is only downloaded
// once someone opens the panel. `outlook` comes from buildOutlook().
//
// Colors: the dataviz reference palette's first three dark-mode categorical
// slots, validated against the card surface #122b4d with every pair checked
// (they can sit next to each other in any order): blue = snow, orange = ice
// (freezing rain, freezing drizzle, sleet), aqua = rain -- the same meaning
// in both charts that use them. Blue is also the temperature line. Gray
// (4.2:1 on the card) = chance of precipitation with no type given. Text
// and grid use the alert cards' existing text color.
const BLUE = "#3987e5";
const BLUE_FILL = "rgba(57, 135, 229, 0.35)";
const ORANGE = "#d95926";
const ORANGE_FILL = "rgba(217, 89, 38, 0.35)";
const AQUA = "#199e70";
const AQUA_FILL = "rgba(25, 158, 112, 0.35)";
const GRAY = "#7d8ca3";
const GRAY_FILL = "rgba(125, 140, 163, 0.25)";
const TEXT_COLOR = "#c8d7ea";
const GRID_COLOR = "rgba(200, 215, 234, 0.12)";
// Same y-axis width and padding on all three charts, so their plot areas
// line up and one hour sits at the same x in each. The right padding also
// leaves room for the bottom chart's last time label, which uPlot would
// otherwise make room for by narrowing only that chart.
const Y_AXIS_WIDTH = 52;
const PADDING = [8, 28, 0, 0];
// Charts without the time axis need a little room below for their "0" label.
const PADDING_NO_TIME_AXIS = [8, 28, 8, 0];
const SYNC_KEY = "frtcon-outlook";
const FREEZING_F = 32;

// Amounts are NWS period totals: hold each value until the next hour's
// point, so a 6-hour period draws as one flat block across its span.
const blocks = uPlot.paths.stepped({ align: 1 });

function dayTime(seconds) {
  return new Date(seconds * 1000).toLocaleString([], { weekday: "short", hour: "numeric" });
}

function periodRange(period) {
  if (!period) return "";
  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric" });
  return `${time(period.start)}-${time(period.end)}`;
}

// Dashed reference line at 32°F, labeled, so it reads as "freezing" rather
// than a stray gridline.
function freezingLine(u) {
  const y = Math.round(u.valToPos(FREEZING_F, "y", true));
  const { top, height, left, width } = u.bbox;
  if (y < top || y > top + height) return;
  const ratio = window.devicePixelRatio || 1;
  const { ctx } = u;
  ctx.save();
  ctx.strokeStyle = TEXT_COLOR;
  ctx.lineWidth = ratio;
  ctx.setLineDash([4 * ratio, 4 * ratio]);
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(left + width, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `${11 * ratio}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("32°F freezing", left + width - 4 * ratio, y - 2 * ratio);
  ctx.restore();
}

function axis(extra = {}) {
  return {
    stroke: TEXT_COLOR,
    grid: { stroke: GRID_COLOR, width: 1 },
    ticks: { stroke: GRID_COLOR, width: 1 },
    font: "12px Arial, Helvetica, sans-serif",
    ...extra,
  };
}

function yAxis(format) {
  return axis({ size: Y_AXIS_WIDTH, values: (_u, splits) => splits.map(format) });
}

function baseOptions(width, height, onCursor, showTimeAxis) {
  return {
    width,
    height,
    padding: showTimeAxis ? PADDING : PADDING_NO_TIME_AXIS,
    legend: { show: false },
    cursor: {
      y: false,
      drag: { x: false, y: false },
      sync: { key: SYNC_KEY },
      points: { size: 8 },
    },
    hooks: { setCursor: [(u) => onCursor(u.cursor.idx ?? null)] },
    // The upper charts keep the time gridlines (to read across to the
    // labels on the bottom chart) but draw no labels or ticks of their own.
    axes: [
      showTimeAxis
        ? axis({ values: (_u, splits) => splits.map(dayTime), space: 70 })
        : axis({ values: (_u, splits) => splits.map(() => ""), space: 70, size: 0, ticks: { show: false } }),
    ],
  };
}

function snowOptions(width, onCursor, outlook) {
  const max = Math.max(...outlook.snowIn.map((v) => v ?? 0), ...outlook.iceIn.map((v) => v ?? 0));
  const base = baseOptions(width, 110, onCursor, false);
  return {
    ...base,
    scales: { x: { time: true }, y: { range: [0, Math.max(1, Math.ceil(max * 1.15 * 2) / 2)] } },
    series: [
      {},
      { label: "Snow", stroke: BLUE, fill: BLUE_FILL, width: 2, paths: blocks, points: { show: false } },
      // No ice forecast: hide the series rather than draw an orange line
      // along zero over the snow's baseline (the legend says "none").
      { label: "Ice", show: outlook.totals.ice > 0, stroke: ORANGE, fill: ORANGE_FILL, width: 2, paths: blocks, points: { show: false } },
    ],
    axes: [...base.axes, yAxis((v) => `${v} in`)],
  };
}

function temperatureOptions(width, onCursor) {
  const base = baseOptions(width, 110, onCursor, false);
  return {
    ...base,
    scales: {
      x: { time: true },
      // Always keep 32°F in view, so the freezing line is there to compare to.
      y: {
        range: (_u, min, max) => [
          Math.floor(Math.min(min ?? FREEZING_F, FREEZING_F) - 5),
          Math.ceil(Math.max(max ?? FREEZING_F, FREEZING_F) + 5),
        ],
      },
    },
    series: [{}, { label: "Temperature", stroke: BLUE, width: 2, points: { show: false } }],
    axes: [...base.axes, yAxis((v) => `${v}°`)],
    hooks: { ...base.hooks, draw: [freezingLine] },
  };
}

// One series per precipitation type (see precipChanceByCategory), in the
// same order as its data columns below.
const PRECIP_SERIES = [
  { key: "rain", label: "Rain", stroke: AQUA, fill: AQUA_FILL },
  { key: "snow", label: "Snow", stroke: BLUE, fill: BLUE_FILL },
  // Covers freezing rain and freezing drizzle too; "Sleet" keeps the legend
  // short (per owner). The readout still names the exact types.
  { key: "ice", label: "Sleet", stroke: ORANGE, fill: ORANGE_FILL },
  { key: "none", label: "Unspecified", stroke: GRAY, fill: GRAY_FILL },
];

function precipOptions(width, onCursor) {
  const base = baseOptions(width, 140, onCursor, true);
  return {
    ...base,
    scales: { x: { time: true }, y: { range: [0, 100] } },
    series: [{}, ...PRECIP_SERIES.map(({ label, stroke, fill }) => ({ label, stroke, fill, width: 2, paths: blocks, points: { show: false } }))],
    axes: [...base.axes, { ...yAxis((v) => `${v}%`), splits: () => [0, 50, 100] }],
  };
}

// One line describing the hovered hour across all three charts.
function Readout({ outlook, idx }) {
  if (idx == null) {
    return <p className="outlook-readout">Hover over or tap the charts for each hour&apos;s values.</p>;
  }
  const temp = outlook.temperatureF[idx];
  const chance = outlook.precipChance[idx];
  const words = outlook.precipType[idx]?.words;
  const snowPeriod = outlook.snowPeriod[idx];
  const icePeriod = outlook.icePeriod[idx];
  return (
    <p className="outlook-readout">
      <strong>{dayTime(outlook.times[idx])}:</strong> {temp == null ? "n/a" : `${Math.round(temp)}°F`}, {chance == null ? "n/a" : `${chance}%`} chance of{" "}
      {words ? listWords(words) : "precipitation"}. Snow {formatSnow(snowPeriod?.inches ?? null)}
      {snowPeriod ? ` (${periodRange(snowPeriod)})` : ""}
      {/* Ice gets its own period range: NWS's snow and ice periods don't
          have to line up. */}
      {icePeriod?.inches ? `, ice ${formatIce(icePeriod.inches)} (${periodRange(icePeriod)})` : ""}.
    </p>
  );
}

// Swatch colors live in styles.css (.outlook-swatch--snow/--ice), matching
// BLUE/ORANGE above.
function Legend({ items }) {
  return (
    <div className="outlook-legend">
      {items.map(({ swatch, label }) => (
        <span key={swatch} className="outlook-legend-item">
          <span className={`outlook-swatch outlook-swatch--${swatch}`} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

export default function WinterOutlookChart({ outlook }) {
  const snowRef = useRef(null);
  const tempRef = useRef(null);
  const precipRef = useRef(null);
  const [idx, setIdx] = useState(null);

  useEffect(() => {
    const els = [snowRef.current, tempRef.current, precipRef.current];
    if (els.some((el) => !el)) return undefined;
    const width = els[0].clientWidth;
    const { times } = outlook;
    const precipByType = precipChanceByCategory(outlook);
    const plots = [
      new uPlot(snowOptions(width, setIdx, outlook), [times, outlook.snowIn, outlook.iceIn], els[0]),
      new uPlot(temperatureOptions(width, setIdx), [times, outlook.temperatureF], els[1]),
      new uPlot(precipOptions(width, setIdx), [times, ...PRECIP_SERIES.map(({ key }) => precipByType[key])], els[2]),
    ];
    // Follow the card's width (phone rotation, window resizes).
    const observer = new ResizeObserver(() => {
      const next = els[0].clientWidth;
      if (next > 0) plots.forEach((plot) => plot.setSize({ width: next, height: plot.height }));
    });
    observer.observe(els[0]);
    return () => {
      observer.disconnect();
      plots.forEach((plot) => plot.destroy());
    };
  }, [outlook]);

  return (
    <div className="outlook-chart">
      <Readout outlook={outlook} idx={idx} />
      <div className="outlook-chart-title">
        Snow &amp; ice, per NWS forecast period (inches)
        <Legend
          items={[
            { swatch: "snow", label: "Snow" },
            { swatch: "ice", label: outlook.totals.ice > 0 ? "Ice" : "Ice (none forecast)" },
          ]}
        />
      </div>
      <div ref={snowRef} />
      <div className="outlook-chart-title">Temperature (°F)</div>
      <div ref={tempRef} />
      <div className="outlook-chart-title">
        Chance of precipitation, by expected type
        {/* "Unspecified" only when some hour needs it. */}
        <Legend
          items={PRECIP_SERIES.filter(
            ({ key }) => key !== "none" || outlook.precipChance.some((chance, i) => chance != null && !outlook.precipType[i])
          ).map(({ key, label }) => ({ swatch: key, label }))}
        />
      </div>
      <div ref={precipRef} />
    </div>
  );
}
