/**
 * Server-only ESPN public data feed integration.
 *
 * Pulls the real 2026 NFL regular-season schedule, results, and game
 * summaries from ESPN's public scoreboard/summary endpoints and maps them
 * into the app's `Game` shape. This is a read-only live source used until
 * the user's own Supabase tables are populated.
 */

import type { BoxScoreLine, Drive, DriveResult, Game, TeamGameStats } from "@/data/games";
import { teamByAbbr } from "@/data/teams";

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

const SEASON = 2026;
const REGULAR_SEASON_WEEKS = 18;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  at: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "GamblingNFL/1.0" } });
  if (!res.ok) throw new Error(`ESPN feed failed [${res.status}] for ${url}`);
  return res.json();
}

const zeroStats = (): TeamGameStats => ({
  totalYards: 0,
  passYards: 0,
  rushYards: 0,
  firstDowns: 0,
  thirdDownPct: 0,
  turnovers: 0,
  penalties: 0,
  timeOfPossession: "00:00",
});

function mapStatus(name: string | undefined): Game["status"] {
  if (name === "STATUS_FINAL") return "final";
  if (name === "STATUS_IN_PROGRESS" || name === "STATUS_HALFTIME") return "live";
  return "scheduled";
}

function formatKickoff(iso: string | undefined): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }) +
    " " +
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) +
    " ET"
  );
}

function mapEvent(event: any, week: number): Game | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp.competitors?.find((c: any) => c.homeAway === "away");
  const homeTeam = teamByAbbr(home?.team?.abbreviation ?? "");
  const awayTeam = teamByAbbr(away?.team?.abbreviation ?? "");
  if (!homeTeam || !awayTeam) return null;

  const line = (c: any) =>
    (c?.linescores ?? []).map((ls: any) => Math.round(Number(ls?.value ?? 0)));
  const awayQ = line(away);
  const homeQ = line(home);
  const odds = comp.odds?.[0];

  return {
    id: `espn-${event.id}`,
    week,
    kickoff: formatKickoff(event.date),
    status: mapStatus(comp.status?.type?.name),
    venue: comp.venue?.fullName ?? "TBD",
    awayTeamId: awayTeam.id,
    homeTeamId: homeTeam.id,
    quarters: {
      away: awayQ.length ? awayQ : [0, 0, 0, 0],
      home: homeQ.length ? homeQ : [0, 0, 0, 0],
    },
    spread: odds?.details ?? "—",
    total: typeof odds?.overUnder === "number" ? odds.overUnder : 0,
    drives: [],
    stats: { away: zeroStats(), home: zeroStats() },
    boxScore: [],
  };
}

/** Full 2026 regular-season schedule with results, grouped by week. */
export async function fetchSchedule(): Promise<Game[]> {
  return cached("schedule", async () => {
    const weeks = await Promise.all(
      Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) =>
        fetchJson(`${SCOREBOARD}?dates=${SEASON}&seasontype=2&week=${i + 1}&limit=100`)
          .then((d) => ({ week: i + 1, events: d?.events ?? [] }))
          .catch(() => ({ week: i + 1, events: [] })),
      ),
    );
    const games: Game[] = [];
    for (const { week, events } of weeks) {
      for (const event of events) {
        const game = mapEvent(event, week);
        if (game) games.push(game);
      }
    }
    return games;
  });
}

const DRIVE_RESULTS: Record<string, DriveResult> = {
  TD: "TD",
  FG: "FG",
  PUNT: "PUNT",
  FUMBLE: "TO",
  INTERCEPTION: "TO",
  DOWNS: "DOWNS",
  "END OF HALF": "EOH",
  "END OF GAME": "EOG",
};

function mapDriveResult(text: string | undefined): DriveResult {
  const key = (text ?? "").toUpperCase();
  for (const [k, v] of Object.entries(DRIVE_RESULTS)) if (key.includes(k)) return v;
  return "PUNT";
}

function statNum(stats: any[], name: string): number {
  const s = stats.find((x: any) => x.name === name);
  return s ? Number(String(s.displayValue).replace(/,/g, "")) || 0 : 0;
}

function mapTeamStats(stats: any[]): TeamGameStats {
  const third = stats.find((x: any) => x.name === "thirdDownEff")?.displayValue ?? "0-0";
  const [made, att] = third.split("-").map((n: string) => Number(n) || 0);
  const pen = stats.find((x: any) => x.name === "penalties")?.displayValue ?? "0-0";
  return {
    totalYards: statNum(stats, "totalYards"),
    passYards: statNum(stats, "netPassingYards"),
    rushYards: statNum(stats, "rushingYards"),
    firstDowns: statNum(stats, "firstDowns"),
    thirdDownPct: att > 0 ? Math.round((made / att) * 100) : 0,
    turnovers: statNum(stats, "turnovers"),
    penalties: Number(pen.split("-")[0]) || 0,
    timeOfPossession:
      stats.find((x: any) => x.name === "possessionTime")?.displayValue ?? "00:00",
  };
}

function mapBoxScore(players: any[], awayTeamId: string, homeTeamId: string): BoxScoreLine[] {
  const lines: BoxScoreLine[] = [];
  const wanted = new Set(["passing", "rushing", "receiving"]);
  for (const teamBlock of players ?? []) {
    const teamId = teamByAbbr(teamBlock?.team?.abbreviation ?? "")?.id;
    if (!teamId || (teamId !== awayTeamId && teamId !== homeTeamId)) continue;
    for (const group of teamBlock?.statistics ?? []) {
      if (!wanted.has(group?.name)) continue;
      const athlete = group?.athletes?.[0];
      if (!athlete?.athlete?.displayName) continue;
      const keys: string[] = group.keys ?? [];
      const vals: string[] = athlete.stats ?? [];
      const pick = (...names: string[]) =>
        names
          .map((n) => {
            const i = keys.indexOf(n);
            return i >= 0 ? vals[i] : undefined;
          })
          .filter(Boolean)
          .join(", ");
      const statLine =
        group.name === "passing"
          ? `${pick("completions/passingAttempts")}, ${pick("passingYards")} yds, ${pick("passingTouchdowns")} TD, ${pick("interceptions")} INT`
          : group.name === "rushing"
            ? `${pick("rushingAttempts")} car, ${pick("rushingYards")} yds, ${pick("rushingTouchdowns")} TD`
            : `${pick("receptions")} rec, ${pick("receivingYards")} yds, ${pick("receivingTouchdowns")} TD`;
      lines.push({
        name: athlete.athlete.displayName,
        position: athlete.athlete.position?.abbreviation ?? group.name.toUpperCase(),
        teamId,
        statLine,
      });
    }
  }
  return lines;
}

/** Full game detail (quarters, drives, team stats, box score) for one event. */
export async function fetchGameDetail(eventId: string): Promise<Game | null> {
  return cached(`game-${eventId}`, async () => {
    const d = await fetchJson(`${SUMMARY}?event=${eventId}`);
    const comp = d?.header?.competitions?.[0];
    if (!comp) return null;
    const week = d?.header?.week ?? 0;
    const base = mapEvent({ id: eventId, date: comp.date ?? d?.header?.date, competitions: [comp] }, week);
    if (!base) return null;

    // The summary header omits quarter linescores and venue; merge them from
    // the week's scoreboard event.
    const sb = await fetchJson(`${SCOREBOARD}?dates=${SEASON}&seasontype=2&week=${week}&limit=100`).catch(() => null);
    const sbEvent = sb?.events?.find((e: any) => String(e?.id) === String(eventId));
    const sbGame = sbEvent ? mapEvent(sbEvent, week) : null;
    if (sbGame) {
      base.quarters = sbGame.quarters;
      base.venue = sbGame.venue !== "TBD" ? sbGame.venue : base.venue;
      if (sbGame.spread !== "—") base.spread = sbGame.spread;
      if (sbGame.total > 0) base.total = sbGame.total;
    }

    const awayStats = d?.boxscore?.teams?.find(
      (t: any) => teamByAbbr(t?.team?.abbreviation ?? "")?.id === base.awayTeamId,
    );
    const homeStats = d?.boxscore?.teams?.find(
      (t: any) => teamByAbbr(t?.team?.abbreviation ?? "")?.id === base.homeTeamId,
    );
    if (awayStats) base.stats.away = mapTeamStats(awayStats.statistics ?? []);
    if (homeStats) base.stats.home = mapTeamStats(homeStats.statistics ?? []);

    const rawDrives = d?.drives?.previous ?? [];
    base.drives = rawDrives.map((dr: any, i: number): Drive => {
      const teamId = teamByAbbr(dr?.team?.abbreviation ?? "")?.id ?? base.awayTeamId;
      const top = dr?.timeOfPossession;
      const yl = Number(dr?.start?.yardLine ?? NaN);
      const startAt = dr?.start?.text
        ?? (Number.isFinite(yl) ? (yl <= 50 ? `Own ${yl}` : `Opp ${100 - yl}`) : "—");
      return {
        index: i + 1,
        teamId,
        quarter: Number(dr?.period?.number ?? dr?.start?.period?.number ?? 1),
        plays: Number(dr?.offensivePlays ?? 0),
        yards: Number(dr?.yards ?? 0),
        timeOfPossession:
          typeof top === "string" ? top : (top?.displayValue ?? "0:00"),
        startAt,
        result: mapDriveResult(dr?.displayResult ?? dr?.result),
      };
    });

    base.boxScore = mapBoxScore(d?.boxscore?.players ?? [], base.awayTeamId, base.homeTeamId);
    return base;
  });
}
