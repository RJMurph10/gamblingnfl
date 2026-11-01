/**
 * Server-only: historical player prop lines with results, for the "Prop history" pages. Read from the
 * repo's props-site branch (built from ESPN by scripts/line-history/build-props-site.mjs, refreshed
 * daily by .github/workflows/props-daily.yml). Past seasons are cached long-term.
 */
import { finalCached } from "./final-cache.server";

const BASE = "https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site";
const MINUTE = 60_000;

/** [player, team, market, line, over price, under price, actual] */
export type PropHistoryRow = [
  string,
  string,
  string,
  number,
  number | null,
  number | null,
  number | null,
];

export interface PropHistoryGame {
  id: string;
  date: string;
  name: string;
  away: { abbr: string; name: string; score: number | null };
  home: { abbr: string; name: string; score: number | null };
  props: PropHistoryRow[];
}

export interface PropHistoryDay {
  seasons: string[];
  season: string;
  days: string[];
  day: string | null;
  games: PropHistoryGame[];
}

const memo = new Map<string, { at: number; value: unknown }>();
async function getJson<T>(url: string, ttl: number): Promise<T | null> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const value = (await res.json()) as T;
    memo.set(url, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

export async function fetchPropHistory(
  league: "nba" | "nfl",
  season?: string,
  day?: string,
): Promise<PropHistoryDay> {
  const index = await getJson<{ seasons: Record<string, string[]> }>(
    `${BASE}/${league}/index.json`,
    15 * MINUTE,
  );
  const seasons = Object.keys(index?.seasons ?? {})
    .filter((s) => (index?.seasons[s]?.length ?? 0) > 0)
    .sort()
    .reverse();
  const s = season && seasons.includes(season) ? season : (seasons[0] ?? "");
  const days = index?.seasons[s] ?? [];
  const d = day && days.includes(day) ? day : (days[days.length - 1] ?? null);
  let games: PropHistoryGame[] = [];
  if (d) {
    const url = `${BASE}/${league}/${s}/${d}.json`;
    const isCurrent = s === seasons[0];
    games = isCurrent
      ? ((await getJson<PropHistoryGame[]>(url, 15 * MINUTE)) ?? [])
      : await finalCached(
          `prop-history-v1-${league}-${s}-${d}`,
          async () => {
            const g = await getJson<PropHistoryGame[]>(url, 60 * MINUTE);
            if (!g) throw new Error("prop history unavailable");
            return g;
          },
          (g) => g.length > 0,
        ).catch(() => []);
  }
  return { seasons, season: s, days, day: d, games };
}

/* ---------- upcoming games: DraftKings lines posted now ---------- */

/** [player, team, market, current line, over, under, opening line] */
export type UpcomingPropRow = [
  string,
  string,
  string,
  number,
  number | null,
  number | null,
  number | null,
];

export interface UpcomingPropGame {
  id: string;
  date: string;
  name: string;
  /** When these lines were captured. */
  at?: string;
  away: { abbr: string; name: string };
  home: { abbr: string; name: string };
  props: UpcomingPropRow[];
}

/**
 * Upcoming games with the DraftKings player lines posted so far. Built hourly by the line logger
 * (scripts/line-history/build-upcoming.mjs) from its saved snapshots, so the site needs one small read.
 */
export async function fetchUpcomingProps(league: "nba" | "nfl"): Promise<UpcomingPropGame[]> {
  const games =
    (await getJson<UpcomingPropGame[]>(`${BASE}/${league}/upcoming.json`, 5 * MINUTE)) ?? [];
  const now = Date.now();
  return games.filter((g) => Date.parse(g.date) > now);
}
