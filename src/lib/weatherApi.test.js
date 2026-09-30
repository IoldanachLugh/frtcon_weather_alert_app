import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, HttpError, getLatLonFromZip, getZoneByPoint, getActiveAlertsByPoint } from "./weatherApi";

// fetch is stubbed per test. localStorage isn't available under vitest's
// node environment, so cache.js's try/catch makes every cache read a miss --
// each test hits the (fake) network.

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function stubFetch(handler) {
  const fetchMock = vi.fn((url) => Promise.resolve(handler(url)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// friendlyMessage logs the technical detail; keep test output quiet.
function silenceConsole() {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("fetchJson", () => {
  it("throws an HttpError carrying the status and URL", async () => {
    stubFetch(() => jsonResponse({}, 503));
    const err = await fetchJson("https://example.test/x").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    expect(err.url).toBe("https://example.test/x");
    expect(err.timeout).toBe(false);
  });

  it("marks its own timeout as a timeout, not a caller abort", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url, { signal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          })
      )
    );
    const pending = fetchJson("https://example.test/slow").catch((e) => e);
    await vi.advanceTimersByTimeAsync(10000);
    const err = await pending;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.timeout).toBe(true);
  });
});

describe("getLatLonFromZip", () => {
  it("returns numeric coordinates", async () => {
    stubFetch(() => jsonResponse({ places: [{ latitude: "46.1", longitude: "-92.5" }] }));
    await expect(getLatLonFromZip("55771")).resolves.toEqual({ lat: 46.1, lon: -92.5 });
  });

  it("says the ZIP wasn't found on a 404", async () => {
    silenceConsole();
    stubFetch(() => jsonResponse({}, 404));
    await expect(getLatLonFromZip("00000")).rejects.toThrow("We couldn't find that ZIP code.");
  });

  it("says the ZIP wasn't found on a 200 with no places", async () => {
    stubFetch(() => jsonResponse({ places: [] }));
    await expect(getLatLonFromZip("00001")).rejects.toThrow("We couldn't find that ZIP code.");
  });

  it("gives the generic message for a server error, never the URL", async () => {
    silenceConsole();
    stubFetch(() => jsonResponse({}, 500));
    const err = await getLatLonFromZip("12345").catch((e) => e);
    expect(err.message).toBe("The weather service isn't responding right now. Try again in a minute.");
  });
});

describe("getZoneByPoint", () => {
  it("returns the zone id and name", async () => {
    stubFetch((url) =>
      url.includes("/points/")
        ? jsonResponse({ properties: { forecastZone: "https://api.weather.gov/zones/forecast/MNZ011" } })
        : jsonResponse({ properties: { name: "Northern St. Louis" } })
    );
    await expect(getZoneByPoint(48.05, -92.87)).resolves.toEqual({ zoneId: "MNZ011", zoneName: "Northern St. Louis" });
  });

  it("says the location isn't covered when /points 404s (outside the US)", async () => {
    silenceConsole();
    stubFetch(() => jsonResponse({}, 404));
    await expect(getZoneByPoint(51.5074, -0.1278)).rejects.toThrow(
      "This location isn't covered by the National Weather Service."
    );
  });
});

describe("getActiveAlertsByPoint", () => {
  it("queries by point, not by zone, and returns the features", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ features: [{ id: "a1" }] }));
    await expect(getActiveAlertsByPoint(46.1, -92.5)).resolves.toEqual([{ id: "a1" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.weather.gov/alerts/active?point=46.1,-92.5&status=actual");
  });
});
