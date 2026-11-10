/**
 * Game-day run factors for the MLB model: temperature, wind blowing out / in / across (much stronger at
 * Wrigley), and a team playing a day game right after a night game. Multipliers on each team's expected
 * runs, fit on 2012-2025 (research/mlb/scripts/open_variants.py, sitebase.py) with the site's own run
 * projection as the base, walk-forward. With them the site's totals beat the OPENING total on unders in
 * every season 2021-2025 (DraftKings / FanDuel, 5%+ edge: +3.4% to +3.7% ROI, no starting pitchers in the
 * test); at the close they don't, so these are bet-early picks. Pure functions.
 */
import { MLB_PARKS, type MlbPark } from "@/data/mlb/parks";
import type { MlbGame } from "./mlb";

/** Poisson coefficients (per side, log scale). Units below. */
export const GAME_DAY_COEF = {
  /** per 10°F above 72 */
  temp: 0.03024,
  /** per 10 mph blowing out / in / across */
  windOut: 0.0209,
  windIn: 0.00401,
  windCross: 0.00799,
  /** extra at Wrigley, per 10 mph */
  wrigleyOut: 0.15631,
  wrigleyIn: -0.09175,
  /** batting team plays a day game the day after a night game */
  dayAfterNight: -0.01742,
} as const;

export interface GameWeather {
  /** First-pitch forecast, °F. */
  tempF: number | null;
  /** First-pitch wind, mph. */
  windMph: number | null;
  /** Compass direction the wind blows FROM ("SW"). */
  windFrom: string | null;
}

const COMPASS = [
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
const fromDegrees = (from: string | null) => {
  const i = COMPASS.indexOf((from ?? "").toUpperCase());
  return i < 0 ? null : i * 22.5;
};

/**
 * Wind relative to the field: "out" (toward left, center or right field), "in", or "cross".
 * The wind blows TOWARD from + 180°; compare with the home plate → center field direction.
 */
export function windRelative(
  from: string | null,
  park: Pick<MlbPark, "azimuth">,
): "out" | "in" | "cross" | null {
  const f = fromDegrees(from);
  if (f === null) return null;
  const toward = (f + 180) % 360;
  const d = Math.abs(((((toward - park.azimuth) % 360) + 540) % 360) - 180);
  return d <= 67.5 ? "out" : d >= 112.5 ? "in" : "cross";
}

export const parkOf = (g: Pick<MlbGame, "home">): MlbPark | undefined =>
  MLB_PARKS[g.home.team.abbr.toUpperCase()];

/** True when the park has no weather (dome, or a retractable roof, treated as closed). */
export const indoors = (p: MlbPark | undefined) => !p || p.roof !== "open";

/** Approximate local start hour from the park's longitude (solar time; good enough for day vs night). */
export function localHour(iso: string, lon: number): number {
  const d = new Date(iso);
  return (d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15 + 24) % 24;
}
export const isNight = (g: Pick<MlbGame, "date" | "home">) => {
  const p = parkOf(g);
  return localHour(g.date, p?.lon ?? -80) >= 17;
};

/** For each game: did the away / home team play a NIGHT game the previous day, and is this a day game? */
export function dayAfterNight(games: MlbGame[]): Map<string, { away: boolean; home: boolean }> {
  const sorted = [...games]
    .filter((g) => g.status !== "postponed")
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = new Map<string, { day: string; night: boolean }>();
  const out = new Map<string, { away: boolean; home: boolean }>();
  const dayKey = (g: MlbGame) => {
    const p = parkOf(g);
    return new Date(Date.parse(g.date) + ((p?.lon ?? -80) / 15) * 3_600_000)
      .toISOString()
      .slice(0, 10);
  };
  const prevDay = (k: string) =>
    new Date(Date.parse(`${k}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  for (const g of sorted) {
    const k = dayKey(g);
    const night = isNight(g);
    const flag = (team: string) => {
      const p = last.get(team);
      return Boolean(p && p.night && p.day === prevDay(k) && !night);
    };
    out.set(g.id, { away: flag(g.away.team.id), home: flag(g.home.team.id) });
    last.set(g.away.team.id, { day: k, night });
    last.set(g.home.team.id, { day: k, night });
  }
  return out;
}

export interface GameDayFactor {
  away: number;
  home: number;
  /** What went in, for display. */
  why: string[];
}

/** Multipliers on the away / home teams' expected runs. */
export function gameDayFactor(
  g: Pick<MlbGame, "home">,
  weather: GameWeather | null | undefined,
  dan?: { away: boolean; home: boolean },
): GameDayFactor {
  const p = parkOf(g);
  const c = GAME_DAY_COEF;
  let x = 0;
  const why: string[] = [];
  if (!indoors(p) && weather) {
    if (weather.tempF != null) {
      x += (c.temp * (weather.tempF - 72)) / 10;
      why.push(`${Math.round(weather.tempF)}°F`);
    }
    const rel = p ? windRelative(weather.windFrom, p) : null;
    const mph = weather.windMph ?? 0;
    if (rel && mph > 0) {
      const wrigley = g.home.team.abbr.toUpperCase() === "CHC";
      const k =
        rel === "out"
          ? c.windOut + (wrigley ? c.wrigleyOut : 0)
          : rel === "in"
            ? c.windIn + (wrigley ? c.wrigleyIn : 0)
            : c.windCross;
      x += (k * mph) / 10;
      why.push(
        `wind ${Math.round(mph)} mph ${rel === "out" ? "out" : rel === "in" ? "in" : "across"}`,
      );
    }
  } else if (indoors(p)) {
    why.push(p?.roof === "dome" ? "dome" : "roof (assumed closed)");
  }
  const away = Math.exp(x + (dan?.away ? c.dayAfterNight : 0));
  const home = Math.exp(x + (dan?.home ? c.dayAfterNight : 0));
  if (dan?.away) why.push("away: day game after a night game");
  if (dan?.home) why.push("home: day game after a night game");
  return { away, home, why };
}
