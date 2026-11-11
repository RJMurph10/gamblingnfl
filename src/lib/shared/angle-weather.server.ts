/**
 * Kickoff forecasts (temperature, wind, rain during the game) for upcoming games: the ★ wind
 * unders and the watch-list angles.
 * U.S. outdoor stadiums only, from the National Weather Service hourly forecast (about a week
 * ahead). Domes and closed stadiums need no request. International games are skipped.
 */

import { getStadiumForGame } from "@/lib/nfl/stadiums";
import type { GameConditions } from "../nfl/watch-angles";

const USER_AGENT = "GamblingNFL/1.0 https://gamblingnfl.lovable.app/";
const HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };
const HOUR = 3_600_000;

interface NwsPeriod {
  startTime: string;
  endTime: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  shortForecast?: string;
  probabilityOfPrecipitation?: { value?: number | null };
}

const RAIN = /rain|shower|drizzle|thunderstorm|t-storm/i;

/** Hours from kickoff through the 3rd hour of the game with rain forecast at a 50%+ chance. */
export function rainHoursOf(periods: NwsPeriod[], kickoffMs: number): number {
  let n = 0;
  for (const p of periods) {
    const start = Date.parse(p.startTime);
    if (start < kickoffMs - HOUR || start > kickoffMs + 3 * HOUR) continue;
    const chance = p.probabilityOfPrecipitation?.value ?? 0;
    if (chance >= 50 && RAIN.test(p.shortForecast ?? "")) n++;
  }
  return n;
}

interface GridSeries {
  uom?: string;
  values?: { validTime: string; value: number | null }[];
}

/** "PT6H" / "P1DT2H" / "PT30M" → milliseconds. */
export function isoDurationMs(d: string): number {
  const m = d.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if (!m) return HOUR;
  return ((+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 60_000;
}

/** A gridpoint series as [start, end, value] spans. */
function spans(s: GridSeries | undefined): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const v of s?.values ?? []) {
    if (v.value === null || v.value === undefined) continue;
    const [at, dur] = v.validTime.split("/");
    const start = Date.parse(at);
    out.push([start, start + isoDurationMs(dur ?? "PT1H"), v.value]);
  }
  return out;
}

/** Amount falling in [from, to): each period's total shared out by overlap. */
export function amountIn(s: GridSeries | undefined, from: number, to: number): number | null {
  const sp = spans(s);
  if (!sp.length) return null;
  let total = 0;
  for (const [a, b, v] of sp) {
    const o = Math.min(b, to) - Math.max(a, from);
    if (o > 0) total += (v * o) / (b - a);
  }
  return total;
}

/** Highest value of a series over [from, to). */
export function maxIn(s: GridSeries | undefined, from: number, to: number): number | null {
  let best: number | null = null;
  for (const [a, b, v] of spans(s))
    if (b > from && a < to) best = best === null ? v : Math.max(best, v);
  return best;
}

const KMH_TO_MPH = 0.621371;
const mmToIn = (mm: number | null) =>
  mm === null ? undefined : Math.round((mm / 25.4) * 100) / 100;

/** Stadium point → hourly forecast URL (doesn't change, kept for the life of the worker). */
const hourlyUrlCache = new Map<string, string>();
/** Stadium point → gridpoint data URL (gusts, rain and snow amounts). */
const gridUrlCache = new Map<string, string>();
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
    const points = await getJson<{
      properties?: { forecastHourly?: string; forecastGridData?: string };
    }>(`https://api.weather.gov/points/${pointKey}`);
    hourly = points?.properties?.forecastHourly;
    if (!hourly) return null;
    hourlyUrlCache.set(pointKey, hourly);
    if (points?.properties?.forecastGridData)
      gridUrlCache.set(pointKey, points.properties.forecastGridData);
  }
  const gridUrl = gridUrlCache.get(pointKey);
  const [forecast, grid] = await Promise.all([
    getJson<{ properties?: { periods?: NwsPeriod[] } }>(hourly),
    gridUrl
      ? getJson<{
          properties?: {
            windGust?: GridSeries;
            quantitativePrecipitation?: GridSeries;
            snowfallAmount?: GridSeries;
          };
        }>(gridUrl)
      : Promise.resolve(null),
  ]);
  const target = Date.parse(g.kickoffIso);
  const periods = forecast?.properties?.periods ?? [];
  const period = periods.find((p) => {
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
  // the game window: kickoff through the 4th hour
  const g4 = grid?.properties;
  const gustKmh = maxIn(g4?.windGust, target, target + 4 * HOUR);
  const precipMm = amountIn(g4?.quantitativePrecipitation, target, target + 4 * HOUR);
  const snowMm = amountIn(g4?.snowfallAmount, target, target + 4 * HOUR);
  return {
    outdoor: true,
    temp,
    wind: parseWindMph(period.windSpeed),
    rainHours: rainHoursOf(periods, target),
    ...(gustKmh !== null ? { gustMph: Math.round(gustKmh * KMH_TO_MPH) } : {}),
    ...(precipMm !== null ? { precipIn: mmToIn(precipMm) } : {}),
    ...(snowMm !== null ? { snowIn: mmToIn(snowMm) } : {}),
    source: "forecast",
  };
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
