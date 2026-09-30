// Chart data for the 48-hour winter outlook (WinterOutlookPanel). Pure
// functions, no uPlot/DOM dependency, so they're unit-testable like
// frtcon.js. Display only: the FRTCON level comes from NWS alerts, never
// from these numbers.
//
// Input is getWinterOutlook's raw gridpoint layers. Each layer's values are
// ISO 8601 intervals: "2026-10-01T12:00:00+00:00/PT6H" = this value for 6
// hours from 12:00 UTC. Two kinds, handled differently:
//   - Levels (temperature, chance of precipitation): the value holds for
//     every hour of the interval, so it's repeated per hour.
//   - Amounts (snowfall, ice accumulation): the value is the TOTAL for the
//     interval (NWS uses 6-hour blocks). Repeating it per hour would
//     multiply it, and dividing it into hourly slices would invent a timing
//     NWS doesn't forecast -- so each hour carries its period's total, and
//     the chart draws that as one block spanning the period.
export const OUTLOOK_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;
const MM_PER_INCH = 25.4;

// "P1DT12H" -> 36. Minutes/seconds aren't used by NWS grid data; an
// interval with none of D/H parses as 0 hours and is skipped.
function durationHours(text) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text ?? "");
  if (!match) return 0;
  return Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0);
}

// { start, end, value } per interval (ms), unparseable entries skipped.
// `value` is kept as given: a number for most layers, an array of
// conditions for the `weather` layer.
export function gridPeriods(values) {
  const periods = [];
  for (const entry of values ?? []) {
    const [startText, durationText] = String(entry?.validTime ?? "").split("/");
    const start = Date.parse(startText);
    const hours = durationHours(durationText);
    if (Number.isNaN(start) || hours <= 0) continue;
    periods.push({ start, end: start + hours * HOUR_MS, value: entry.value ?? null });
  }
  return periods;
}

function toFahrenheit(value, uom) {
  if (value == null) return null;
  return uom === "wmoUnit:degF" ? value : (value * 9) / 5 + 32;
}

function toInches(value, uom) {
  if (value == null) return null;
  if (uom === "wmoUnit:in") return value;
  if (uom === "wmoUnit:cm") return (value * 10) / MM_PER_INCH;
  return value / MM_PER_INCH; // wmoUnit:mm, NWS's normal unit
}

// NWS `weather` layer types (the full enum from api.weather.gov's OpenAPI
// spec) that are precipitation, grouped the way the chart colors them.
// Everything else in that enum -- fog, frost, haze, smoke, blowing snow or
// dust, freezing spray, ice crystals, ice fog, water spouts, volcanic ash --
// isn't something falling out of the sky in a measurable way, so it's
// ignored here. Hail and thunderstorms count as rain.
const PRECIP_TYPES = {
  freezing_rain: { category: "ice", word: "freezing rain" },
  freezing_drizzle: { category: "ice", word: "freezing drizzle" },
  sleet: { category: "ice", word: "sleet" },
  snow: { category: "snow", word: "snow" },
  snow_showers: { category: "snow", word: "snow showers" },
  rain: { category: "rain", word: "rain" },
  rain_showers: { category: "rain", word: "rain showers" },
  drizzle: { category: "rain", word: "drizzle" },
  thunderstorms: { category: "rain", word: "thunderstorms" },
  hail: { category: "rain", word: "hail" },
};

// When NWS expects more than one type in a period, the block takes the
// color of the most hazardous (the FRTCON order: ice, then snow, then
// rain); the readout and table list every type.
export const PRECIP_CATEGORIES = ["ice", "snow", "rain"];

// One `weather` period's conditions -> { category, words }, or null if it
// has no precipitation types.
export function precipTypeOf(conditions) {
  const found = (Array.isArray(conditions) ? conditions : [])
    .map((condition) => PRECIP_TYPES[condition?.weather])
    .filter(Boolean);
  if (found.length === 0) return null;
  const category = PRECIP_CATEGORIES.find((c) => found.some((type) => type.category === c));
  return { category, words: [...new Set(found.map((type) => type.word))] };
}

function periodAt(periods, ms) {
  return periods.find((period) => period.start <= ms && ms < period.end) ?? null;
}

// The 48 hourly slots, starting at the current hour, in uPlot's column
// format (x in seconds, null = no data, drawn as a gap). `snowPeriod` /
// `icePeriod` are each hour's covering period, for the hover readout and
// table view. `snowPeriods` / `icePeriods` are the amount periods that
// overlap the window, in inches; `totals` sums them. A period that started
// before the current hour is counted whole, since NWS gives no split within
// it, so the total can include a few hours that have already passed.
export function buildOutlook(raw, now = Date.now()) {
  const windowStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  const windowEnd = windowStart + OUTLOOK_HOURS * HOUR_MS;

  const temperature = gridPeriods(raw?.temperature?.values);
  const precip = gridPeriods(raw?.probabilityOfPrecipitation?.values);
  const weather = gridPeriods(raw?.weather?.values);
  const amountPeriods = (layer) =>
    gridPeriods(raw?.[layer]?.values)
      .filter((period) => period.end > windowStart && period.start < windowEnd)
      .map((period) => ({ ...period, inches: toInches(period.value, raw[layer].uom) }));
  const snowPeriods = amountPeriods("snowfallAmount");
  const icePeriods = amountPeriods("iceAccumulation");

  const hours = Array.from({ length: OUTLOOK_HOURS }, (_, i) => windowStart + i * HOUR_MS);
  const snowPeriod = hours.map((ms) => periodAt(snowPeriods, ms));
  const icePeriod = hours.map((ms) => periodAt(icePeriods, ms));
  const sum = (periods) => periods.reduce((total, period) => total + (period.inches ?? 0), 0);

  const temperatureF = hours.map((ms) => toFahrenheit(periodAt(temperature, ms)?.value ?? null, raw?.temperature?.uom));
  const precipChance = hours.map((ms) => periodAt(precip, ms)?.value ?? null);
  const snowIn = snowPeriod.map((period) => period?.inches ?? null);
  const iceIn = icePeriod.map((period) => period?.inches ?? null);
  const precipType = hours.map((ms) => precipTypeOf(periodAt(weather, ms)?.value));
  const hasValue = (series) => series.some((value) => value != null);

  return {
    times: hours.map((ms) => ms / 1000),
    temperatureF,
    precipChance,
    precipType,
    snowIn,
    iceIn,
    snowPeriod,
    icePeriod,
    snowPeriods,
    icePeriods,
    totals: { snow: sum(snowPeriods), ice: sum(icePeriods) },
    // False when NWS returned no usable values at all for the window, so the
    // panel can say so instead of drawing three empty charts.
    hasData: [temperatureF, precipChance, snowIn, iceIn].some(hasValue),
  };
}

// The chance-of-precipitation chart draws one series per type so each can
// have its own color: { ice, snow, rain, none }, each with that type's
// hours filled in and null elsewhere ("none" = no type given, e.g. a 0%
// hour). The chart draws stepped blocks, where a value at hour i spans to
// hour i+1 -- so the hour after each run also gets the run's last value,
// closing its block; otherwise every run would end an hour early, leaving
// a gap before the next type starts.
export function precipChanceByCategory(outlook) {
  const series = Object.fromEntries([...PRECIP_CATEGORIES, "none"].map((c) => [c, outlook.times.map(() => null)]));
  outlook.precipChance.forEach((chance, i) => {
    if (chance == null) return;
    const category = outlook.precipType[i]?.category ?? "none";
    series[category][i] = chance;
    const next = i + 1;
    if (next >= outlook.times.length) return;
    const categoryAt = (j) => (outlook.precipChance[j] == null ? null : outlook.precipType[j]?.category ?? "none");
    // Close the block unless this type continues next hour anyway -- or
    // resumes the hour after, where a closing point would join the two runs
    // straight across the other type's hour (a one-hour gap is the lesser
    // evil there).
    if (categoryAt(next) !== category && categoryAt(next + 1) !== category) series[category][next] = chance;
  });
  return series;
}

// "rain and snow", "freezing rain, sleet and snow".
export function listWords(words) {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// Display rounding: snow to 0.1 in, ice to 0.01 in (a tenth of an inch of
// ice is already significant; the same rounding would show it as 0.1).
export function formatSnow(inches) {
  return inches == null ? "n/a" : `${inches.toFixed(1)} in`;
}

export function formatIce(inches) {
  return inches == null ? "n/a" : `${inches.toFixed(2)} in`;
}
