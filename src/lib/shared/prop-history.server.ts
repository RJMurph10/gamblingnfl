/**
 * Server-only: historical player prop lines with results, for the "Prop history" pages. Read from the
 * repo's props-site branch (built from ESPN by scripts/line-history/build-props-site.mjs, refreshed
 * daily by .github/workflows/props-daily.yml). Past seasons are cached long-term.
 */
import { finalCached } from "./final-cache.server";

const BASE = "https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site";
const MINUTE = 60_000;

/** [player, team, market, line, over price, under price, actual] */
export type PropLeague = "nba" | "nfl" | "nhl" | "mlb";

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
/**
 * Fetch JSON with a short memo. A failed fetch retries once, then falls back to the last good copy
 * (however old) rather than nothing, so a slow or rate-limited GitHub response never empties the page.
 */
async function getJson<T>(url: string, ttl: number, mirror?: string): Promise<T | null> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  for (const u of [url, url, ...(mirror ? [mirror] : [])]) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const value = (await res.json()) as T;
      memo.set(url, { at: Date.now(), value });
      return value;
    } catch {
      // try again / the mirror
    }
  }
  return (hit?.value as T | undefined) ?? null;
}

export async function fetchPropHistory(
  league: PropLeague,
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
  /** DraftKings' alternate over lines ("X+"), [[line, over price], ...], when saved. */
  ([number, number][] | undefined)?,
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
export async function fetchUpcomingProps(league: PropLeague): Promise<UpcomingPropGame[]> {
  const games =
    (await getJson<UpcomingPropGame[]>(
      `${BASE}/${league}/upcoming.json`,
      5 * MINUTE,
      // jsDelivr's copy of the same branch (can lag a few hours, but keeps the games up)
      `https://cdn.jsdelivr.net/gh/RJMurph10/gamblingnfl@props-site/${league}/upcoming.json`,
    )) ?? [];
  const now = Date.now();
  return games.filter((g) => Date.parse(g.date) > now);
}

/**
 * A started or finished NFL game's closing DraftKings board (the last snapshot before kickoff), from
 * build-upcoming.mjs: same shape as an upcoming game. Null when none was saved.
 */
export async function fetchClosedProps(
  league: PropLeague,
  id: string,
): Promise<UpcomingPropGame | null> {
  if (!/^\d+$/.test(id)) return null;
  return getJson<UpcomingPropGame>(`${BASE}/${league}/closed/${id}.json`, 30 * MINUTE);
}
