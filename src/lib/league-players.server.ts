/**
 * Server-only: league-wide 2026 player season stats for the Players page.
 *
 * Adds up the real ESPN box scores from every completed regular-season game
 * so each player has offense, defense, kicking and punting totals. Finished
 * games never change, so each game is read once and kept for hours; the
 * league-wide totals are rebuilt every few minutes.
 */

import { gameScore } from "@/data/games";
import { isCollegeId, registeredCollegeTeams, teams, teamByAbbr, teamById } from "@/data/teams";
import { CURRENT_SEASON, teamOf } from "@/lib/shared/espn-core.server";
import { fetchPriorSeasonResults, fetchSchedule } from "@/lib/nfl/nfl-schedule.server";
import { fetchTeamRoster } from "@/lib/shared/espn-teams-players.server";
import { fetchPropAvailability } from "@/lib/shared/espn-props.server";
import { fetchCfbGameProjections, fetchCfbSchedule, fetchFbsConferences, fetchSummaryFor } from "@/lib/cfb/cfb-espn.server";
import type { ProjStat } from "./cfb-projections";
import { nflverseGameYac } from "./nflverse-yac.server";
import {
  MARKET_SOURCES,
  buildPlayerAnalytics,
  summarizeMarket,
  type GamePropAnalytics,
  type PlayerGameInput,
} from "./prop-analytics";
import { fitRatings, predictGame, type TeamRatings } from "./game-model";
import {
  backtestStat,
  buildWeekContext,
  opportunityFor,
  opportunityShares,
  projectStat,
  summarizeAccuracy,
  PROJECTION_SETTINGS,
  SINGLE_ROLE_POSITIONS,
  type BacktestPoint,
  type GamePropProjections,
  type LastSeasonLine,
  type LeagueRecord,
  type OpportunityShares,
  type PlayerRole,
  type PlayerStatModel,
  type TeamGameLine,
  type WeekContext,
} from "./player-projection-model";
import { availabilityOf, isRuledOut, selectStarters, type LineupCandidate } from "./prop-lineup";
import {
  isPropPlayerPosition,
  marketByKey,
  normalizePropPosition,
  type PropCategory,
} from "./prop-model";

const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const CORE_ODDS = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events";
const TOTALS_TTL_MS = 10 * 60 * 1000;
const GAME_TTL_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 8;

export interface LeaguePlayer {
  id: string;
  name: string;
  teamId: string;
  /** ESPN position abbreviation (QB, CB, PK, ...). */
  position: string;
  games: number;
  /** Offense: pass + rush + receiving yards / touchdowns. */
  yards: number;
  tds: number;
  /** Defense. */
  tkl: number;
  solo: number;
  sck: number;
  tfl: number;
  qbh: number;
  pd: number;
  int: number;
  ff: number;
  dtd: number;
  /** Kicking. */
  fgm: number;
  fga: number;
  fgLong: number;
  xpm: number;
  xpa: number;
  kpts: number;
  /** Punting. */
  punts: number;
  puntYds: number;
  in20: number;
  puntLong: number;
}

/* ---------- small helpers ---------- */

const memo = new Map<string, { at: number; value: Promise<unknown> }>();

function memoize<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = load();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => memo.delete(key));
  return value;
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** "2/3" or "2-3" -> [2, 3] */
const pair = (v: unknown): [number, number] => {
  const m = String(v ?? "").match(/(\d+)\s*[-/]\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

const add = (flat: Record<string, number>, key: string, value: number) => {
  flat[key] = (flat[key] ?? 0) + value;
};

/** Find yards-after-catch in ESPN Core stats, specifically targeting the receiving category. */
function extractYacValue(data: any): number | undefined {
  if (!data || typeof data !== "object") return undefined;

  // 1. Target the receiving category splits first to avoid matching
  // the placeholder passingYardsAfterCatch: 0.0 in the passing category.
  const categories = data?.splits?.categories;
  if (Array.isArray(categories)) {
    const receivingCategory = categories.find((c: any) => c?.name === "receiving");
    if (receivingCategory && Array.isArray(receivingCategory.stats)) {
      const yacStat = receivingCategory.stats.find(
        (s: any) => s?.name === "receivingYardsAfterCatch" || s?.name === "yardsAfterCatch",
      );
      if (yacStat?.value !== undefined && Number.isFinite(Number(yacStat.value))) {
        return Math.round(Number(yacStat.value));
      }
    }
  }

  // 2. Fallback parse for alternative ESPN Core endpoint layouts
  const parse = (value: any): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value.replace(/,/g, ""));
      if (value.trim() !== "" && Number.isFinite(n)) return n;
    }
    return undefined;
  };

  const visit = (node: any): number | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    const name = String(node.name ?? node.displayName ?? "").toLowerCase();
    if (
      name === "receivingyardsaftercatch" ||
      (name.includes("yards after catch") && !name.includes("pass"))
    ) {
      const found = parse(node.value ?? node.displayValue);
      if (found !== undefined) return found;
    }
    for (const value of Object.values(node)) {
      const found = visit(value);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const result = visit(data);
  return result === undefined ? undefined : Math.round(result);
}

/* ---------- one game's box score -> per-player records ---------- */

interface GameRecord {
  id: string;
  name: string;
  teamId: string;
  posHint: string;
  flat: Record<string, number>;
}

// Only used when ESPN's roster doesn't say what a player's position is.
const GROUP_POSITION: Record<string, string> = {
  passing: "QB",
  rushing: "RB",
  receiving: "WR",
  kicking: "PK",
  punting: "P",
  defensive: "LB",
  interceptions: "CB",
};
const GROUP_PRIORITY = [
  "kicking",
  "punting",
  "passing",
  "rushing",
  "receiving",
  "interceptions",
  "defensive",
];

export function extractGameRecords(
  summary: any,
  teamIdFor: (abbr: string, team?: any) => string | undefined,
): GameRecord[] {
  const byPlayer = new Map<string, GameRecord & { groups: Set<string> }>();

  for (const block of summary?.boxscore?.players ?? []) {
    const teamId = teamIdFor(block?.team?.abbreviation ?? "", block?.team);
    if (!teamId) continue;
    for (const group of block?.statistics ?? []) {
      const groupName = String(group?.name ?? "");
      const keys: string[] = group?.keys ?? [];
      for (const entry of group?.athletes ?? []) {
        const athlete = entry?.athlete;
        if (!athlete?.id || !athlete?.displayName) continue;
        const id = String(athlete.id);
        let rec = byPlayer.get(id);
        if (!rec) {
          rec = {
            id,
            name: athlete.displayName,
            teamId,
            posHint: athlete.position?.abbreviation ?? "",
            flat: {},
            groups: new Set(),
          };
          byPlayer.set(id, rec);
        }
        rec.groups.add(groupName);

        keys.forEach((key, i) => {
          const raw = entry?.stats?.[i];
          if (raw === undefined || raw === null || raw === "-") return;
          if (key === "completions/passingAttempts") {
            const [m, t] = pair(raw);
            add(rec!.flat, "pc", m);
            add(rec!.flat, "pa", t);
          } else if (key === "fieldGoalsMade/fieldGoalAttempts") {
            const [m, t] = pair(raw);
            add(rec!.flat, "fgm", m);
            add(rec!.flat, "fga", t);
          } else if (key === "extraPointsMade/extraPointAttempts") {
            const [m, t] = pair(raw);
            add(rec!.flat, "xpm", m);
            add(rec!.flat, "xpa", t);
          } else if (/sack/i.test(key) && groupName === "passing") {
            // ESPN commonly encodes sacks and sack yards together (e.g. "2-14").
            // The first number is the number of times the QB was sacked.
            const match = String(raw).match(/^\s*(\d+)/);
            add(rec!.flat, "passing.sacks", match ? Number(match[1]) : num(raw));
          } else if (/long/i.test(key)) {
            // Longest-play stats must be retained per game just like the matchup page.
            if (groupName === "kicking" || groupName === "punting") {
              const target = groupName === "kicking" ? "fgLong" : "puntLong";
              rec!.flat[target] = Math.max(rec!.flat[target] ?? 0, num(raw));
            } else if (groupName === "rushing" || groupName === "receiving") {
              const target = `${groupName}.${key}`;
              rec!.flat[target] = Math.max(rec!.flat[target] ?? 0, num(raw));
            }
          } else if (!key.includes("/")) {
            add(rec!.flat, `${groupName}.${key}`, num(raw));
          }
        });
      }
    }
  }

  return Array.from(byPlayer.values()).map((rec) => {
    // A defensive TD can be listed under tackles and under interceptions;
    // count it once per game.
    rec.flat.dtd = Math.max(
      rec.flat["defensive.defensiveTouchdowns"] ?? 0,
      rec.flat["interceptions.interceptionTouchdowns"] ?? 0,
    );
    const firstGroup = GROUP_PRIORITY.find((g) => rec.groups.has(g));
    return {
      id: rec.id,
      name: rec.name,
      teamId: rec.teamId,
      posHint: rec.posHint || (firstGroup ? GROUP_POSITION[firstGroup] : "ATH"),
      flat: rec.flat,
    };
  });
}

/**
 * ESPN's summary box score omits YAC, which the game matchup page retrieves
 * from the Core per-player statistics endpoint. Enrich the same per-game
 * records with that same value so player profiles don't disagree with games.
 */
async function addMatchupPageYac(
  eventId: string,
  summary: any,
  records: GameRecord[],
  week?: number,
): Promise<void> {
  const espnTeamIds = new Map<string, string>();
  for (const block of summary?.boxscore?.players ?? []) {
    const ourTeamId = teamByAbbr(block?.team?.abbreviation ?? "")?.id;
    if (ourTeamId && block?.team?.id) espnTeamIds.set(ourTeamId, String(block.team.id));
  }

  // Keep kicker values identical to the matchup page: its FGYDS and distance
  // buckets are calculated from made field-goal plays, not the summary box-score
  // totals (which can omit individual kick distances).
  const kickerRecords = records.filter(
    (record) =>
      ["K", "PK", "PLACEKICKER", "KICKER"].includes(record.posHint.toUpperCase()) ||
      record.flat.fga !== undefined,
  );
  const madeFieldGoalsByPlayer = new Map<string, number[]>();
  for (const drive of summary?.drives?.previous ?? []) {
    const driveTeamId = teamByAbbr(drive?.team?.abbreviation ?? "")?.id;
    for (const play of Array.isArray(drive?.plays) ? drive.plays : []) {
      const text = String(play?.text ?? play?.shortText ?? "").trim();
      if (!/field goal/i.test(text) || /missed|no good|blocked|failed/i.test(text)) continue;
      const playTeamId = teamByAbbr(play?.team?.abbreviation ?? "")?.id ?? driveTeamId;
      if (!playTeamId) continue;
      const candidates = kickerRecords.filter((record) => record.teamId === playTeamId);
      const namedKicker = candidates.find((record) =>
        text.toLowerCase().includes(record.name.toLowerCase()),
      );
      const kicker = namedKicker ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!kicker) continue;
      const match =
        text.match(/\b(\d{1,2})\s*(?:-?yard|yds?)\b/i) ??
        text.match(/field goal\s+(?:is\s+)?good\s+from\s+(?:the\s+)?(\d{1,2})/i);
      const distance = Number(match?.[1] ?? 0);
      if (distance > 0 && distance <= 70) {
        const distances = madeFieldGoalsByPlayer.get(kicker.id) ?? [];
        distances.push(distance);
        madeFieldGoalsByPlayer.set(kicker.id, distances);
      }
    }
  }

  for (const record of kickerRecords) {
    const distances = madeFieldGoalsByPlayer.get(record.id) ?? [];
    record.flat["matchup.fgLong"] = distances.length ? Math.max(...distances) : 0;
    record.flat["matchup.fgYds"] = distances.reduce((sum, distance) => sum + distance, 0);
    record.flat["matchup.fg0_19"] = distances.filter((distance) => distance < 20).length;
    record.flat["matchup.fg20_29"] = distances.filter(
      (distance) => distance >= 20 && distance <= 29,
    ).length;
    record.flat["matchup.fg30_39"] = distances.filter(
      (distance) => distance >= 30 && distance <= 39,
    ).length;
    record.flat["matchup.fg40_49"] = distances.filter(
      (distance) => distance >= 40 && distance <= 49,
    ).length;
    record.flat["matchup.fg50plus"] = distances.filter((distance) => distance >= 50).length;
  }

  // ESPN's matchup page requests YAC from the Core per-player endpoint. Do the
  // same for this player's completed game log so YAC isn't a different source.
  await Promise.all(
    records
      .filter((record) => ["QB", "RB", "WR", "TE"].includes(record.posHint.toUpperCase()))
      .map(async (record) => {
        const espnTeamId = espnTeamIds.get(record.teamId);
        if (!espnTeamId) return;
        try {
          const stats = await memoize(
            `matchup-yac-${eventId}-${record.id}`,
            GAME_TTL_MS,
            async () => {
              const url = `${CORE_ODDS}/${eventId}/competitions/${eventId}/competitors/${espnTeamId}/roster/${record.id}/statistics/0`;
              const response = await fetch(url, { headers: { "User-Agent": "GamblingNFL/1.0" } });
              if (!response.ok)
                throw new Error(`ESPN player statistics failed [${response.status}]`);
              return response.json();
            },
          );
          const yac = extractYacValue(stats);
          if (yac !== undefined) record.flat.yardsAfterCatch = yac;
        } catch {
          // Matchup page leaves YAC absent when ESPN's Core endpoint fails.
        }
      }),
  );

  // Some ESPN feeds expose YAC on the receivers but omit it on the QB's own
  // stats endpoint. If this team used exactly one QB with pass attempts, sum
  // the receiving YAC for that game and attach it to that QB.
  const teamIds = new Set(
    records.filter((r) => r.posHint.toUpperCase() === "QB").map((r) => r.teamId),
  );
  for (const teamId of teamIds) {
    const qbs = records.filter(
      (r) => r.teamId === teamId && r.posHint.toUpperCase() === "QB" && (r.flat.pa ?? 0) > 0,
    );
    if (qbs.length !== 1) continue;
    const qb = qbs[0];
    if ((qb.flat.yardsAfterCatch ?? 0) > 0) continue;
    const receiverYac = records
      .filter((r) => r.teamId === teamId && ["RB", "WR", "TE"].includes(r.posHint.toUpperCase()))
      .reduce((sum, r) => sum + (r.flat.yardsAfterCatch ?? 0), 0);
    if (receiverYac > 0) qb.flat.yardsAfterCatch = receiverYac;
  }

  // nflverse publishes real yards after catch (PYAC for passers, YAC for receivers) once a
  // game has been processed, usually the next morning. Prefer it over the estimates above.
  if (week) {
    await Promise.all(
      records
        .filter((record) => ["QB", "RB", "WR", "TE"].includes(record.posHint.toUpperCase()))
        .map(async (record) => {
          try {
            const row = await nflverseGameYac(record.name, 2026, week);
            if (row)
              record.flat.yardsAfterCatch =
                record.posHint.toUpperCase() === "QB" ? row.pyac : row.yac;
          } catch {
            // keep the earlier value
          }
        }),
    );
  }
}

/* ---------- league totals ---------- */

const MAX_KEYS = new Set(["fgLong", "puntLong"]);

export function buildLeaguePlayers(
  gameRecords: GameRecord[][],
  positionById: Map<string, string>,
): LeaguePlayer[] {
  const acc = new Map<
    string,
    {
      id: string;
      name: string;
      teamId: string;
      posHint: string;
      games: number;
      flat: Record<string, number>;
    }
  >();

  for (const records of gameRecords) {
    for (const rec of records) {
      let a = acc.get(rec.id);
      if (!a) {
        a = {
          id: rec.id,
          name: rec.name,
          teamId: rec.teamId,
          posHint: rec.posHint,
          games: 0,
          flat: {},
        };
        acc.set(rec.id, a);
      }
      a.games += 1;
      a.teamId = rec.teamId; // games arrive oldest first, so this ends on the latest team
      for (const [key, value] of Object.entries(rec.flat)) {
        if (key === "yardsAfterCatch" || key.startsWith("matchup.")) continue; // per-game display details, not league totals
        a.flat[key] = MAX_KEYS.has(key)
          ? Math.max(a.flat[key] ?? 0, value)
          : (a.flat[key] ?? 0) + value;
      }
    }
  }

  return Array.from(acc.values()).map((a) => {
    const g = (key: string) => a.flat[key] ?? 0;
    return {
      id: a.id,
      name: a.name,
      teamId: a.teamId,
      position: positionById.get(a.id) || a.posHint || "ATH",
      games: a.games,
      yards: g("passing.passingYards") + g("rushing.rushingYards") + g("receiving.receivingYards"),
      tds:
        g("passing.passingTouchdowns") +
        g("rushing.rushingTouchdowns") +
        g("receiving.receivingTouchdowns"),
      tkl: g("defensive.totalTackles"),
      solo: g("defensive.soloTackles"),
      sck: g("defensive.sacks"),
      tfl: g("defensive.tacklesForLoss"),
      qbh: g("defensive.QBHits"),
      pd: g("defensive.passesDefended"),
      int: g("interceptions.interceptions"),
      ff: g("defensive.forcedFumbles"),
      dtd: g("dtd"),
      fgm: g("fgm"),
      fga: g("fga"),
      fgLong: g("fgLong"),
      xpm: g("xpm"),
      xpa: g("xpa"),
      kpts: g("kicking.totalKickingPoints"),
      punts: g("punting.punts"),
      puntYds: g("punting.puntYards"),
      in20: g("punting.puntsInside20"),
      puntLong: g("puntLong"),
    };
  });
}

/* ---------- ESPN fetching ---------- */

async function fetchGameSummary(eventId: string): Promise<any> {
  return memoize(`league-summary-${eventId}`, GAME_TTL_MS, async () => {
    const res = await fetch(`${SUMMARY}?event=${eventId}`, {
      headers: { "User-Agent": "GamblingNFL/1.0" },
    });
    // Throwing (instead of returning []) keeps a failed fetch from being cached.
    if (!res.ok) throw new Error(`ESPN summary failed [${res.status}]`);
    return res.json();
  });
}

/** A college game's player records (college box scores, teams resolved by ESPN id). */
async function fetchCollegeGameRecords(gameId: string): Promise<GameRecord[]> {
  try {
    return await memoize(`league-game-${gameId}`, GAME_TTL_MS, async () =>
      extractGameRecords(await fetchSummaryFor(gameId, true), (_, team) => teamOf(team)?.id),
    );
  } catch {
    return [];
  }
}

async function fetchGameRecords(eventId: string): Promise<GameRecord[]> {
  try {
    return await memoize(`league-game-${eventId}`, GAME_TTL_MS, async () => {
      const summary = await fetchGameSummary(eventId);
      return extractGameRecords(summary, (abbr) => teamByAbbr(abbr)?.id);
    });
  } catch {
    return [];
  }
}

/** Every player with a recorded stat this season, with offense, defense, kicking and punting totals. */
export async function fetchLeaguePlayers(): Promise<LeaguePlayer[]> {
  return memoize("league-players", TOTALS_TTL_MS, async () => {
    const schedule = await fetchSchedule();
    const finals = schedule.filter((g) => g.status === "final");

    // Real positions come from each team's roster.
    const positionById = new Map<string, string>();
    await Promise.all(
      teams.map(async (team) => {
        try {
          for (const p of await fetchTeamRoster(team.abbr)) {
            if (p.position) positionById.set(p.id, p.position);
          }
        } catch {
          /* fall back to the box-score position */
        }
      }),
    );

    // Small batches so ESPN isn't hit with every game at once.
    const gameRecords: GameRecord[][] = [];
    for (let i = 0; i < finals.length; i += BATCH_SIZE) {
      const batch = finals.slice(i, i + BATCH_SIZE);
      gameRecords.push(
        ...(await Promise.all(batch.map((g) => fetchGameRecords(g.id.replace(/^espn-/, ""))))),
      );
    }
    return buildLeaguePlayers(gameRecords, positionById);
  });
}

/* ---------- one player's game log ---------- */

export interface PlayerGameLogEntry {
  gameId: string;
  week: number;
  awayTeamId: string;
  homeTeamId: string;
  awayScore: number;
  homeScore: number;
  overtime: boolean;
  /** Raw per-game stat totals, e.g. "passing.passingYards", "pc", "pa", "fgm". */
  stats: Record<string, number>;
}

/**
 * Every finished game a player recorded a stat in, oldest first, with the
 * full stat line for that game. Pass the player's current team to look at that
 * team's games first (much faster); if nothing turns up (traded players) every
 * game is checked.
 */
export async function fetchPlayerGameLog(
  playerId: string,
  teamId?: string,
): Promise<PlayerGameLogEntry[]> {
  return memoize(`player-gamelog-${playerId}-${teamId ?? "any"}`, TOTALS_TTL_MS, async () => {
    const schedule = await fetchSchedule();
    const finals = schedule.filter((g) => g.status === "final");

    const scan = async (games: typeof finals): Promise<PlayerGameLogEntry[]> => {
      const out: PlayerGameLogEntry[] = [];
      for (let i = 0; i < games.length; i += BATCH_SIZE) {
        const batch = games.slice(i, i + BATCH_SIZE);
        const records = await Promise.all(
          batch.map((g) => fetchGameRecords(g.id.replace(/^espn-/, ""))),
        );
        await Promise.all(
          batch.map(async (game, idx) => {
            const rec = records[idx].find((r) => r.id === playerId);
            if (!rec) return;
            // Add the same YAC value the game matchup page requests, but only
            // for this player's row so scanning the league doesn't fan out into
            // hundreds of unnecessary per-athlete requests.
            try {
              const yacRecords =
                rec.posHint.toUpperCase() === "QB"
                  ? records[idx].filter(
                      (candidate) =>
                        candidate.teamId === rec.teamId &&
                        ["QB", "RB", "WR", "TE"].includes(candidate.posHint.toUpperCase()),
                    )
                  : [rec];
              await addMatchupPageYac(
                game.id.replace(/^espn-/, ""),
                await fetchGameSummary(game.id.replace(/^espn-/, "")),
                yacRecords,
                game.week,
              );
            } catch {
              // Keep the rest of the game log available if ESPN's YAC endpoint fails.
            }
            const score = gameScore(game);
            out.push({
              gameId: game.id,
              week: game.week,
              awayTeamId: game.awayTeamId,
              homeTeamId: game.homeTeamId,
              awayScore: score.away,
              homeScore: score.home,
              overtime: game.quarters.away.length > 4 || game.quarters.home.length > 4,
              stats: rec.flat,
            });
          }),
        );
      }
      return out;
    };

    let log = teamId
      ? await scan(finals.filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId))
      : [];
    if (log.length === 0) log = await scan(finals);
    return log.sort((a, b) => a.week - b.week);
  });
}

/**
 * Prop analytics for both teams in a matchup: every offensive player, kicker and punter on
 * the current rosters, with per-game results from each completed 2026 game for that team.
 * Reuses the cached per-game box-score records, so it adds no new ESPN requests after the
 * first load.
 */
export async function fetchGamePropAnalytics(
  awayAbbr: string,
  homeAbbr: string,
): Promise<GamePropAnalytics> {
  // NFL teams come as abbreviations, college teams as ids ("cfb-194").
  const college = isCollegeId(awayAbbr);
  const abbrs = college ? [awayAbbr, homeAbbr] : [awayAbbr.toUpperCase(), homeAbbr.toUpperCase()];
  return memoize(`prop-analytics-${abbrs.join("-")}`, TOTALS_TTL_MS, async () => {
    const [schedule, ...rosters] = await Promise.all([
      college ? fetchCfbSchedule() : fetchSchedule(),
      ...abbrs.map((abbr) => fetchTeamRoster(abbr)),
    ]);
    const finals = schedule.filter((g) => g.status === "final");
    const players: GamePropAnalytics["players"] = [];
    const gamesScanned: Record<string, number> = {};

    await Promise.all(
      abbrs.map(async (abbr, teamIndex) => {
        const team = college ? teamById(abbr) : teamByAbbr(abbr);
        if (!team) return;
        const teamGames = finals.filter(
          (g) => g.homeTeamId === team.id || g.awayTeamId === team.id,
        );
        gamesScanned[abbr] = teamGames.length;

        const byPlayer = new Map<string, PlayerGameInput[]>();
        for (let i = 0; i < teamGames.length; i += BATCH_SIZE) {
          const batch = teamGames.slice(i, i + BATCH_SIZE);
          const records = await Promise.all(
            batch.map((g) =>
              college ? fetchCollegeGameRecords(g.id) : fetchGameRecords(g.id.replace(/^espn-/, "")),
            ),
          );
          batch.forEach((game, idx) => {
            const home = game.homeTeamId === team.id;
            const opponent = teamById(home ? game.awayTeamId : game.homeTeamId)?.abbr ?? "";
            for (const rec of records[idx]) {
              if (rec.teamId !== team.id) continue;
              const list = byPlayer.get(rec.id) ?? [];
              list.push({ gameId: game.id, week: game.week, opponent, home, flat: rec.flat });
              byPlayer.set(rec.id, list);
            }
          });
        }

        // Current roster decides who is listed (and their position); the box scores supply the numbers.
        for (const person of rosters[teamIndex]) {
          if (!isPropPlayerPosition(person.position)) continue;
          const games = byPlayer.get(person.id) ?? [];
          const analytics = buildPlayerAnalytics(
            {
              id: person.id,
              name: person.name,
              teamAbbr: abbr,
              position: normalizePropPosition(person.position),
              headshot: person.headshot,
            },
            games,
          );
          if (Object.keys(analytics.markets).length > 0) players.push(analytics);
        }
      }),
    );

    return { players, gamesScanned };
  });
}

/* ---------------- player prop projections ---------------- */

const CORE_NFL = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";

/** ESPN season-stat names -> the box-score keys the prop markets read. */
const SEASON_STAT_KEYS: Record<string, string> = {
  "passing.completions": "pc",
  "passing.passingAttempts": "pa",
  "passing.passingYards": "passing.passingYards",
  "passing.passingTouchdowns": "passing.passingTouchdowns",
  "passing.interceptions": "passing.interceptions",
  "rushing.rushingAttempts": "rushing.rushingAttempts",
  "rushing.rushingYards": "rushing.rushingYards",
  "rushing.rushingTouchdowns": "rushing.rushingTouchdowns",
  "receiving.receptions": "receiving.receptions",
  "receiving.receivingYards": "receiving.receivingYards",
  "receiving.receivingTouchdowns": "receiving.receivingTouchdowns",
  "receiving.receivingTargets": "receiving.receivingTargets",
  "kicking.fieldGoalsMade": "fgm",
  "kicking.fieldGoalAttempts": "fga",
  "kicking.extraPointsMade": "xpm",
  "kicking.extraPointAttempts": "xpa",
  "kicking.totalKickingPoints": "kicking.totalKickingPoints",
  "punting.punts": "punting.punts",
  "punting.puntYards": "punting.puntYards",
};

/** Stat groups: if any marker stat was recorded, every stat in the group counts (zeros included). */
const LAST_SEASON_GROUPS: [string[], string[]][] = [
  [
    ["pa"],
    ["pc", "pa", "passing.passingYards", "passing.passingTouchdowns", "passing.interceptions"],
  ],
  [
    ["rushing.rushingAttempts"],
    ["rushing.rushingAttempts", "rushing.rushingYards", "rushing.rushingTouchdowns"],
  ],
  [
    ["receiving.receivingTargets", "receiving.receptions"],
    [
      "receiving.receptions",
      "receiving.receivingYards",
      "receiving.receivingTouchdowns",
      "receiving.receivingTargets",
    ],
  ],
  [
    ["fga", "xpa"],
    ["fgm", "fga", "xpm", "xpa", "kicking.totalKickingPoints"],
  ],
  [["punting.punts"], ["punting.punts", "punting.puntYards"]],
];

/** Turns ESPN athlete season statistics into per-game numbers by prop key. */
export function lastSeasonLinesFrom(data: any): Record<string, LastSeasonLine> {
  const categories: any[] = Array.isArray(data?.splits?.categories) ? data.splits.categories : [];
  const totals: Record<string, number> = {};
  let gamesPlayed = 0;
  for (const cat of categories) {
    for (const stat of Array.isArray(cat?.stats) ? cat.stats : []) {
      const value = Number(stat?.value);
      if (!Number.isFinite(value)) continue;
      if (stat?.name === "gamesPlayed") gamesPlayed = Math.max(gamesPlayed, value);
      const key = SEASON_STAT_KEYS[`${cat?.name}.${stat?.name}`];
      if (key) totals[key] = value;
    }
  }
  const lines: Record<string, LastSeasonLine> = {};
  if (gamesPlayed <= 0) return lines;
  const flat: Record<string, number> = {};
  for (const [markers, keys] of LAST_SEASON_GROUPS) {
    if (!markers.some((k) => (totals[k] ?? 0) > 0)) continue;
    for (const k of keys) flat[k] = (totals[k] ?? 0) / gamesPlayed;
  }
  for (const key of Object.keys(MARKET_SOURCES)) {
    if (marketByKey(key)?.kind === "long") continue;
    const summary = summarizeMarket(key, [
      { gameId: "", week: 0, opponent: "", home: false, flat },
    ]);
    if (summary) lines[key] = { perGame: summary.log[0].value, games: gamesPlayed };
  }
  return lines;
}

/**
 * A player's per-game numbers from last regular season (ESPN athlete season stats), by prop key.
 * Works for players who changed teams. Empty for rookies or if ESPN has nothing.
 */
async function fetchLastSeasonLines(playerId: string): Promise<Record<string, LastSeasonLine>> {
  const season = CURRENT_SEASON - 1;
  try {
    return await memoize(`last-season-${season}-${playerId}`, GAME_TTL_MS * 2, async () => {
      for (const suffix of ["/statistics/0", "/statistics"]) {
        const res = await fetch(
          `${CORE_NFL}/seasons/${season}/types/2/athletes/${playerId}${suffix}`,
          {
            headers: { "User-Agent": "GamblingNFL/1.0" },
          },
        );
        if (res.ok) return lastSeasonLinesFrom(await res.json());
      }
      return {};
    });
  } catch {
    return {};
  }
}

/**
 * Model projections for every prop on the board for one game, plus how accurate the same model
 * has been on these players' earlier games. Uses only games played before this game's week.
 */
export async function fetchGamePropProjections(
  eventId: string,
  awayAbbr: string,
  homeAbbr: string,
): Promise<GamePropProjections> {
  if (eventId.startsWith("cfb-")) return collegePropProjections(eventId);
  const id = eventId.replace(/^espn-/, "");
  return memoize(`prop-projections-${id}`, TOTALS_TTL_MS, async () => {
    const [schedule, analytics, priorSeason, availability] = await Promise.all([
      fetchSchedule(),
      fetchGamePropAnalytics(awayAbbr, homeAbbr),
      fetchPriorSeasonResults().catch(() => []),
      fetchPropAvailability(eventId, awayAbbr, homeAbbr).catch(() => null),
    ]);
    const finals = schedule.filter((g) => g.status === "final");
    const target = schedule.find((g) => g.id === `espn-${id}`);
    const week = target?.week ?? Math.max(0, ...finals.map((g) => g.week)) + 1;

    // Every player's box score in every finished game, with who they played.
    const records: LeagueRecord[] = [];
    for (let i = 0; i < finals.length; i += BATCH_SIZE) {
      const batch = finals.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((g) => fetchGameRecords(g.id.replace(/^espn-/, ""))),
      );
      batch.forEach((game, idx) => {
        const homeAbbrG = teamById(game.homeTeamId)?.abbr ?? "";
        const awayAbbrG = teamById(game.awayTeamId)?.abbr ?? "";
        for (const rec of results[idx]) {
          const isHome = rec.teamId === game.homeTeamId;
          records.push({
            playerId: rec.id,
            week: game.week,
            team: isHome ? homeAbbrG : awayAbbrG,
            opponent: isHome ? awayAbbrG : homeAbbrG,
            home: isHome,
            position: rec.posHint,
            flat: rec.flat,
          });
        }
      });
    }

    // Which games were real roles: the team's main passer (most attempts) at QB, and skill
    // players with at least a few touches. Relief and mop-up games don't set position averages.
    const mainPasser = new Map<string, { id: string; pa: number }>();
    const teamPassAttempts = new Map<string, number>();
    for (const r of records) {
      if (normalizePropPosition(r.position) !== "QB") continue;
      const key = `${r.team}|${r.week}`;
      const pa = r.flat.pa ?? 0;
      teamPassAttempts.set(key, (teamPassAttempts.get(key) ?? 0) + pa);
      if (pa > (mainPasser.get(key)?.pa ?? -1)) mainPasser.set(key, { id: r.playerId, pa });
    }
    const touches = (f: Record<string, number>) =>
      (f["receiving.receivingTargets"] ?? 0) + (f["rushing.rushingAttempts"] ?? 0);
    for (const r of records) {
      const pos = normalizePropPosition(r.position);
      if (pos === "QB")
        r.primary =
          mainPasser.get(`${r.team}|${r.week}`)?.id === r.playerId && (r.flat.pa ?? 0) >= 10;
      else if (pos === "K" || pos === "P") r.primary = true;
      else r.primary = touches(r.flat) >= 3;
    }

    // Per-week league context and game-model ratings (only earlier games), built once each.
    const contexts = new Map<number, WeekContext>();
    const contextFor = (w: number) => {
      let c = contexts.get(w);
      if (!c) contexts.set(w, (c = buildWeekContext(records, w)));
      return c;
    };
    const ratingsCache = new Map<number, TeamRatings>();
    const ratingsFor = (w: number) => {
      let r = ratingsCache.get(w);
      if (!r)
        ratingsCache.set(
          w,
          (r = fitRatings(
            finals.filter((g) => g.week < w),
            priorSeason,
          )),
        );
      return r;
    };
    /** Team's expected points in this game ÷ its average points so far (1 = a normal game). */
    const scriptRatio = (teamAbbr: string, oppAbbr: string, home: boolean, w: number) => {
      const team = teamByAbbr(teamAbbr);
      const opp = teamByAbbr(oppAbbr);
      if (!team || !opp) return 1;
      const prior = finals.filter(
        (g) => g.week < w && (g.homeTeamId === team.id || g.awayTeamId === team.id),
      );
      if (prior.length < 2) return 1;
      const avg =
        prior.reduce((s, g) => {
          const sc = gameScore(g);
          return s + (g.homeTeamId === team.id ? sc.home : sc.away);
        }, 0) / prior.length;
      if (avg <= 0) return 1;
      // Game script = only what's specific to this game. The opponent's defense is already its
      // own factor, and the player's form already regresses toward average, so neither is
      // repeated here. That leaves home vs. away, compared with the team's usual mix.
      const half = ratingsFor(w).homeField / 2;
      const pastHomeEdge =
        prior.reduce((sum, g) => sum + (g.homeTeamId === team.id ? half : -half), 0) / prior.length;
      const thisHomeEdge = home ? half : -half;
      return (avg - pastHomeEdge + thisHomeEdge) / avg;
    };

    // Last season's per-game numbers for every player on the board (small batches).
    const lastSeason = new Map<string, Record<string, LastSeasonLine>>();
    for (let i = 0; i < analytics.players.length; i += 10) {
      const batch = analytics.players.slice(i, i + 10);
      const lines = await Promise.all(batch.map((p) => fetchLastSeasonLines(p.id)));
      batch.forEach((p, idx) => lastSeason.set(p.id, lines[idx]));
    }

    // Usage: each team's box scores by week, for target / carry shares.
    const teamWeeks = new Map<string, Map<number, TeamGameLine[]>>();
    for (const r of records) {
      const weeks = teamWeeks.get(r.team) ?? new Map<number, TeamGameLine[]>();
      const lines = weeks.get(r.week) ?? [];
      lines.push({ playerId: r.playerId, position: r.position, flat: r.flat });
      weeks.set(r.week, lines);
      teamWeeks.set(r.team, weeks);
    }
    const recentFor = (team: string, w: number) =>
      [...(teamWeeks.get(team)?.entries() ?? [])]
        .filter(([wk]) => wk < w)
        .sort((a, b) => a[0] - b[0])
        .map(([, lines]) => lines);
    // This game: teammates the injury report rules out.
    const ruledOut = new Set(
      (availability?.players ?? [])
        .filter((a) => isRuledOut(availabilityOf(a.injuryStatus)))
        .map((a) => a.id),
    );
    const sharesNow = new Map<string, Map<string, OpportunityShares>>();
    const sharesForNow = (team: string) => {
      let m = sharesNow.get(team);
      if (!m) sharesNow.set(team, (m = opportunityShares(recentFor(team, week), ruledOut)));
      return m;
    };
    // Past games: anyone with a recent share who didn't play that game was out.
    const sharesPast = new Map<string, Map<string, OpportunityShares>>();
    const sharesForPast = (team: string, w: number) => {
      const key = `${team}|${w}`;
      let m = sharesPast.get(key);
      if (!m) {
        const recent = recentFor(team, w);
        const played = new Set((teamWeeks.get(team)?.get(w) ?? []).map((l) => l.playerId));
        const out = new Set(
          recent
            .slice(-4)
            .flat()
            .map((l) => l.playerId)
            .filter((id) => !played.has(id)),
        );
        sharesPast.set(key, (m = opportunityShares(recent, out)));
      }
      return m;
    };
    const sumFlat = (games: PlayerGameInput[]) => {
      const total: Record<string, number> = {};
      for (const g of games.slice(-4))
        for (const [k, v] of Object.entries(g.flat)) total[k] = (total[k] ?? 0) + v;
      return total;
    };

    // This week's roles, using the same starter rules as the page's "Starters" filter: depth chart
    // order, the injury report, and recent usage as a tiebreaker.
    const availabilityById = new Map((availability?.players ?? []).map((a) => [a.id, a]));
    const candidates: LineupCandidate[] = analytics.players.map((p) => {
      const a = availabilityById.get(p.id);
      const shares = sharesForNow(p.teamAbbr).get(p.id);
      const recentStarts = records.filter(
        (r) =>
          r.playerId === p.id &&
          r.team === p.teamAbbr &&
          r.week < week &&
          r.week >= week - 4 &&
          r.primary,
      ).length;
      const usageScore = SINGLE_ROLE_POSITIONS.has(p.position)
        ? recentStarts
        : ((shares?.targetShare ?? 0) + (shares?.carryShare ?? 0)) * 100;
      return {
        id: p.id,
        teamAbbr: p.teamAbbr,
        position: p.position,
        depthRank: a?.depthRank,
        injuryStatus: a?.injuryStatus,
        usage: usageScore,
      };
    });
    const starters = selectStarters(candidates);
    const roleOf = (playerId: string, position: string): PlayerRole =>
      starters.has(playerId)
        ? "starter"
        : SINGLE_ROLE_POSITIONS.has(position)
          ? "backup"
          : "rotation";
    const starterAt = (team: string, position: string) =>
      analytics.players.find(
        (x) => x.teamAbbr === team && x.position === position && starters.has(x.id),
      );

    /** Marker stats that make a zero-stat week count (only for stat groups he has ever recorded). */
    const zeroWeek = (games: PlayerGameInput[]) => {
      const flat: Record<string, number> = {};
      const ever = (k: string) => games.some((g) => g.flat[k] !== undefined);
      if (ever("receiving.receivingTargets") || ever("receiving.receptions")) {
        flat["receiving.receivingTargets"] = 0;
        flat["receiving.receptions"] = 0;
        flat["receiving.receivingYards"] = 0;
      }
      if (ever("rushing.rushingAttempts")) {
        flat["rushing.rushingAttempts"] = 0;
        flat["rushing.rushingYards"] = 0;
      }
      return flat;
    };

    const players: GamePropProjections["players"] = {};
    const usage: GamePropProjections["usage"] = {};
    const allPoints: { category: PropCategory; point: BacktestPoint }[] = [];
    for (const p of analytics.players) {
      const opponent =
        p.teamAbbr === awayAbbr.toUpperCase() ? homeAbbr.toUpperCase() : awayAbbr.toUpperCase();
      const isHome = p.teamAbbr === homeAbbr.toUpperCase();
      const role = roleOf(p.id, p.position);
      const singleRole = SINGLE_ROLE_POSITIONS.has(p.position);
      const mine = records.filter((r) => r.playerId === p.id && r.team === p.teamAbbr);
      // QB/K/P: only games where he was the one playing (no relief or garbage-time snaps).
      // Rotation players: every team game since he first appeared, with zeros for quiet weeks,
      // so a part-timer projects to his real per-game role.
      let games: PlayerGameInput[] = (singleRole ? mine.filter((r) => r.primary) : mine).map(
        (r) => {
          // A QB who split a game (left hurt, sat late in a blowout) played only part of it.
          const teamPa = teamPassAttempts.get(`${r.team}|${r.week}`) ?? 0;
          const share = p.position === "QB" && teamPa > 0 ? (r.flat.pa ?? 0) / teamPa : undefined;
          return {
            gameId: `${r.week}`,
            week: r.week,
            opponent: r.opponent,
            home: r.home,
            flat: r.flat,
            share,
          };
        },
      );
      if (role === "rotation" && games.length) {
        const first = Math.min(...games.map((g) => g.week));
        const have = new Set(games.map((g) => g.week));
        const zero = zeroWeek(games);
        for (const [wk, lines] of teamWeeks.get(p.teamAbbr) ?? []) {
          if (wk < first || have.has(wk) || !lines.length) continue;
          const sample = records.find((r) => r.team === p.teamAbbr && r.week === wk);
          if (!sample) continue;
          games.push({
            gameId: `${wk}`,
            week: wk,
            opponent: sample.opponent,
            home: sample.home,
            flat: { ...zero },
          });
        }
        games = games.sort((a, b) => a.week - b.week);
      }
      const prior = games.filter((g) => g.week < week);
      const script = scriptRatio(p.teamAbbr, opponent, isHome, week);
      const shares = sharesForNow(p.teamAbbr).get(p.id);
      const recentFlat = sumFlat(prior);
      const last = lastSeason.get(p.id) ?? {};
      usage[p.id] = {
        targetShare: Math.round((shares?.targetShare ?? 0) * 1000) / 1000,
        carryShare: Math.round((shares?.carryShare ?? 0) * 1000) / 1000,
        ruledOut: ruledOut.has(p.id),
        role,
        starterName: role === "backup" ? starterAt(p.teamAbbr, p.position)?.name : undefined,
      };
      const byKey: Record<string, PlayerStatModel> = {};
      for (const key of Object.keys(p.markets)) {
        const projection = projectStat(key, p.position, prior, contextFor(week), opponent, script, {
          lastSeason: last[key],
          opportunity: opportunityFor(key, shares, recentFlat),
          role,
        });
        const history = backtestStat(
          key,
          p.position,
          games,
          contextFor,
          (g) => scriptRatio(p.teamAbbr, g.opponent, g.home, g.week),
          week,
          last[key],
          (g) =>
            opportunityFor(
              key,
              sharesForPast(p.teamAbbr, g.week).get(p.id),
              sumFlat(games.filter((x) => x.week < g.week)),
            ),
          // Accuracy is tested on the games he actually played in this role.
          singleRole ? "starter" : role,
        );
        byKey[key] = { projection, accuracy: summarizeAccuracy(history), history };
        const category = marketByKey(key)?.category;
        if (category) for (const point of history) allPoints.push({ category, point });
      }
      players[p.id] = byKey;
    }

    const byCategory: GamePropProjections["accuracy"]["byCategory"] = {};
    for (const cat of [...new Set(allPoints.map((x) => x.category))]) {
      byCategory[cat] = summarizeAccuracy(
        allPoints.filter((x) => x.category === cat).map((x) => x.point),
      );
    }
    return {
      week,
      modelVersion: PROJECTION_SETTINGS.version,
      players,
      usage,
      lastSeasonPlayers: [...lastSeason.values()].filter((l) => Object.keys(l).length > 0).length,
      accuracy: { overall: summarizeAccuracy(allPoints.map((x) => x.point)), byCategory },
    };
  });
}

/* ---------------- college: the same page shapes from the college projections ---------------- */

/** College projection stats → the props page's market keys. */
const COLLEGE_KEYS: Record<ProjStat, string> = {
  passYds: "pass_yds",
  passTd: "pass_tds",
  rushYds: "rush_yds",
  rushAtt: "rush_att",
  recYds: "rec_yds",
  rec: "receptions",
};

/**
 * College prop projections in the same shape as the NFL's, so the props page shows them the same
 * way (see cfb-projections.ts for how they're made and how they tested).
 */
async function collegePropProjections(gameId: string): Promise<GamePropProjections> {
  const [data, schedule] = await Promise.all([fetchCfbGameProjections(gameId), fetchCfbSchedule()]);
  const week = schedule.find((g) => g.id === gameId)?.week ?? 0;
  const players: GamePropProjections["players"] = {};
  const all: BacktestPoint[] = [];
  const byCategory: Partial<Record<PropCategory, BacktestPoint[]>> = {};
  for (const p of data.players) {
    const models: Record<string, PlayerStatModel> = {};
    for (const s of p.stats) {
      const key = COLLEGE_KEYS[s.stat];
      const history: BacktestPoint[] = data.history[p.playerId]?.[s.stat] ?? [];
      all.push(...history);
      const category = marketByKey(key)?.category;
      if (category) (byCategory[category] ??= []).push(...history);
      models[key] = {
        projection: {
          projected: s.median,
          lower: s.low ?? 0,
          upper: s.high ?? 0,
          form: s.median,
          defense: 1,
          script: 1,
          opportunity: 1,
          games: p.games,
          role: "starter",
        },
        accuracy: summarizeAccuracy(history),
        history,
      };
    }
    players[p.playerId] = models;
  }
  return {
    week,
    modelVersion: "gcfb-proj-v1",
    players,
    usage: {},
    lastSeasonPlayers: 0,
    accuracy: {
      overall: summarizeAccuracy(all),
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, summarizeAccuracy(v ?? [])]),
      ) as GamePropProjections["accuracy"]["byCategory"],
    },
  };
}

/**
 * College players index, one conference at a time (the page loads every conference and merges
 * them): each member's players with season totals from this season's box scores, the same shape
 * as the NFL's league players.
 */
export async function fetchCfbConferenceLeaguePlayers(conference: string): Promise<LeaguePlayer[]> {
  return memoize(`cfb-league-players-${conference}`, TOTALS_TTL_MS, async () => {
    const [schedule] = await Promise.all([fetchCfbSchedule(), fetchFbsConferences().catch(() => [])]);
    const members = registeredCollegeTeams().filter((t) => t.conference === conference);
    const ids = new Set(members.map((t) => t.id));
    const finals = schedule.filter(
      (g) => g.status === "final" && (ids.has(g.homeTeamId) || ids.has(g.awayTeamId)),
    );
    const positionById = new Map<string, string>();
    await Promise.all(
      members.map(async (team) => {
        try {
          for (const p of await fetchTeamRoster(team.id)) {
            if (p.position) positionById.set(p.id, p.position);
          }
        } catch {
          /* fall back to the box-score position */
        }
      }),
    );
    const gameRecords: GameRecord[][] = [];
    for (let i = 0; i < finals.length; i += BATCH_SIZE) {
      const batch = finals.slice(i, i + BATCH_SIZE);
      const records = await Promise.all(batch.map((g) => fetchCollegeGameRecords(g.id)));
      // Only this conference's players (opponents are counted with their own conference).
      gameRecords.push(...records.map((r) => r.filter((rec) => ids.has(rec.teamId))));
    }
    return buildLeaguePlayers(gameRecords, positionById);
  });
}
