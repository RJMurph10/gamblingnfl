/**
 * First-pitch wind forecasts for upcoming Cubs home games at Wrigley Field, from the National
 * Weather Service hourly forecast (about a week ahead). Used for the MLB best bet: wind blowing out
 * at 10+ mph → over.
 */
import { parseWindMph } from "../shared/angle-weather.server";
import { wrigleyWind, type WrigleyWind } from "./mlb";

const USER_AGENT = "GamblingNFL/1.0 https://gamblingnfl.lovable.app/";
const HEADERS = { Accept: "application/geo+json", "User-Agent": USER_AGENT };
const WRIGLEY = "41.9484,-87.6553";
const HOUR = 3_600_000;

interface NwsPeriod {
  startTime: string;
  endTime: string;
  windSpeed?: string;
  windDirection?: string;
}

let hourlyUrl: string | null = null;
let forecast: { at: number; periods: NwsPeriod[] } | null = null;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function periods(): Promise<NwsPeriod[]> {
  if (forecast && Date.now() - forecast.at < HOUR) return forecast.periods;
  if (!hourlyUrl) {
    const p = await getJson<{ properties?: { forecastHourly?: string } }>(
      `https://api.weather.gov/points/${WRIGLEY}`,
    );
    hourlyUrl = p?.properties?.forecastHourly ?? null;
    if (!hourlyUrl) return [];
  }
  const f = await getJson<{ properties?: { periods?: NwsPeriod[] } }>(hourlyUrl);
  const list = f?.properties?.periods ?? [];
  if (list.length) forecast = { at: Date.now(), periods: list };
  return list;
}

/** Wind at first pitch for each game (null when it's beyond the forecast window). */
export async function fetchWrigleyWind(
  games: { id: string; date: string }[],
): Promise<Record<string, WrigleyWind | null>> {
  const list = games.length ? await periods() : [];
  const out: Record<string, WrigleyWind | null> = {};
  for (const g of games.slice(0, 20)) {
    const t = Date.parse(g.date);
    const p = list.find((x) => t >= Date.parse(x.startTime) && t < Date.parse(x.endTime));
    out[g.id] = p ? wrigleyWind(parseWindMph(p.windSpeed), p.windDirection ?? null) : null;
  }
  return out;
}
