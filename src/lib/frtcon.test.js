import { describe, it, expect } from "vitest";
import { classifyAlert, determineFrtcon, pickRandomItems } from "./frtcon";

function alert(event, description = "") {
  return { properties: { event, description } };
}

function levelOf(event, description) {
  return classifyAlert(alert(event, description))?.level ?? null;
}

describe("classifyAlert", () => {
  it.each([
    ["Blizzard Warning", 1],
    ["Ice Storm Warning", 1],
    ["Heavy Freezing Spray Warning", 1],
    ["Winter Storm Warning", 2],
    ["Lake Effect Snow Warning", 2],
    ["Snow Squall Warning", 2],
    ["Freezing Rain Warning", 2],
    ["Extreme Cold Warning", 2],
    ["Winter Weather Advisory", 3],
    ["Freezing Fog Advisory", 3],
    ["Freezing Rain Advisory", 3],
    ["Snow Advisory", 3],
    ["Blowing Snow Advisory", 3],
    ["Cold Weather Advisory", 3],
    ["Winter Storm Watch", 4],
    ["Blizzard Watch", 4],
    ["Lake Effect Snow Watch", 4],
    ["Ice Storm Watch", 4],
    ["Extreme Cold Watch", 4],
    ["Heavy Freezing Spray Watch", 4],
    ["Freeze Watch", 4],
    ["Frost Advisory", 4],
    ["Freeze Warning", 4],
  ])("%s -> level %i", (event, level) => {
    expect(levelOf(event)).toBe(level);
  });

  it("returns null for non-winter alerts", () => {
    expect(levelOf("Flash Flood Warning")).toBeNull();
    expect(levelOf("Heat Advisory")).toBeNull();
    expect(classifyAlert({})).toBeNull();
    expect(classifyAlert(null)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(levelOf("BLIZZARD WARNING")).toBe(1);
  });

  it("raises a Winter Storm Warning with significant ice to level 1", () => {
    expect(levelOf("Winter Storm Warning", "Heavy snow and SIGNIFICANT ICE accumulations expected.")).toBe(1);
  });

  it("only reads the description for that one case", () => {
    // A Watch whose narrative mentions a possible Warning stays a Watch.
    expect(levelOf("Winter Storm Watch", "A Blizzard Warning may be issued if conditions worsen.")).toBe(4);
    expect(levelOf("Winter Weather Advisory", "significant ice possible")).toBe(3);
  });

  it("matches regional variants of a base event name", () => {
    expect(levelOf("Hard Freeze Warning")).toBe(4);
    expect(levelOf("Hard Freeze Watch")).toBe(4);
  });
});

describe("determineFrtcon", () => {
  it("is level 5 with no alerts", () => {
    const result = determineFrtcon([]);
    expect(result.level).toBe(5);
    expect(result.title).toBe("No major winter storm alerts");
    expect(result.matchingAlerts).toEqual([]);
  });

  it("is level 5 when no alert is winter-related", () => {
    const result = determineFrtcon([alert("Flood Warning"), alert("Heat Advisory")]);
    expect(result.level).toBe(5);
    expect(result.title).toBe("Active alerts, but not winter storm alerts");
    expect(result.matchingAlerts).toEqual([]);
  });

  it("uses the most severe (lowest) level and lists matches most severe first", () => {
    const result = determineFrtcon([
      alert("Winter Storm Watch"),
      alert("Flood Warning"),
      alert("Blizzard Warning"),
      alert("Winter Weather Advisory"),
    ]);
    expect(result.level).toBe(1);
    expect(result.label).toBe("FRTCON 1");
    expect(result.matchingAlerts.map((m) => m.alert.properties.event)).toEqual([
      "Blizzard Warning",
      "Winter Weather Advisory",
      "Winter Storm Watch",
    ]);
  });

  // PLAN.md item 13: Frost Advisory and Freeze Warning sit at level 4, but a
  // more severe alert alongside them still wins.
  it("scores a lone Frost Advisory or Freeze Warning at level 4", () => {
    expect(determineFrtcon([alert("Frost Advisory")]).level).toBe(4);
    expect(determineFrtcon([alert("Freeze Warning")]).level).toBe(4);
  });

  it("lets a more severe alert outrank Frost Advisory / Freeze Warning", () => {
    expect(determineFrtcon([alert("Frost Advisory"), alert("Winter Weather Advisory")]).level).toBe(3);
    expect(determineFrtcon([alert("Freeze Warning"), alert("Winter Storm Warning")]).level).toBe(2);
  });
});

describe("pickRandomItems", () => {
  const items = ["a", "b", "c", "d", "e"];

  it("returns count unique items from the list", () => {
    const picked = pickRandomItems(items, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    picked.forEach((item) => expect(items).toContain(item));
  });

  it("returns every item when count exceeds the list length", () => {
    expect(pickRandomItems(items, 10).sort()).toEqual(items);
  });

  it("does not modify the input", () => {
    const copy = [...items];
    pickRandomItems(items, 3);
    expect(items).toEqual(copy);
  });
});

describe("determineFrtcon with a forecast", () => {
  it("raises a no-alert 5 to 4 for at least 1 in of forecast snow", () => {
    const result = determineFrtcon([], { snow: 1.0, ice: 0 });
    expect(result).toMatchObject({ level: 4, label: "FRTCON 4", forecastDriven: true, matchingAlerts: [] });
    expect(result.title).toBe("Snow in the forecast, no winter alerts yet");
    expect(result.reason).toBe("NWS forecasts 1.0 in of snow in the next 48 hours, but no winter weather alerts are active.");
  });

  it("compares snow at its displayed precision", () => {
    // 0.1 + 0.8 + 0.1 in, the way per-period totals actually sum in floats.
    expect(determineFrtcon([], { snow: 0.1 + 0.8 + 0.1 - 1e-12, ice: 0 }).level).toBe(4);
    expect(determineFrtcon([], { snow: 0.94, ice: 0 }).level).toBe(5);
    expect(determineFrtcon([], { snow: 0.95, ice: 0 }).level).toBe(4);
  });

  it("raises to 4 for any ice, and names both amounts", () => {
    const result = determineFrtcon([], { snow: 2.25, ice: 0.1 });
    expect(result.level).toBe(4);
    expect(result.title).toBe("Ice in the forecast, no winter alerts yet");
    expect(result.reason).toBe("NWS forecasts 2.3 in of snow and 0.10 in of ice in the next 48 hours, but no winter weather alerts are active.");
    expect(determineFrtcon([], { snow: 0, ice: 0.01 }).level).toBe(4);
    expect(determineFrtcon([], { snow: 0.5, ice: 0.004 }).level).toBe(5);
  });

  it("also raises when only non-winter alerts are active", () => {
    expect(determineFrtcon([alert("Special Weather Statement")], { snow: 1, ice: 0 }).level).toBe(4);
  });

  it("never overrides a winter alert, and never goes above 4", () => {
    expect(determineFrtcon([alert("Winter Weather Advisory")], { snow: 12, ice: 1 }).level).toBe(3);
    const watch = determineFrtcon([alert("Winter Storm Watch")], { snow: 12, ice: 0 });
    expect(watch.level).toBe(4);
    expect(watch.forecastDriven).toBeUndefined();
    expect(determineFrtcon([], { snow: 30, ice: 2 }).level).toBe(4);
  });

  it("stays alert-only with no forecast or a light one", () => {
    expect(determineFrtcon([]).level).toBe(5);
    expect(determineFrtcon([], null).level).toBe(5);
    expect(determineFrtcon([], { snow: 0.5, ice: 0 }).level).toBe(5);
  });
});
