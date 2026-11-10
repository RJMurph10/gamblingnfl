/**
 * First-pitch temperature and wind for upcoming MLB games at every open-air park, from the National
 * Weather Service hourly forecast (about a week ahead). Feeds the game-day run factors (game-day.ts).
 * Domes and retractable roofs are skipped (treated as closed). Cached an hour per park.
 */
import { MLB_PARKS } from "@/data/mlb/parks";
import { parseWindMph } from "../shared/angle-weather.server";
import type { GameWeather } from "./game-day";

const USER_AGENT = "GamblingNFL/1.0 https://gamblingnfl.lovable.app/";
const HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };
const HOUR = 3_600_000;

interface NwsPeriod {
  startTime: string;
  endTime: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
}

const hourlyUrl = new Map<string, string>();
const cache = new Map<string, { at: number; periods: NwsPeriod[] }>();

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function periods(team: string): Promise<NwsPeriod[]> {
  const park = MLB_PARKS[team];
  if (!park) return [];
  const hit = cache.get(team);
  if (hit && Date.now() - hit.at < HOUR) return hit.periods;
  let url = hourlyUrl.get(team);
  if (!url) {
    const p = await getJson<{ properties?: { forecastHourly?: string } }>(
      `https://api.weather.gov/points/${park.lat.toFixed(4)},${park.lon.toFixed(4)}`,
    );
    url = p?.properties?.forecastHourly ?? undefined;
    if (!url) return hit?.periods ?? [];
    hourlyUrl.set(team, url);
  }
  const f = await getJson<{ properties?: { periods?: NwsPeriod[] } }>(url);
  const list = f?.properties?.periods ?? [];
  if (list.length) cache.set(team, { at: Date.now(), periods: list });
  return list.length ? list : (hit?.periods ?? []);
}

/** Forecast at first pitch for each game (null: indoors, unknown park, or beyond the forecast). */
export async function fetchMlbWeather(
  games: { id: string; date: string; home: string }[],
): Promise<Record<string, GameWeather | null>> {
  const out: Record<string, GameWeather | null> = {};
  const teams = [...new Set(games.map((g) => g.home.toUpperCase()))].filter(
    (t) => MLB_PARKS[t]?.roof === "open",
  );
  const byTeam = new Map(await Promise.all(teams.map(async (t) => [t, await periods(t)] as const)));
  for (const g of games) {
    const list = byTeam.get(g.home.toUpperCase());
    const t = Date.parse(g.date);
    const p = list?.find((x) => t >= Date.parse(x.startTime) && t < Date.parse(x.endTime));
    out[g.id] = p
      ? {
          tempF:
            typeof p.temperature === "number"
              ? p.temperatureUnit === "C"
                ? p.temperature * 1.8 + 32
                : p.temperature
              : null,
          windMph: parseWindMph(p.windSpeed),
          windFrom: p.windDirection ?? null,
        }
      : null;
  }
  return out;
}
