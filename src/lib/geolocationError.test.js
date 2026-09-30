import { describe, it, expect } from "vitest";
import { geolocationErrorMessage, ZIP_FALLBACK_HINT } from "./geolocationError";

describe("geolocationErrorMessage", () => {
  it("explains a timeout in plain language, with the wait, instead of the browser's bare text", () => {
    const message = geolocationErrorMessage({ code: 3, message: "Timeout expired" });
    expect(message).toContain("didn't report its location within 45 seconds");
    expect(message).not.toContain("Timeout expired");
  });

  it("explains position-unavailable and permission-denied", () => {
    expect(geolocationErrorMessage({ code: 2 })).toMatch(/couldn't work out where it is/);
    expect(geolocationErrorMessage({ code: 1 })).toMatch(/Location access is turned off/);
  });

  it("falls back to a generic message for an unknown or missing error", () => {
    expect(geolocationErrorMessage({ code: 99, message: "whatever" })).toMatch(/couldn't read your location/);
    expect(geolocationErrorMessage(undefined)).toMatch(/couldn't read your location/);
  });

  it("always ends with the ZIP fallback hint", () => {
    for (const code of [1, 2, 3, 99]) {
      expect(geolocationErrorMessage({ code }).endsWith(ZIP_FALLBACK_HINT)).toBe(true);
    }
  });
});
