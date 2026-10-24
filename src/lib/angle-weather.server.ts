/**
 * Kickoff forecasts (temperature + wind) for upcoming games, for the watch-list angles.
 * U.S. outdoor stadiums only, from the National Weather Service hourly forecast (about a week
 * ahead). Domes and closed stadiums need no request. International games are skipped.
 */

import { getStadiumForGame } from "@/lib/stadiums";
import type { GameConditions } from "./watch-angles";

const USER_AGENT = "GamblingNFL/1.0 https://gamblingnfl.lovable.app/";
const HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };
const HOUR = 3_600_000;

interface NwsPeriod {
  startTime: string;
  endTime: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
}

/** Stadium point → hourly forecast URL (doesn't change, kept for the life of the worker). */
const hourlyUrlCache = new Map<string, string>();
const forecastCache = new Map<string, { at: number; value: GameConditions | null }>();

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** "10 mph" → 10, "10 to 15 mph" → 12.5. */
export function parseWindMph(text: string | undefined): number | null {
  const nums = (text ?? "").match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export interface ForecastRequest {
  id: string;
  homeTeamId: string;
  venue?: string;
  kickoffIso: string;
  /** College games: the outdoor stadium's location (NFL games are looked up by team). */
  lat?: number;
  lon?: number;
}

async function forecastOne(g: ForecastRequest): Promise<GameConditions | null> {
  const stadium =
    g.lat !== undefined && g.lon !== undefined
      ? { lat: g.lat, lon: g.lon, isIndoor: false, international: false }
      : getStadiumForGame(g.homeTeamId, g.venue);
  if (!stadium || stadium.international) return null;
  if (stadium.isIndoor) return { outdoor: false, temp: null, wind: null, source: "forecast" };

  const pointKey = `${stadium.lat.toFixed(4)},${stadium.lon.toFixed(4)}`;
  let hourly = hourlyUrlCache.get(pointKey);
  if (!hourly) {
    const points = await getJson<{ properties?: { forecastHourly?: string } }>(
      `https://api.weather.gov/points/${pointKey}`,
    );
    hourly = points?.properties?.forecastHourly;
    if (!hourly) return null;
    hourlyUrlCache.set(pointKey, hourly);
  }
  const forecast = await getJson<{ properties?: { periods?: NwsPeriod[] } }>(hourly);
  const target = Date.parse(g.kickoffIso);
  const period = (forecast?.properties?.periods ?? []).find((p) => {
    const start = Date.parse(p.startTime);
    const end = Date.parse(p.endTime);
    return target >= start && target < end;
  });
  if (!period) return null; // kickoff beyond the forecast window
  const temp =
    typeof period.temperature === "number"
      ? period.temperatureUnit === "C"
        ? Math.round((period.temperature * 9) / 5 + 32)
        : Math.round(period.temperature)
      : null;
  return { outdoor: true, temp, wind: parseWindMph(period.windSpeed), source: "forecast" };
}

/** Kickoff conditions for each requested game, by game id (null when not available). */
export async function fetchAngleForecasts(
  games: ForecastRequest[],
): Promise<Record<string, GameConditions | null>> {
  const out: Record<string, GameConditions | null> = {};
  await Promise.all(
    games.slice(0, 16).map(async (g) => {
      const key = `${g.id}|${g.kickoffIso}`;
      const hit = forecastCache.get(key);
      if (hit && Date.now() - hit.at < HOUR) {
        out[g.id] = hit.value;
        return;
      }
      const value = await forecastOne(g).catch(() => null);
      if (value) forecastCache.set(key, { at: Date.now(), value });
      out[g.id] = value;
    }),
  );
  return out;
}
