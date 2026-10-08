/**
 * Server-only: weather for the game page.
 *
 *  - Indoor stadiums: a fixed "Indoor" card, no API call.
 *  - Finished games: real past weather from Open-Meteo. It tries the forecast
 *    feed (which keeps the last few days), then the history archive (which
 *    trails real time by about five days), then the historical-forecast feed.
 *  - Upcoming / live U.S. games: the National Weather Service, with Open-Meteo
 *    as a backup.
 *  - Upcoming / live international games: MET Norway, with Open-Meteo as a backup.
 *
 * Open-Meteo times are requested as Unix timestamps, so the hour is matched
 * to kickoff exactly no matter what time zone the stadium or the server is in.
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
 
const USER_AGENT = "GamblingNFL/1.0 weather service";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
 
/** A forecast point further than this from the target time is not trusted. */
const MATCH_WINDOW_MS = 4 * HOUR_MS;
/** Open-Meteo's history archive trails real time by about five days. */
const ARCHIVE_DELAY_DAYS = 6;
 
const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const OPEN_METEO_HISTORICAL_FORECAST = "https://historical-forecast-api.open-meteo.com/v1/forecast";
 
/* ---------- small helpers ---------- */
 
function isCompleted(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes("final") || s.includes("complete") || s === "post" || s.includes("postgame");
}
 
function isLiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "live" || s === "in" || s.includes("progress");
}
 
function weatherCodeToCondition(code: number): { condition: string; emoji: string } {
  if (code === 0) return { condition: "Clear", emoji: "☀️" };
  if (code === 1) return { condition: "Mainly clear", emoji: "🌤️" };
  if (code === 2) return { condition: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { condition: "Cloudy", emoji: "☁️" };
  if (code === 45 || code === 48) return { condition: "Fog", emoji: "🌫️" };
  if ([51, 53, 55, 56, 57].includes(code)) return { condition: "Drizzle", emoji: "🌦️" };
  if ([61, 63, 65, 66, 67].includes(code)) return { condition: "Rain", emoji: "🌧️" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { condition: "Snow", emoji: "🌨️" };
  if ([80, 81, 82].includes(code)) return { condition: "Rain showers", emoji: "🌦️" };
  if ([95, 96, 99].includes(code)) return { condition: "Thunderstorm", emoji: "⛈️" };
  return { condition: "Cloudy", emoji: "☁️" };
}
 
/** "2026-10-04" in the stadium's own time zone. */
function getLocalDate(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
 
function getLocalHour(iso: string, timezone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso)),
    );
  } catch {
    return new Date(iso).getUTCHours();
  }
}
 
/** Sun / partly-sunny icons turn into a moon after dark. */
function dayNightEmoji(iso: string, timezone: string, emoji: string): string {
  const hour = getLocalHour(iso, timezone);
  const isDay = hour >= 6 && hour < 18;
  if (isDay) return emoji === "🌙" ? "☀️" : emoji;
  return emoji === "☀️" || emoji === "🌤️" || emoji === "⛅" ? "🌙" : emoji;
}
 
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
 
const celsiusToFahrenheit = (c: number) => Math.round((c * 9) / 5 + 32);
 
async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(`Weather request failed [${response.status}]: ${url.split("?")[0]}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(`Weather request error: ${url.split("?")[0]}`, error);
    return null;
  }
}
 
function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
 
/* ---------- Open-Meteo ---------- */
 
interface OpenMeteoResponse {
  hourly?: {
    time?: number[]; // Unix seconds (timeformat=unixtime)
    temperature_2m?: (number | null)[];
    weather_code?: (number | null)[];
  };
  daily?: {
    time?: string[]; // "YYYY-MM-DD" in the requested time zone
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
  };
}
 
/** The hour closest to `target`, or null if there is no data close enough. */
async function openMeteoHourly(
  base: string,
  stadium: StadiumInfo,
  target: string,
  extra: Record<string, string>,
): Promise<GameWeather | null> {
  const data = await getJson<OpenMeteoResponse>(
    buildUrl(base, {
      latitude: String(stadium.lat),
      longitude: String(stadium.lon),
      hourly: "temperature_2m,weather_code",
      temperature_unit: "fahrenheit",
      timeformat: "unixtime",
      cell_selection: "nearest",
      ...extra,
    }),
  );
  const hourly = data?.hourly;
  if (!hourly?.time?.length || !hourly.temperature_2m) return null;
 
  const targetMs = Date.parse(target);
  let best = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  hourly.time.forEach((seconds, i) => {
    const temp = hourly.temperature_2m![i];
    if (temp == null || !Number.isFinite(temp)) return;
    const diff = Math.abs(seconds * 1000 - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  if (best < 0 || bestDiff > MATCH_WINDOW_MS) return null;
 
  const weather = weatherCodeToCondition(hourly.weather_code?.[best] ?? 3);
  return {
    temperature: Math.round(hourly.temperature_2m[best] as number),
    condition: weather.condition,
    emoji: dayNightEmoji(target, stadium.timezone, weather.emoji),
    high: null,
    low: null,
    isIndoor: false,
  };
}
 
/** The day's high and low, for the date the game is played in the stadium's time zone. */
async function openMeteoDaily(
  base: string,
  stadium: StadiumInfo,
  gameTime: string,
  extra: Record<string, string>,
): Promise<{ high: number | null; low: number | null }> {
  const empty = { high: null, low: null };
  const localDate = getLocalDate(gameTime, stadium.timezone);
  const data = await getJson<OpenMeteoResponse>(
    buildUrl(base, {
      latitude: String(stadium.lat),
      longitude: String(stadium.lon),
      daily: "temperature_2m_max,temperature_2m_min",
      temperature_unit: "fahrenheit",
      timezone: stadium.timezone,
      cell_selection: "nearest",
      ...extra,
    }),
  );
  const index = data?.daily?.time?.indexOf(localDate) ?? -1;
  if (index < 0) return empty;
  const high = data?.daily?.temperature_2m_max?.[index];
  const low = data?.daily?.temperature_2m_min?.[index];
  return {
    high: high != null && Number.isFinite(high) ? Math.round(high) : null,
    low: low != null && Number.isFinite(low) ? Math.round(low) : null,
  };
}
 
/** Hour + high/low together. The high/low failing never hides the temperature. */
async function openMeteoWeather(
  base: string,
  stadium: StadiumInfo,
  target: string,
  gameTime: string,
  hourlyExtra: Record<string, string>,
  dailyExtra: Record<string, string>,
): Promise<GameWeather | null> {
  const [hourly, daily] = await Promise.all([
    openMeteoHourly(base, stadium, target, hourlyExtra),
    openMeteoDaily(base, stadium, gameTime, dailyExtra),
  ]);
  return hourly ? { ...hourly, high: daily.high, low: daily.low } : null;
}
 
/* ---------- finished games ---------- */
 
async function fetchPastWeather(stadium: StadiumInfo, gameTime: string): Promise<GameWeather | null> {
  const gameMs = Date.parse(gameTime);
  const ageDays = (Date.now() - gameMs) / DAY_MS;
  const localDate = getLocalDate(gameTime, stadium.timezone);
  const oneDay = { start_date: localDate, end_date: localDate };
 
  // Three UTC days around kickoff, so a night game that is already "tomorrow" in UTC is included.
  const windowStart = isoDate(gameMs - DAY_MS);
  const windowEnd = (latestMs: number) => isoDate(Math.min(gameMs + DAY_MS, latestMs));
 
  // The forecast feed keeps up to 92 past days and has data for the last few days.
  const viaForecast = () =>
    ageDays <= 90
      ? openMeteoWeather(
          OPEN_METEO_FORECAST,
          stadium,
          gameTime,
          gameTime,
          { past_days: String(Math.min(92, Math.ceil(ageDays) + 2)), forecast_days: "1" },
          { past_days: String(Math.min(92, Math.ceil(ageDays) + 2)), forecast_days: "1" },
        )
      : Promise.resolve(null);
 
  // The archive lags real time by ~5 days, so only ask it about older games.
  const viaArchive = () =>
    ageDays >= ARCHIVE_DELAY_DAYS
      ? openMeteoWeather(
          OPEN_METEO_ARCHIVE,
          stadium,
          gameTime,
          gameTime,
          { start_date: windowStart, end_date: windowEnd(Date.now() - 5 * DAY_MS) },
          oneDay,
        )
      : Promise.resolve(null);
 
  const viaHistoricalForecast = () =>
    openMeteoWeather(
      OPEN_METEO_HISTORICAL_FORECAST,
      stadium,
      gameTime,
      gameTime,
      { start_date: windowStart, end_date: windowEnd(Date.now() - DAY_MS) },
      oneDay,
    );
 
  const attempts =
    ageDays <= 8
      ? [viaForecast, viaHistoricalForecast, viaArchive]
      : [viaArchive, viaHistoricalForecast, viaForecast];
 
  for (const attempt of attempts) {
    const result = await attempt();
    if (result) return result;
  }
  return null;
}
 
/* ---------- MET Norway (international upcoming / live) ---------- */
 
interface MetResponse {
  properties?: {
    timeseries?: {
      time: string;
      data?: {
        instant?: { details?: { air_temperature?: number } };
        next_1_hours?: { summary?: { symbol_code?: string } };
        next_6_hours?: { summary?: { symbol_code?: string } };
        next_12_hours?: { summary?: { symbol_code?: string } };
      };
    }[];
  };
}
 
function metSymbolToWeather(symbol?: string): { condition: string; emoji: string } {
  const s = (symbol ?? "").toLowerCase();
  if (s.includes("thunder")) return { condition: "Thunderstorm", emoji: "⛈️" };
  if (s.includes("snow") || s.includes("sleet")) return { condition: "Snow", emoji: "🌨️" };
  if (s.includes("rain") || s.includes("shower") || s.includes("drizzle")) {
    return { condition: "Rain", emoji: "🌧️" };
  }
  if (s.includes("fog")) return { condition: "Fog", emoji: "🌫️" };
  if (s.includes("partlycloudy")) return { condition: "Partly cloudy", emoji: "⛅" };
  if (s.includes("cloud")) return { condition: "Cloudy", emoji: "☁️" };
  if (s.includes("fair")) return { condition: "Mainly clear", emoji: "🌤️" };
  if (s.includes("clear")) return { condition: "Clear", emoji: "☀️" };
  // An unfamiliar symbol should never throw away a valid temperature.
  return { condition: "Cloudy", emoji: "☁️" };
}
 
async function metNorwayWeather(stadium: StadiumInfo, target: string): Promise<GameWeather | null> {
  const data = await getJson<MetResponse>(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${stadium.lat.toFixed(4)}&lon=${stadium.lon.toFixed(4)}`,
    { "User-Agent": USER_AGENT },
  );
  const entries = data?.properties?.timeseries ?? [];
  const targetMs = Date.parse(target);
 
  let best: (typeof entries)[number] | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const diff = Math.abs(Date.parse(entry.time) - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  if (!best || bestDiff > MATCH_WINDOW_MS) return null;
 
  const celsius = best.data?.instant?.details?.air_temperature;
  if (celsius == null || !Number.isFinite(celsius)) return null;
 
  const symbol =
    best.data?.next_1_hours?.summary?.symbol_code ??
    best.data?.next_6_hours?.summary?.symbol_code ??
    best.data?.next_12_hours?.summary?.symbol_code;
  const weather = metSymbolToWeather(symbol);
 
  return {
    temperature: celsiusToFahrenheit(celsius),
    condition: weather.condition,
    emoji: dayNightEmoji(target, stadium.timezone, weather.emoji),
    high: null,
    low: null,
    isIndoor: false,
  };
}
 
/* ---------- National Weather Service (U.S. upcoming / live) ---------- */
 
interface NwsPeriod {
  startTime: string;
  endTime: string;
  temperature?: number;
  temperatureUnit?: string;
  shortForecast?: string;
}
 
async function nwsWeather(stadium: StadiumInfo, target: string): Promise<GameWeather | null> {
  const headers = { Accept: "application/geo+json", "User-Agent": USER_AGENT };
  const points = await getJson<{ properties?: { forecastHourly?: string } }>(
    `https://api.weather.gov/points/${stadium.lat.toFixed(4)},${stadium.lon.toFixed(4)}`,
    headers,
  );
  const hourlyUrl = points?.properties?.forecastHourly;
  if (!hourlyUrl) return null;
 
  const forecast = await getJson<{ properties?: { periods?: NwsPeriod[] } }>(hourlyUrl, headers);
  const periods = forecast?.properties?.periods ?? [];
  const targetMs = Date.parse(target);
 
  let best: NwsPeriod | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const period of periods) {
    const start = Date.parse(period.startTime);
    const end = Date.parse(period.endTime);
    const diff =
      targetMs >= start && targetMs <= end ? 0 : Math.min(Math.abs(targetMs - start), Math.abs(targetMs - end));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = period;
    }
  }
  if (!best || bestDiff > MATCH_WINDOW_MS) return null;
  if (best.temperature == null || !Number.isFinite(best.temperature)) return null;
 
  const temperature =
    best.temperatureUnit === "C" ? celsiusToFahrenheit(best.temperature) : Math.round(best.temperature);
  const condition = best.shortForecast || "Cloudy";
  const c = condition.toLowerCase();
 
  let emoji = "☁️";
  if (c.includes("thunder")) emoji = "⛈️";
  else if (c.includes("snow")) emoji = "🌨️";
  else if (c.includes("rain") || c.includes("shower") || c.includes("drizzle")) emoji = "🌧️";
  else if (c.includes("fog")) emoji = "🌫️";
  else if (c.includes("mostly clear")) emoji = "🌤️";
  else if (c.includes("partly")) emoji = "⛅";
  else if (c.includes("clear") || c.includes("sunny")) emoji = "☀️";
 
  return {
    temperature,
    condition,
    emoji: dayNightEmoji(target, stadium.timezone, emoji),
    high: null,
    low: null,
    isIndoor: false,
  };
}
 
/* ---------- entry point ---------- */
 
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
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
 
  const value = await loadGameWeather(input);
  // Only successful lookups are kept, so a temporary outage is retried next time.
  if (value) weatherCache.set(key, { at: Date.now(), value });
  return value;
}
 
async function loadGameWeather({
  gameId,
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
    void gameId;
 
    const stadium = getStadiumForGame(homeTeamId, venue);
    if (!stadium) return null;
 
    // Domes, retractable roofs and canopies: no outdoor weather to look up.
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
 
    if (!Number.isFinite(Date.parse(gameTime))) return null;
 
    if (isCompleted(status)) return await fetchPastWeather(stadium, gameTime);
 
    // Live games show the conditions right now; upcoming games show kickoff.
    const target = isLiveStatus(status) ? new Date().toISOString() : gameTime;
    const hourlyExtra = { past_days: "1", forecast_days: "16" };
    const dailyExtra = { past_days: "1", forecast_days: "16" };
 
    if (stadium.international) {
      const [met, daily] = await Promise.all([
        metNorwayWeather(stadium, target),
        openMeteoDaily(OPEN_METEO_FORECAST, stadium, gameTime, dailyExtra),
      ]);
      if (met) return { ...met, high: daily.high, low: daily.low };
      const backup = await openMeteoHourly(OPEN_METEO_FORECAST, stadium, target, hourlyExtra);
      return backup ? { ...backup, high: daily.high, low: daily.low } : null;
    }
 
    const [nws, daily] = await Promise.all([
      nwsWeather(stadium, target),
      openMeteoDaily(OPEN_METEO_FORECAST, stadium, gameTime, dailyExtra),
    ]);
    if (nws) return { ...nws, high: daily.high, low: daily.low };
    const backup = await openMeteoHourly(OPEN_METEO_FORECAST, stadium, target, hourlyExtra);
    return backup ? { ...backup, high: daily.high, low: daily.low } : null;
  } catch (error) {
    console.error("fetchGameWeather error:", error);
    return null;
  }
}
 
