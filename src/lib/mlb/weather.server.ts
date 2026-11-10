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

/* ---------- past games: first-pitch weather from the Open-Meteo archive ---------- */

const COMPASS16 = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];
export const compassOf = (deg: number) =>
  COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

interface Hourly {
  time: string[];
  temperature_2m: (number | null)[];
  wind_speed_10m: (number | null)[];
  wind_direction_10m: (number | null)[];
}
const archive = new Map<string, { at: number; hourly: Hourly | null }>();

async function archiveHours(team: string, start: string, end: string): Promise<Hourly | null> {
  const park = MLB_PARKS[team];
  if (!park) return null;
  const key = `${team}|${start}|${end}`;
  const hit = archive.get(key);
  if (hit && Date.now() - hit.at < 12 * HOUR) return hit.hourly;
  const q = new URLSearchParams({
    latitude: park.lat.toFixed(4),
    longitude: park.lon.toFixed(4),
    start_date: start,
    end_date: end,
    hourly: "temperature_2m,wind_speed_10m,wind_direction_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "GMT",
  });
  let hourly: Hourly | null = null;
  try {
    const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${q}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    hourly = res.ok ? (((await res.json()) as { hourly?: Hourly }).hourly ?? null) : null;
  } catch {
    hourly = null;
  }
  if (hourly) archive.set(key, { at: Date.now(), hourly });
  return hourly ?? hit?.hourly ?? null;
}

/**
 * Weather at first pitch for finished games at open-air parks (one archive request per park for the
 * whole span), so the season grade uses the same game-day factors as the live picks. The archive runs
 * about five days behind; games newer than that get null (no weather factor).
 */
export async function fetchMlbPastWeather(
  games: [id: string, date: string, home: string][],
): Promise<Record<string, GameWeather | null>> {
  const out: Record<string, GameWeather | null> = {};
  const byTeam = new Map<string, [string, string][]>();
  for (const [id, date, home] of games) {
    const t = home.toUpperCase();
    if (MLB_PARKS[t]?.roof !== "open") continue;
    byTeam.set(t, [...(byTeam.get(t) ?? []), [id, date]]);
  }
  const lastDay = new Date(Date.now() - 6 * 24 * HOUR).toISOString().slice(0, 10);
  await Promise.all(
    [...byTeam].map(async ([team, list]) => {
      const days = list.map(([, d]) => d.slice(0, 10)).sort();
      const end = days[days.length - 1] < lastDay ? days[days.length - 1] : lastDay;
      if (days[0] > end) return;
      const h = await archiveHours(team, days[0], end);
      if (!h) return;
      const at = new Map(h.time.map((t, i) => [t.slice(0, 13), i]));
      for (const [id, date] of list) {
        // nearest hour to first pitch
        const i = at.get(
          new Date(Math.round(Date.parse(date) / HOUR) * HOUR).toISOString().slice(0, 13),
        );
        if (i === undefined) continue;
        const dir = h.wind_direction_10m[i];
        out[id] = {
          tempF: h.temperature_2m[i] ?? null,
          windMph: h.wind_speed_10m[i] ?? null,
          windFrom: dir == null ? null : compassOf(dir),
        };
      }
    }),
  );
  return out;
}
