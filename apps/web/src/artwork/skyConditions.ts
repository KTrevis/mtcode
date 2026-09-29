import { moonIllumination, moonPosition, sunPosition } from "./astronomy";

export type SkyPhase = "dawn" | "day" | "dusk" | "night";
export type SkyWeather = "clear" | "cloudy" | "rain" | "snow" | "fog" | "storm";
export type SkyPrecipitation = "none" | "drizzle" | "rain" | "sleet" | "snow";

/**
 * Everything a sky is drawn from. Continuous where the weather is: the sun's
 * height picks the colour, each cloud layer's cover picks its clouds, and the
 * precipitation carries its own strength, so no two hours need look alike.
 */
export type SkyConditions = {
  /** Degrees above the horizon; negative through twilight and night. */
  readonly sun: number;
  /** Compass bearing in degrees; east is morning, west is evening. */
  readonly sunAzimuth: number;
  /** The moon when it is up, with how much of it is lit. */
  readonly moon: {
    readonly altitude: number;
    readonly azimuth: number;
    readonly fraction: number;
    readonly waxing: boolean;
  } | null;
  /** Cover of each cloud layer, 0..1: cumulus and stratus, mid-level, cirrus. */
  readonly low: number;
  readonly mid: number;
  readonly high: number;
  readonly precipitation: SkyPrecipitation;
  /** 0..1, light to heavy. */
  readonly intensity: number;
  readonly thunder: boolean;
  /** 0..1, from a haze to a whiteout. */
  readonly fog: number;
  /** km/h at 10 m; slants the rain and stretches the cloud. */
  readonly wind: number;
  /** Shuffles where the clouds sit, so one hour's sky differs from the next. */
  readonly seed: number;
};

export type SkyForecast = {
  readonly code: number;
  readonly cloudCover: number;
  readonly cloudLow: number;
  readonly cloudMid: number;
  readonly cloudHigh: number;
  readonly wind: number;
  readonly visibility: number | null;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** WMO weather code to what falls and how hard. */
export function precipitationFromCode(code: number): {
  precipitation: SkyPrecipitation;
  intensity: number;
  thunder: boolean;
} {
  const thunder = code >= 95;
  const table: Record<number, readonly [SkyPrecipitation, number]> = {
    51: ["drizzle", 0.3],
    53: ["drizzle", 0.55],
    55: ["drizzle", 0.8],
    56: ["sleet", 0.35],
    57: ["sleet", 0.6],
    61: ["rain", 0.3],
    63: ["rain", 0.6],
    65: ["rain", 0.95],
    66: ["sleet", 0.45],
    67: ["sleet", 0.8],
    71: ["snow", 0.3],
    73: ["snow", 0.6],
    75: ["snow", 0.95],
    77: ["snow", 0.25],
    80: ["rain", 0.35],
    81: ["rain", 0.65],
    82: ["rain", 1],
    85: ["snow", 0.45],
    86: ["snow", 0.85],
    95: ["rain", 0.75],
    96: ["sleet", 0.8],
    99: ["sleet", 1],
  };
  const [precipitation, intensity] = table[code] ?? ["none", 0];
  return { precipitation, intensity, thunder };
}

/**
 * The layers Open-Meteo reports are each a share of the whole sky, but a sky
 * the forecast calls cloudy with no layer split (some models omit it) still
 * needs its cloud somewhere, so the total lands on the low layer.
 */
function layers(forecast: SkyForecast) {
  const total = clamp01(forecast.cloudCover / 100);
  let low = clamp01(forecast.cloudLow / 100);
  const mid = clamp01(forecast.cloudMid / 100);
  const high = clamp01(forecast.cloudHigh / 100);
  if (low + mid + high < total * 0.5) low = total;
  return { low, mid, high };
}

export function conditionsAt(
  ms: number,
  location: { readonly latitude: number; readonly longitude: number },
  forecast: SkyForecast | null,
): SkyConditions {
  const sun = sunPosition(ms, location.latitude, location.longitude);
  const moonAt = moonPosition(ms, location.latitude, location.longitude);
  const lit = moonIllumination(ms);
  const weather = forecast ? precipitationFromCode(forecast.code) : precipitationFromCode(0);
  const cover = forecast ? layers(forecast) : { low: 0, mid: 0, high: 0 };
  const visibility = forecast?.visibility ?? null;
  const fogCode = forecast !== null && (forecast.code === 45 || forecast.code === 48);
  const hazy = visibility === null ? 0 : clamp01((6000 - visibility) / 5500);
  return {
    sun: sun.altitude,
    sunAzimuth: sun.azimuth,
    moon:
      moonAt.altitude > -2
        ? {
            altitude: moonAt.altitude,
            azimuth: moonAt.azimuth,
            fraction: lit.fraction,
            waxing: lit.waxing,
          }
        : null,
    ...cover,
    ...weather,
    fog: Math.max(hazy, fogCode ? 0.7 : 0),
    wind: forecast?.wind ?? 8,
    // One layout per hour of the day at this place.
    seed: Math.floor(ms / 3_600_000) + Math.round(location.latitude * 7 + location.longitude * 3),
  };
}

/** Clear weather at the same moment, for the day-and-night-only mode. */
export const withoutWeather = (conditions: SkyConditions): SkyConditions => ({
  ...conditions,
  low: 0,
  mid: 0,
  high: 0,
  precipitation: "none",
  intensity: 0,
  thunder: false,
  fog: 0,
});

/**
 * Rounded so a sky only redraws when it would look different: the sun moves a
 * quarter degree a minute at most, and cover arrives in whole percent.
 */
export function skyKey(conditions: SkyConditions): string {
  const sunStep = Math.abs(conditions.sun) < 20 ? 0.5 : 3;
  const round = (value: number, step: number) => Math.round(value / step) * step;
  return [
    round(conditions.sun, sunStep),
    round(conditions.sunAzimuth, 4),
    conditions.moon
      ? `${round(conditions.moon.altitude, 2)}:${round(conditions.moon.azimuth, 4)}:${round(conditions.moon.fraction, 0.05)}:${conditions.moon.waxing}`
      : "-",
    round(conditions.low, 0.05),
    round(conditions.mid, 0.05),
    round(conditions.high, 0.05),
    conditions.precipitation,
    round(conditions.intensity, 0.1),
    conditions.thunder,
    round(conditions.fog, 0.1),
    round(conditions.wind, 5),
    conditions.seed,
  ].join("|");
}

/** The coarse name for a sky, for labels and the icon's weather overlay. */
export function skyWeatherOf(conditions: SkyConditions): SkyWeather {
  if (conditions.thunder) return "storm";
  if (conditions.precipitation === "snow") return "snow";
  if (conditions.precipitation !== "none") return "rain";
  if (conditions.fog >= 0.5) return "fog";
  return Math.max(conditions.low, conditions.mid) >= 0.35 ? "cloudy" : "clear";
}

export function skyPhaseOf(conditions: SkyConditions): SkyPhase {
  if (conditions.sun >= 6) return "day";
  if (conditions.sun <= -10) return "night";
  return conditions.sunAzimuth < 180 ? "dawn" : "dusk";
}

const phaseSun: Record<SkyPhase, readonly [number, number]> = {
  dawn: [1.5, 95],
  day: [38, 170],
  dusk: [-1.5, 265],
  night: [-30, 330],
};

const presetWeather: Record<
  SkyWeather,
  Pick<
    SkyConditions,
    "low" | "mid" | "high" | "precipitation" | "intensity" | "thunder" | "fog" | "wind"
  >
> = {
  clear: {
    low: 0,
    mid: 0,
    high: 0.15,
    precipitation: "none",
    intensity: 0,
    thunder: false,
    fog: 0,
    wind: 8,
  },
  cloudy: {
    low: 0.45,
    mid: 0.3,
    high: 0.3,
    precipitation: "none",
    intensity: 0,
    thunder: false,
    fog: 0,
    wind: 12,
  },
  rain: {
    low: 0.9,
    mid: 0.6,
    high: 0.2,
    precipitation: "rain",
    intensity: 0.6,
    thunder: false,
    fog: 0.1,
    wind: 18,
  },
  snow: {
    low: 0.85,
    mid: 0.5,
    high: 0.2,
    precipitation: "snow",
    intensity: 0.6,
    thunder: false,
    fog: 0.15,
    wind: 10,
  },
  fog: {
    low: 0.3,
    mid: 0,
    high: 0,
    precipitation: "none",
    intensity: 0,
    thunder: false,
    fog: 0.85,
    wind: 3,
  },
  storm: {
    low: 1,
    mid: 0.8,
    high: 0.4,
    precipitation: "rain",
    intensity: 0.9,
    thunder: true,
    fog: 0,
    wind: 30,
  },
};

/** A fixed scene from the picker, drawn by the same renderer as the live sky. */
export function presetConditions(phase: SkyPhase, weather: SkyWeather): SkyConditions {
  const [sun, sunAzimuth] = phaseSun[phase];
  return {
    sun,
    sunAzimuth,
    moon:
      phase === "night" && weather === "clear"
        ? { altitude: 40, azimuth: 150, fraction: 0.3, waxing: true }
        : null,
    ...presetWeather[weather],
    seed: SKY_PRESET_SEED,
  };
}

const SKY_PRESET_SEED = 7;
