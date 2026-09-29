import { describe, expect, it } from "vite-plus/test";

import { moonIllumination, sunPosition } from "./astronomy";
import {
  conditionsAt,
  precipitationFromCode,
  skyKey,
  skyPhaseOf,
  skyWeatherOf,
  type SkyForecast,
} from "./skyConditions";
import { skyPalette } from "./skyPalette";
import { skySceneMarkup } from "./skyScene";

const westLafayette = { latitude: 40.43, longitude: -86.91 };
const forecast = (overrides: Partial<SkyForecast> = {}): SkyForecast => ({
  code: 0,
  cloudCover: 0,
  cloudLow: 0,
  cloudMid: 0,
  cloudHigh: 0,
  wind: 10,
  visibility: 20_000,
  ...overrides,
});

describe("sun and moon", () => {
  it("puts the equinox noon sun at 90° less the latitude, due south", () => {
    // Solar noon at 86.91° W on the 2026 September equinox is about 17:55 UTC.
    const noon = sunPosition(Date.parse("2026-09-23T17:55:00Z"), 40.43, -86.91);
    expect(noon.altitude).toBeGreaterThan(48.5);
    expect(noon.altitude).toBeLessThan(50.5);
    expect(noon.azimuth).toBeGreaterThan(170);
    expect(noon.azimuth).toBeLessThan(190);
  });

  it("rises in the east and is below the horizon at midnight", () => {
    const sunrise = sunPosition(Date.parse("2026-09-23T11:30:00Z"), 40.43, -86.91);
    expect(Math.abs(sunrise.altitude)).toBeLessThan(2);
    expect(sunrise.azimuth).toBeGreaterThan(80);
    expect(sunrise.azimuth).toBeLessThan(100);
    expect(sunPosition(Date.parse("2026-09-24T05:00:00Z"), 40.43, -86.91).altitude).toBeLessThan(
      -30,
    );
  });

  it("lights the moon by its phase", () => {
    expect(moonIllumination(Date.parse("2024-01-25T17:54:00Z")).fraction).toBeGreaterThan(0.99);
    expect(moonIllumination(Date.parse("2024-01-11T11:57:00Z")).fraction).toBeLessThan(0.01);
    expect(moonIllumination(Date.parse("2024-01-18T03:53:00Z"))).toMatchObject({ waxing: true });
    expect(moonIllumination(Date.parse("2024-02-02T23:18:00Z"))).toMatchObject({ waxing: false });
  });
});

describe("conditions from a forecast", () => {
  it.each([
    [0, "none", false],
    [53, "drizzle", false],
    [63, "rain", false],
    [67, "sleet", false],
    [75, "snow", false],
    [86, "snow", false],
    [95, "rain", true],
    [99, "sleet", true],
  ] as const)("reads WMO code %s as %s", (code, precipitation, thunder) => {
    expect(precipitationFromCode(code)).toMatchObject({ precipitation, thunder });
  });

  it("puts a cloudy sky's cover somewhere when the model gives no layer split", () => {
    const at = Date.parse("2026-09-23T17:55:00Z");
    const grey = conditionsAt(at, westLafayette, forecast({ code: 3, cloudCover: 90 }));
    expect(grey.low).toBeCloseTo(0.9);
    expect(skyWeatherOf(grey)).toBe("cloudy");
  });

  it("turns low visibility and fog codes into fog", () => {
    const at = Date.parse("2026-09-23T17:55:00Z");
    expect(conditionsAt(at, westLafayette, forecast({ code: 45 })).fog).toBeGreaterThanOrEqual(0.7);
    expect(conditionsAt(at, westLafayette, forecast({ visibility: 500 })).fog).toBeGreaterThan(0.9);
    expect(conditionsAt(at, westLafayette, forecast()).fog).toBe(0);
  });

  it("names the moment coarsely for labels", () => {
    const morning = conditionsAt(Date.parse("2026-09-23T11:40:00Z"), westLafayette, null);
    const evening = conditionsAt(Date.parse("2026-09-23T23:50:00Z"), westLafayette, null);
    const midnight = conditionsAt(Date.parse("2026-09-24T05:00:00Z"), westLafayette, null);
    expect(skyPhaseOf(morning)).toBe("dawn");
    expect(skyPhaseOf(evening)).toBe("dusk");
    expect(skyPhaseOf(midnight)).toBe("night");
  });

  it("only asks for a redraw when the sky would look different", () => {
    const noon = Date.parse("2026-09-23T17:55:00Z");
    const now = conditionsAt(noon, westLafayette, forecast());
    expect(skyKey(conditionsAt(noon + 60_000, westLafayette, forecast()))).toBe(skyKey(now));
    expect(skyKey(conditionsAt(noon, westLafayette, forecast({ code: 63 })))).not.toBe(skyKey(now));
  });
});

describe("sky palette", () => {
  const midnight = conditionsAt(Date.parse("2026-09-24T05:00:00Z"), westLafayette, forecast());

  it("is the Night sky artwork's own palette on a deep, clear night", () => {
    expect(skyPalette(midnight)).toMatchObject({
      skyA: "#07152f",
      skyB: "#151443",
      skyC: "#32155b",
      stars: 1,
    });
  });

  it("differs either side of noon at the same sun height", () => {
    const morning = conditionsAt(Date.parse("2026-09-23T11:40:00Z"), westLafayette, null);
    const evening = { ...morning, sunAzimuth: 360 - morning.sunAzimuth };
    expect(skyPalette(morning).skyC).not.toBe(skyPalette(evening).skyC);
  });

  it("hides the stars behind overcast and fog", () => {
    expect(skyPalette({ ...midnight, low: 1 }).stars).toBeLessThan(0.01);
    expect(skyPalette({ ...midnight, fog: 1 }).stars).toBe(0);
  });
});

describe("sky scene", () => {
  it("keeps every definition id instance-scoped", () => {
    const stormy = conditionsAt(
      Date.parse("2026-09-23T17:55:00Z"),
      westLafayette,
      forecast({ code: 95, cloudCover: 100, cloudLow: 100, cloudMid: 80, cloudHigh: 40 }),
    );
    const ids = Array.from(skySceneMarkup(stormy).matchAll(/\sid="([^"]+)"/g), (m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("__ID__"))).toBe(true);
  });

  it("repeats its weather across a wide sidebar instead of stretching", () => {
    const cloudy = conditionsAt(
      Date.parse("2026-09-23T17:55:00Z"),
      westLafayette,
      forecast({ code: 2, cloudCover: 50, cloudLow: 50 }),
    );
    expect(skySceneMarkup(cloudy)).toContain('<use href="#__ID__tile" x="640"/>');
  });

  it("gathers the night glow round the moon, and leaves it where Night sky keeps it without one", () => {
    const midnight = conditionsAt(Date.parse("2026-09-24T05:00:00Z"), westLafayette, forecast());
    const glowAt = (markup: string) =>
      markup
        .match(/id="__ID__glow"[^>]*translate\(([\d.-]+) ([\d.-]+)\)/)!
        .slice(1)
        .map(Number);
    const moonlit = {
      ...midnight,
      moon: { altitude: 40, azimuth: 120, fraction: 0.8, waxing: true },
    };
    const moonDisc = skySceneMarkup(moonlit).match(/<path d="M([\d.]+) ([\d.]+)A5 5/)!;
    const [glowX, glowY] = glowAt(skySceneMarkup(moonlit));
    expect(glowX).toBeCloseTo(Number(moonDisc[1]), 0);
    expect(glowY).toBeCloseTo(Number(moonDisc[2]) + 5, 0);
    expect(glowAt(skySceneMarkup({ ...midnight, moon: null }))).toEqual([216, 18]);
  });
});
