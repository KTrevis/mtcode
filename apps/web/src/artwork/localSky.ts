import { useSyncExternalStore } from "react";
import {
  conditionsAt,
  skyKey,
  skyPhaseOf,
  skyWeatherOf,
  type SkyConditions,
  type SkyForecast,
  type SkyPhase,
  type SkyWeather,
} from "./skyConditions";

export type SkyLocation = { latitude: number; longitude: number; name: string };
type Forecast = SkyForecast & { fetchedAt: number };
type Snapshot = {
  location: SkyLocation | null;
  /** The sky right now: the sun and moon from the location, the rest from the forecast. */
  conditions: SkyConditions | null;
  phase: SkyPhase;
  weather: SkyWeather;
  status: string;
  /** A forecast has arrived, so `conditions` carries real weather. */
  ready: boolean;
};
const storageKey = "mt-code.sky-location.v1";
const listeners = new Set<() => void>();
let snapshot: Snapshot = {
  location: null,
  conditions: null,
  phase: "night",
  weather: "clear",
  status: "Choose a location to enable the local sky.",
  ready: false,
};
let forecast: Forecast | null = null;
let initialized = false;
let interval: ReturnType<typeof setInterval> | undefined;
let request: AbortController | null = null;
let retryAt = 0;

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function validLocation(value: unknown): value is SkyLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<SkyLocation>;
  return (
    typeof location.latitude === "number" &&
    Number.isFinite(location.latitude) &&
    Math.abs(location.latitude) <= 90 &&
    typeof location.longitude === "number" &&
    Number.isFinite(location.longitude) &&
    Math.abs(location.longitude) <= 180 &&
    typeof location.name === "string"
  );
}

function readLocation(): SkyLocation | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return validLocation(value) ? value : null;
  } catch {
    return null;
  }
}

export function setSkyLocation(location: SkyLocation | null) {
  if (location && !validLocation(location)) return;
  request?.abort();
  request = null;
  forecast = null;
  retryAt = 0;
  // Keep location on this device; server-synced appearance settings contain only the mode.
  const approximate = location
    ? {
        ...location,
        latitude: Math.round(location.latitude * 100) / 100,
        longitude: Math.round(location.longitude * 100) / 100,
      }
    : null;
  try {
    if (approximate) localStorage.setItem(storageKey, JSON.stringify(approximate));
    else localStorage.removeItem(storageKey);
  } catch {
    /* Still usable for this session when storage is unavailable. */
  }
  emit({
    location: approximate,
    conditions: null,
    ready: false,
    status: approximate ? "Updating local sky…" : "Choose a location to enable the local sky.",
  });
  if (listeners.size) void tick();
}

/**
 * Recomputes the sky every tick: the sun and moon move between weather
 * refreshes, so only the clouds wait for the network. Listeners only hear
 * about it when the sky would draw differently.
 */
function updateSky() {
  const location = snapshot.location;
  if (!location) return;
  const conditions = conditionsAt(Date.now(), location, forecast);
  const ready = forecast !== null;
  if (
    snapshot.conditions &&
    ready === snapshot.ready &&
    skyKey(conditions) === skyKey(snapshot.conditions)
  )
    return;
  emit({
    conditions,
    phase: skyPhaseOf(conditions),
    weather: skyWeatherOf(conditions),
    ready,
  });
}

/** Open-Meteo omits a layer when its model has none; the code still says how grey it is. */
const coverFromCode = (code: number) => (code <= 0 ? 0 : code === 1 ? 20 : code === 2 ? 50 : 95);
const percent = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : fallback;

async function tick() {
  if (typeof document !== "undefined" && document.hidden) return;
  updateSky();
  const location = snapshot.location;
  if (
    !location ||
    request ||
    Date.now() < retryAt ||
    (forecast && Date.now() - forecast.fetchedAt < 15 * 60_000)
  )
    return;
  const controller = new AbortController();
  request = controller;
  if (!forecast) emit({ status: "Updating local sky…" });
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current:
        "weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,visibility",
      timeformat: "unixtime",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("Weather unavailable");
    const data = (await response.json()) as { current?: Record<string, unknown> };
    const current = data.current;
    const code = current?.weather_code;
    if (typeof code !== "number" || !Number.isFinite(code))
      throw new Error("Invalid weather response");
    if (request !== controller) return;
    const total = percent(current!.cloud_cover, coverFromCode(code));
    forecast = {
      code,
      cloudCover: total,
      cloudLow: percent(current!.cloud_cover_low, 0),
      cloudMid: percent(current!.cloud_cover_mid, 0),
      cloudHigh: percent(current!.cloud_cover_high, 0),
      wind: percent(current!.wind_speed_10m, 8),
      visibility:
        typeof current!.visibility === "number" && Number.isFinite(current!.visibility)
          ? current!.visibility
          : null,
      fetchedAt: Date.now(),
    };
    updateSky();
    emit({ status: "Local sky is up to date." });
  } catch {
    if (request === controller) {
      retryAt = Date.now() + 5 * 60_000;
      emit({
        status: forecast
          ? "Weather is unavailable. Showing the last update; retrying shortly."
          : "Weather is unavailable. Showing Night sky; retrying shortly.",
      });
    }
  } finally {
    clearTimeout(timeout);
    if (request === controller) request = null;
  }
}

const onVisible = () => {
  void tick();
};
const onStorage = (event: StorageEvent) => {
  if (event.key !== storageKey && event.key !== null) return;
  request?.abort();
  request = null;
  forecast = null;
  retryAt = 0;
  const location = readLocation();
  emit({
    location,
    conditions: null,
    ready: false,
    status: location ? "Updating local sky…" : "Choose a location to enable the local sky.",
  });
  void tick();
};
function subscribe(listener: () => void) {
  if (!initialized) {
    initialized = true;
    snapshot = { ...snapshot, location: readLocation() };
  }
  listeners.add(listener);
  if (listeners.size === 1) {
    interval = setInterval(() => {
      void tick();
    }, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    void tick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(interval);
      request?.abort();
      request = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    }
  };
}
const getSnapshot = () => snapshot;
const subscribeDisabled = () => () => {};
export function useLocalSky(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribe : subscribeDisabled, getSnapshot, getSnapshot);
}
