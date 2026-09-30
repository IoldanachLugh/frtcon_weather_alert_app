import { describe, it, expect } from "vitest";
import { gridPeriods, buildOutlook, formatSnow, formatIce, OUTLOOK_HOURS, precipTypeOf, precipChanceByCategory, listWords } from "./winterOutlook";

const HOUR = 3600 * 1000;
// 2026-10-01 10:25 UTC -- mid-hour, so the window starts at 10:00.
const NOW = Date.parse("2026-10-01T10:25:00Z");
const T10 = Date.parse("2026-10-01T10:00:00Z");

function raw({ temperature = [], pop = [], snow = [], ice = [], weather = [], tempUom = "wmoUnit:degC" } = {}) {
  return {
    weather: { uom: null, values: weather },
    temperature: { uom: tempUom, values: temperature },
    probabilityOfPrecipitation: { uom: "wmoUnit:percent", values: pop },
    snowfallAmount: { uom: "wmoUnit:mm", values: snow },
    iceAccumulation: { uom: "wmoUnit:mm", values: ice },
  };
}

describe("gridPeriods", () => {
  it("parses start and duration, including days", () => {
    expect(
      gridPeriods([
        { validTime: "2026-10-01T10:00:00+00:00/PT6H", value: 5 },
        { validTime: "2026-10-01T16:00:00+00:00/P1DT2H", value: null },
      ])
    ).toEqual([
      { start: T10, end: T10 + 6 * HOUR, value: 5 },
      { start: T10 + 6 * HOUR, end: T10 + 32 * HOUR, value: null },
    ]);
  });

  it("skips unparseable entries", () => {
    expect(gridPeriods([{ validTime: "garbage" }, { validTime: "2026-10-01T10:00:00Z/PT0H", value: 1 }, null])).toEqual([]);
    expect(gridPeriods(undefined)).toEqual([]);
  });
});

describe("buildOutlook", () => {
  it("covers 48 hours starting at the current hour", () => {
    const outlook = buildOutlook(raw(), NOW);
    expect(outlook.times).toHaveLength(OUTLOOK_HOURS);
    expect(outlook.times[0]).toBe(T10 / 1000);
    expect(outlook.times[47]).toBe((T10 + 47 * HOUR) / 1000);
  });

  it("repeats level values across their interval and converts °C to °F", () => {
    const outlook = buildOutlook(
      raw({
        temperature: [
          { validTime: "2026-10-01T09:00:00+00:00/PT3H", value: 0 },
          { validTime: "2026-10-01T12:00:00+00:00/PT1H", value: -10 },
        ],
        pop: [{ validTime: "2026-10-01T10:00:00+00:00/PT2H", value: 40 }],
      }),
      NOW
    );
    expect(outlook.temperatureF.slice(0, 4)).toEqual([32, 32, 14, null]);
    expect(outlook.precipChance.slice(0, 3)).toEqual([40, 40, null]);
  });

  it("passes °F through unchanged", () => {
    const outlook = buildOutlook(raw({ tempUom: "wmoUnit:degF", temperature: [{ validTime: "2026-10-01T10:00:00+00:00/PT1H", value: 20 }] }), NOW);
    expect(outlook.temperatureF[0]).toBe(20);
  });

  it("gives every hour of an amount period that period's total, not a multiple of it", () => {
    const outlook = buildOutlook(
      raw({
        snow: [
          { validTime: "2026-10-01T12:00:00+00:00/PT6H", value: 25.4 },
          { validTime: "2026-10-01T18:00:00+00:00/PT6H", value: 0 },
        ],
      }),
      NOW
    );
    // 10:00 and 11:00 have no snow period; 12:00-17:00 each show the 1 in block.
    expect(outlook.snowIn.slice(0, 9)).toEqual([null, null, 1, 1, 1, 1, 1, 1, 0]);
    expect(outlook.snowPeriod[2]).toMatchObject({ start: T10 + 2 * HOUR, end: T10 + 8 * HOUR, inches: 1 });
    expect(outlook.totals.snow).toBe(1);
  });

  it("totals only the periods overlapping the window, counting a partly past one whole", () => {
    const outlook = buildOutlook(
      raw({
        snow: [
          { validTime: "2026-10-01T00:00:00+00:00/PT6H", value: 50.8 }, // ended at 06:00, before the window
          { validTime: "2026-10-01T06:00:00+00:00/PT6H", value: 12.7 }, // started before now, still running
          { validTime: "2026-10-03T06:00:00+00:00/PT6H", value: 25.4 }, // 44h in, overlaps the end
          { validTime: "2026-10-03T12:00:00+00:00/PT6H", value: 25.4 }, // starts after the window
        ],
        ice: [{ validTime: "2026-10-01T12:00:00+00:00/PT6H", value: 2.54 }],
      }),
      NOW
    );
    expect(outlook.snowPeriods.map((period) => period.inches)).toEqual([0.5, 1]);
    expect(outlook.totals.snow).toBeCloseTo(1.5);
    expect(outlook.totals.ice).toBeCloseTo(0.1);
    expect(outlook.iceIn[2]).toBeCloseTo(0.1);
  });

  it("reports whether there's any data at all", () => {
    expect(buildOutlook(raw(), NOW).hasData).toBe(false);
    expect(buildOutlook(undefined, NOW).hasData).toBe(false);
    expect(buildOutlook(raw({ pop: [{ validTime: "2026-10-01T10:00:00+00:00/PT1H", value: 0 }] }), NOW).hasData).toBe(true);
  });
});

describe("formatting", () => {
  it("rounds snow to tenths and ice to hundredths", () => {
    expect(formatSnow(0.8)).toBe("0.8 in");
    expect(formatIce(0.1)).toBe("0.10 in");
    expect(formatSnow(null)).toBe("n/a");
  });
});

function conditions(...types) {
  return types.map((weather) => ({ coverage: "chance", weather, intensity: "light" }));
}

describe("precipTypeOf", () => {
  it.each([
    [["rain"], "rain"],
    [["rain_showers"], "rain"],
    [["drizzle"], "rain"],
    [["thunderstorms"], "rain"],
    [["hail"], "rain"],
    [["snow"], "snow"],
    [["snow_showers"], "snow"],
    [["freezing_rain"], "ice"],
    [["freezing_drizzle"], "ice"],
    [["sleet"], "ice"],
  ])("%j -> %s", (types, category) => {
    expect(precipTypeOf(conditions(...types)).category).toBe(category);
  });

  it("colors a mix by its most hazardous type and lists every type once", () => {
    expect(precipTypeOf(conditions("rain", "snow"))).toEqual({ category: "snow", words: ["rain", "snow"] });
    expect(precipTypeOf(conditions("snow", "sleet", "rain", "snow")).category).toBe("ice");
    expect(precipTypeOf(conditions("snow", "sleet", "rain", "snow")).words).toEqual(["snow", "sleet", "rain"]);
  });

  it("ignores non-precipitation weather and empty periods", () => {
    expect(precipTypeOf(conditions("fog", "blowing_snow", "frost", "haze"))).toBeNull();
    expect(precipTypeOf([{ coverage: null, weather: null, intensity: null }])).toBeNull();
    expect(precipTypeOf(null)).toBeNull();
  });
});

describe("precipitation type in buildOutlook", () => {
  it("assigns each hour its period's type", () => {
    const outlook = buildOutlook(
      raw({
        weather: [
          { validTime: "2026-10-01T10:00:00+00:00/PT2H", value: conditions("rain") },
          { validTime: "2026-10-01T12:00:00+00:00/PT1H", value: conditions("rain", "snow") },
        ],
      }),
      NOW
    );
    expect(outlook.precipType.slice(0, 4).map((t) => t?.category ?? null)).toEqual(["rain", "rain", "snow", null]);
    expect(outlook.precipType[2].words).toEqual(["rain", "snow"]);
  });
});

describe("precipChanceByCategory", () => {
  // A hand-built outlook: 6 hours, chance and category per hour.
  function outlookOf(chances, categories) {
    return {
      times: chances.map((_, i) => i),
      precipChance: chances,
      precipType: categories.map((category) => (category ? { category, words: [category] } : null)),
    };
  }

  it("puts each hour in its type's series and closes each run on the next hour", () => {
    const series = precipChanceByCategory(outlookOf([20, 30, 60, 60, 0, 0], ["rain", "rain", "snow", "snow", null, null]));
    expect(series.rain).toEqual([20, 30, 30, null, null, null]);
    expect(series.snow).toEqual([null, null, 60, 60, 60, null]);
    expect(series.none).toEqual([null, null, null, null, 0, 0]);
    expect(series.ice).toEqual([null, null, null, null, null, null]);
  });

  it("doesn't join a run across a single hour of another type", () => {
    const series = precipChanceByCategory(outlookOf([40, 50, 40, 40, 40, 40], ["rain", "snow", "rain", "rain", "rain", "rain"]));
    // Rain's first hour isn't closed (that point would join it to the rain
    // resuming at hour 2), so it draws as a one-hour gap; snow is closed.
    expect(series.rain).toEqual([40, null, 40, 40, 40, 40]);
    expect(series.snow).toEqual([null, 50, 50, null, null, null]);
  });

  it("leaves missing chances out entirely", () => {
    const series = precipChanceByCategory(outlookOf([null, 10, null, null, null, null], [null, "rain", null, null, null, null]));
    expect(series.rain).toEqual([null, 10, 10, null, null, null]);
    expect(series.none.every((v) => v == null)).toBe(true);
  });
});

describe("listWords", () => {
  it("joins with commas and a final 'and'", () => {
    expect(listWords(["rain"])).toBe("rain");
    expect(listWords(["rain", "snow"])).toBe("rain and snow");
    expect(listWords(["freezing rain", "sleet", "snow"])).toBe("freezing rain, sleet and snow");
    expect(listWords([])).toBe("");
  });
});
