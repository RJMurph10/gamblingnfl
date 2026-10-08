
/**
 * Server-only NFL game weather.
 *
 * U.S. upcoming/live: National Weather Service (NWS).
 * International upcoming/live: MET Norway.
 * Completed games: Visual Crossing historical Timeline API.
 * Indoor stadiums: static 72° Indoor card.
 *
 * Open-Meteo has been completely removed.
 */

import { getStadiumForGame, type StadiumInfo } from "@/lib/stadiums";

export interface GameWeather {
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
  isIndoor: boolean;
}

const USER_AGENT = "GamblingNFL/1.0 https://gamblingnfl.lovable.app/";
const HOUR_MS = 3_600_000;
const MATCH_WINDOW_MS = 4 * HOUR_MS;
const HISTORICAL_MATCH_WINDOW_MINUTES = 180;

type WeatherResult = {
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
  isIndoor: boolean;
};

function isCompleted(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s.includes("final") ||
    s.includes("complete") ||
    s === "post" ||
    s.includes("postgame")
  );
}

function isLiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "live" || s === "in" || s.includes("progress");
}

function getLocalDate(iso: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));

    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value;

    const year = get("year");
    const month = get("month");
    const day = get("day");

    if (!year || !month || !day) {
      throw new Error("Could not determine local calendar date");
    }

    return `${year}-${month}-${day}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function getLocalMinutes(iso: string, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));

    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);

    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return hour * 60 + minute;
    }
  } catch {
    // Fall through to UTC.
  }

  const date = new Date(iso);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function dayNightEmoji(
  iso: string,
  timezone: string,
  emoji: string,
): string {
  const minutes = getLocalMinutes(iso, timezone);
  const isDay = minutes >= 6 * 60 && minutes < 18 * 60;

  if (isDay) return emoji === "🌙" ? "☀️" : emoji;

  if (["☀️", "🌤️", "⛅"].includes(emoji)) return "🌙";

  return emoji;
}

function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

function emptyWeather(
  temperature: number | null = null,
  condition = "Weather unavailable",
  emoji = "☁️",
): GameWeather {
  return {
    temperature,
    condition,
    emoji,
    high: null,
    low: null,
    isIndoor: false,
  };
}

async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...headers,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      // Do not log query strings because API URLs may contain credentials.
      console.error(
        `Weather request failed [${response.status}]: ${url.split("?")[0]}`,
      );
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error(
      `Weather request error: ${url.split("?")[0]}`,
      error,
    );
    return null;
  }
}

/* ---------- Shared weather-condition helpers ---------- */

function conditionToEmoji(condition: string, icon?: string): string {
  const value = `${condition} ${icon ?? ""}`.toLowerCase();

  if (value.includes("thunder")) return "⛈️";
  if (value.includes("snow") || value.includes("sleet")) return "🌨️";
  if (
    value.includes("rain") ||
    value.includes("shower") ||
    value.includes("drizzle")
  ) {
    return "🌧️";
  }
  if (value.includes("fog") || value.includes("mist")) return "🌫️";
  if (value.includes("wind")) return "💨";
  if (
    value.includes("partly") ||
    value.includes("partially cloudy") ||
    value.includes("partly-cloudy")
  ) {
    return "⛅";
  }
  if (value.includes("cloud") || value.includes("overcast")) return "☁️";
  if (
    value.includes("clear") ||
    value.includes("sunny") ||
    value.includes("fair")
  ) {
    return "☀️";
  }

  return "☁️";
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getTemperatureRange(
  temperatures: Array<number | null | undefined>,
): { high: number | null; low: number | null } {
  const valid = temperatures.filter(validNumber);

  if (valid.length === 0) {
    return { high: null, low: null };
  }

  return {
    high: Math.round(Math.max(...valid)),
    low: Math.round(Math.min(...valid)),
  };
}

/* ---------- U.S. forecast: National Weather Service ---------- */

interface NwsPeriod {
  startTime: string;
  endTime: string;
  temperature?: number;
  temperatureUnit?: string;
  shortForecast?: string;
}

interface NwsPointsResponse {
  properties?: {
    forecastHourly?: string;
  };
}

interface NwsHourlyResponse {
  properties?: {
    periods?: NwsPeriod[];
  };
}

function nwsTemperature(period: NwsPeriod): number | null {
  if (!validNumber(period.temperature)) return null;

  return period.temperatureUnit === "C"
    ? celsiusToFahrenheit(period.temperature)
    : Math.round(period.temperature);
}

async function nwsWeather(
  stadium: StadiumInfo,
  target: string,
): Promise<GameWeather | null> {
  const headers = {
    Accept: "application/geo+json",
    "User-Agent": USER_AGENT,
  };

  const pointsUrl =
    `https://api.weather.gov/points/` +
    `${stadium.lat.toFixed(4)},${stadium.lon.toFixed(4)}`;

  const points = await getJson<NwsPointsResponse>(pointsUrl, headers);
  const hourlyUrl = points?.properties?.forecastHourly;

  if (!hourlyUrl) return null;

  const forecast = await getJson<NwsHourlyResponse>(hourlyUrl, headers);
  const periods = forecast?.properties?.periods ?? [];

  if (periods.length === 0) return null;

  const targetMs = Date.parse(target);
  const targetDate = getLocalDate(target, stadium.timezone);

  let best: NwsPeriod | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const period of periods) {
    const start = Date.parse(period.startTime);
    const end = Date.parse(period.endTime);

    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const diff =
      targetMs >= start && targetMs < end
        ? 0
        : Math.min(Math.abs(targetMs - start), Math.abs(targetMs - end));

    if (diff < bestDiff) {
      bestDiff = diff;
      best = period;
    }
  }

  if (!best || bestDiff > MATCH_WINDOW_MS) return null;

  const temperature = nwsTemperature(best);
  if (temperature === null) return null;

  // Calculate high/low from the same NWS hourly response.
  // Only include hours on the game's local stadium date.
  const sameDayTemperatures = periods
    .filter(
      (period) =>
        getLocalDate(period.startTime, stadium.timezone) === targetDate,
    )
    .map(nwsTemperature);

  const range = getTemperatureRange(sameDayTemperatures);
  const condition = best.shortForecast || "Cloudy";
  const emoji = conditionToEmoji(condition);

  return {
    temperature,
    condition,
    emoji: dayNightEmoji(target, stadium.timezone, emoji),
    high: range.high,
    low: range.low,
    isIndoor: false,
  };
}

/* ---------- International forecast: MET Norway ---------- */

interface MetTimeseriesEntry {
  time: string;
  data?: {
    instant?: {
      details?: {
        air_temperature?: number;
      };
    };
    next_1_hours?: {
      summary?: { symbol_code?: string };
    };
    next_6_hours?: {
      summary?: { symbol_code?: string };
    };
    next_12_hours?: {
      summary?: { symbol_code?: string };
    };
  };
}

interface MetResponse {
  properties?: {
    timeseries?: MetTimeseriesEntry[];
  };
}

function metSymbolToCondition(symbol?: string): string {
  const s = (symbol ?? "").toLowerCase();

  if (s.includes("thunder")) return "Thunderstorm";
  if (s.includes("snow") || s.includes("sleet")) return "Snow";
  if (s.includes("rain") || s.includes("shower") || s.includes("drizzle")) {
    return "Rain";
  }
  if (s.includes("fog")) return "Fog";
  if (s.includes("partlycloudy")) return "Partly cloudy";
  if (s.includes("cloud")) return "Cloudy";
  if (s.includes("fair")) return "Mainly clear";
  if (s.includes("clear")) return "Clear";

  return "Cloudy";
}

async function metNorwayWeather(
  stadium: StadiumInfo,
  target: string,
): Promise<GameWeather | null> {
  const url =
    "https://api.met.no/weatherapi/locationforecast/2.0/compact" +
    `?lat=${stadium.lat.toFixed(4)}&lon=${stadium.lon.toFixed(4)}`;

  const data = await getJson<MetResponse>(url);
  const entries = data?.properties?.timeseries ?? [];

  if (entries.length === 0) return null;

  const targetMs = Date.parse(target);
  const targetDate = getLocalDate(target, stadium.timezone);

  let best: MetTimeseriesEntry | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const entryMs = Date.parse(entry.time);
    if (!Number.isFinite(entryMs)) continue;

    const diff = Math.abs(entryMs - targetMs);

    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }

  if (!best || bestDiff > MATCH_WINDOW_MS) return null;

  const celsius = best.data?.instant?.details?.air_temperature;

  if (!validNumber(celsius)) return null;

  const symbol =
    best.data?.next_1_hours?.summary?.symbol_code ??
    best.data?.next_6_hours?.summary?.symbol_code ??
    best.data?.next_12_hours?.summary?.symbol_code;

  const condition = metSymbolToCondition(symbol);
  const emoji = conditionToEmoji(condition);

  // Use all forecast temperatures available for the stadium's local date.
  // MET Norway's farther-out forecast points may be less frequent than hourly.
  const sameDayTemperatures = entries
    .filter(
      (entry) =>
        getLocalDate(entry.time, stadium.timezone) === targetDate,
    )
    .map((entry) => {
      const value = entry.data?.instant?.details?.air_temperature;
      return validNumber(value) ? celsiusToFahrenheit(value) : null;
    });

  const range = getTemperatureRange(sameDayTemperatures);

  return {
    temperature: celsiusToFahrenheit(celsius),
    condition,
    emoji: dayNightEmoji(target, stadium.timezone, emoji),
    high: range.high,
    low: range.low,
    isIndoor: false,
  };
}

/* ---------- Historical weather: Visual Crossing ---------- */

interface VisualCrossingHour {
  datetime?: string;
  temp?: number;
  conditions?: string;
  icon?: string;
}

interface VisualCrossingDay {
  datetime?: string;
  tempmax?: number;
  tempmin?: number;
  hours?: VisualCrossingHour[];
}

interface VisualCrossingResponse {
  days?: VisualCrossingDay[];
  errorCode?: number;
  message?: string;
}

function getVisualCrossingApiKey(): string | undefined {
  // Server-side environment variable only. Do not use a VITE_ prefixed key.
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env?.VISUAL_CROSSING_API_KEY;
}

function parseClockMinutes(clock?: string): number | null {
  if (!clock) return null;

  const match = clock.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
}

function clockDifferenceMinutes(a: number, b: number): number {
  // Treat times as local clock readings; do not convert them through UTC.
  return Math.abs(a - b);
}

async function visualCrossingPastWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  const apiKey = getVisualCrossingApiKey();

  if (!apiKey) {
    console.error(
      "Historical weather unavailable: VISUAL_CROSSING_API_KEY is not configured.",
    );
    return null;
  }

  const localDate = getLocalDate(gameTime, stadium.timezone);
  const targetMinutes = getLocalMinutes(gameTime, stadium.timezone);

  const location = encodeURIComponent(`${stadium.lat},${stadium.lon}`);
  const url = new URL(
    `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${location}/${localDate}/${localDate}`,
  );

  url.searchParams.set("unitGroup", "us");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("include", "days,hours");
  url.searchParams.set("contentType", "json");
  url.searchParams.set("timezone", stadium.timezone);
  url.searchParams.set(
    "elements",
    "datetime,tempmax,tempmin,temp,conditions,icon",
  );

  const data = await getJson<VisualCrossingResponse>(url.toString());

  if (!data?.days?.length) return null;

  const day =
    data.days.find((entry) => entry.datetime === localDate) ??
    data.days[0];

  if (!day) return null;

  const hours = day.hours ?? [];

  let best: VisualCrossingHour | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const hour of hours) {
    const hourMinutes = parseClockMinutes(hour.datetime);
    if (hourMinutes === null || !validNumber(hour.temp)) continue;

    const diff = clockDifferenceMinutes(hourMinutes, targetMinutes);

    if (diff < bestDiff) {
      bestDiff = diff;
      best = hour;
    }
  }

  // Do not silently display a distant hour as the game's kickoff weather.
  if (
    !best ||
    bestDiff > HISTORICAL_MATCH_WINDOW_MINUTES ||
    !validNumber(best.temp)
  ) {
    console.error(
      `Historical weather had no suitable hourly match for ${localDate}.`,
    );
    return null;
  }

  const condition = best.conditions || "Cloudy";
  const emoji = conditionToEmoji(condition, best.icon);

  return {
    temperature: Math.round(best.temp),
    condition,
    emoji: dayNightEmoji(gameTime, stadium.timezone, emoji),
    high: validNumber(day.tempmax) ? Math.round(day.tempmax) : null,
    low: validNumber(day.tempmin) ? Math.round(day.tempmin) : null,
    isIndoor: false,
  };
}

/* ---------- Cache and public entry point ---------- */

const weatherCache = new Map<string, { at: number; value: GameWeather }>();

const FINAL_TTL_MS = 12 * HOUR_MS;
const FORECAST_TTL_MS = 10 * 60 * 1000;

export async function fetchGameWeather(input: {
  gameId: string;
  homeTeamId: string;
  venue?: string;
  status: string;
  gameTime: string;
}): Promise<GameWeather | null> {
  const key = `${input.gameId}|${input.status}|${input.gameTime}`;
  const ttl = isCompleted(input.status) ? FINAL_TTL_MS : FORECAST_TTL_MS;

  const cached = weatherCache.get(key);

  if (cached && Date.now() - cached.at < ttl) {
    return cached.value;
  }

  const value = await loadGameWeather(input);

  // Cache only successful responses. A failed API request can be retried.
  if (value) {
    weatherCache.set(key, { at: Date.now(), value });
  }

  return value;
}

async function loadGameWeather({
  homeTeamId,
  venue,
  status,
  gameTime,
}: {
  gameId: string;
  homeTeamId: string;
  venue?: string;
  status: string;
  gameTime: string;
}): Promise<GameWeather | null> {
  try {
    const stadium = getStadiumForGame(homeTeamId, venue);

    if (!stadium) {
      console.error("Weather lookup failed: no stadium matched the game.");
      return null;
    }

    // Indoor stadiums do not need an external weather request.
    if (stadium.isIndoor) {
      return {
        temperature: 72,
        condition: "Indoor",
        emoji: "🏟️",
        high: null,
        low: null,
        isIndoor: true,
      };
    }

    if (!Number.isFinite(Date.parse(gameTime))) {
      console.error("Weather lookup failed: invalid game kickoff time.");
      return null;
    }

    // Completed games use a dedicated historical weather source.
    if (isCompleted(status)) {
      return await visualCrossingPastWeather(stadium, gameTime);
    }

    // Live games show conditions at the current time.
    // Scheduled games show conditions at kickoff.
    const target = isLiveStatus(status)
      ? new Date().toISOString()
      : gameTime;

    // No Open-Meteo calls or hidden Open-Meteo fallbacks.
    if (stadium.international) {
      return await metNorwayWeather(stadium, target);
    }

    return await nwsWeather(stadium, target);
  } catch (error) {
    console.error("fetchGameWeather error:", error);
    return null;
  }
}
