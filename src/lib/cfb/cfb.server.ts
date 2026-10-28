/**
 * Server-only college football (FBS) data from ESPN's public feeds: the weekly scoreboard,
 * FBS conferences and teams (standings), and the AP / CFP rankings. Each request makes at most a
 * few ESPN calls, and results are cached in memory.
 */

import { finalCached } from "../shared/final-cache.server";
import {
  currentWeek,
  parseEvent,
  parseTeamRef,
  type CfbConference,
  type CfbGame,
  type CfbTeamRef,
  type CfbWeek,
} from "./cfb";
import { CURRENT_SEASON } from "@/lib/shared/espn-core.server";
import { fetchCfbCalendar, fetchCfbSchedule, fetchCfbPriorSeasonResults, fetchCfbGameProjections, fetchCollegePlayerGameLog, fetchConferenceTeamOverviewStats, fetchFbsConferences } from "@/lib/cfb/cfb-espn.server";

export {
  fetchCfbGameProjections,
  fetchCfbPriorSeasonResults,
  fetchCfbSchedule,
  fetchCollegePlayerGameLog,
  fetchConferenceTeamOverviewStats,
};

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/football/college-football/standings";
/** ESPN group 80 = FBS. */
const FBS = 80;

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "GamblingNFL/1.0" } });
  if (!res.ok) throw new Error(`ESPN college feed failed [${res.status}] for ${url}`);
  return res.json();
}

const MINUTE = 60_000;

/** FBS conferences with their teams and records (refreshed every 30 minutes). */
export function fetchCfbConferences(): Promise<CfbConference[]> {
  return fetchFbsConferences();
}

async function fbsTeamIds(): Promise<Set<string>> {
  try {
    const conferences = await fetchCfbConferences();
    return new Set(conferences.flatMap((c) => c.teams.map((t) => t.id)));
  } catch {
    return new Set();
  }
}

export interface CfbWeekSlate {
  season: number;
  week: number;
  /** The week in progress right now (for the "this week" default). */
  currentWeek: number;
  weeks: CfbWeek[];
  games: CfbGame[];
}

/**
 * One regular-season week of FBS games (including FBS teams' games against FCS opponents).
 * Without a week, the week in progress. Live weeks refresh every minute, others every 10.
 */
export async function fetchCfbWeek(week?: number): Promise<CfbWeekSlate> {
  const calendar = await fetchCfbCalendar();
  const now = currentWeek(calendar);
  const target = week ?? now;
  const ids = await fbsTeamIds();
  const loadWeek = () => cached<CfbGame[]>(
    `cfb-week-${target}`,
    target === now ? MINUTE : 10 * MINUTE,
    async () => {
      const data = await fetchJson(
        `${SITE}/scoreboard?groups=${FBS}&dates=${CURRENT_SEASON}&seasontype=2&week=${target}&limit=400`,
      );
      return (data?.events ?? [])
        .map((e: any) => parseEvent(e, target, ids.size ? ids : undefined))
        .filter((g: CfbGame | null): g is CfbGame => g !== null)
        .sort((a: CfbGame, b: CfbGame) => a.date.localeCompare(b.date));
    },
  );
  // Past weeks whose games are all final can't change: keep them long-term (FBS team list included in the key).
  const games: CfbGame[] =
    target < now
      ? await finalCached(`cfb-week-${CURRENT_SEASON}-${target}-${ids.size}`, loadWeek, (g) => g.length > 0 && g.every((x) => x.status === "final"))
      : await loadWeek();
  return { season: CURRENT_SEASON, week: target, currentWeek: now, weeks: calendar, games };
}

export interface CfbRanking {
  poll: string;
  ranks: { rank: number; previous?: number; team: CfbTeamRef; record?: string }[];
}

/** This week's polls (AP Top 25, and the CFP rankings once they're out). */
export function fetchCfbRankings(): Promise<CfbRanking[]> {
  return cached("cfb-rankings", 30 * MINUTE, async () => {
    const data = await fetchJson(`${SITE}/rankings`);
    return (data?.rankings ?? []).map((r: any) => ({
      poll: String(r.shortName ?? r.name ?? ""),
      ranks: (r.ranks ?? []).map((x: any) => ({
        rank: Number(x.current),
        previous: Number.isFinite(Number(x.previous)) ? Number(x.previous) : undefined,
        team: parseTeamRef({ ...x.team, logo: x.team?.logos?.[0]?.href ?? x.team?.logo }),
        record: x.recordSummary,
      })),
    }));
  });
}
