/**
 * Server-only: league-wide 2026 player season stats for the Players page.
 *
 * Adds up the real ESPN box scores from every completed regular-season game
 * so each player has offense, defense, kicking and punting totals. Finished
 * games never change, so each game is read once and kept for hours; the
 * league-wide totals are rebuilt every few minutes.
 */

import { gameScore } from "@/data/games";
import { teams, teamByAbbr } from "@/data/teams";
import { fetchSchedule, fetchTeamRoster } from "./espn.server";
import { nflverseGameYac } from "./nflverse-yac.server";

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
    if (name === "receivingyardsaftercatch" || (name.includes("yards after catch") && !name.includes("pass"))) {
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
  teamIdFor: (abbr: string) => string | undefined,
): GameRecord[] {
  const byPlayer = new Map<string, GameRecord & { groups: Set<string> }>();

  for (const block of summary?.boxscore?.players ?? []) {
    const teamId = teamIdFor(block?.team?.abbreviation ?? "");
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
  const kickerRecords = records.filter((record) =>
    ["K", "PK", "PLACEKICKER", "KICKER"].includes(record.posHint.toUpperCase()) || record.flat.fga !== undefined,
  );
  const madeFieldGoalsByPlayer = new Map<string, number[]>();
  for (const drive of summary?.drives?.previous ?? []) {
    const driveTeamId = teamByAbbr(drive?.team?.abbreviation ?? "")?.id;
    for (const play of (Array.isArray(drive?.plays) ? drive.plays : [])) {
      const text = String(play?.text ?? play?.shortText ?? "").trim();
      if (!/field goal/i.test(text) || /missed|no good|blocked|failed/i.test(text)) continue;
      const playTeamId = teamByAbbr(play?.team?.abbreviation ?? "")?.id ?? driveTeamId;
      if (!playTeamId) continue;
      const candidates = kickerRecords.filter((record) => record.teamId === playTeamId);
      const namedKicker = candidates.find((record) => text.toLowerCase().includes(record.name.toLowerCase()));
      const kicker = namedKicker ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!kicker) continue;
      const match = text.match(/\b(\d{1,2})\s*(?:-?yard|yds?)\b/i)
        ?? text.match(/field goal\s+(?:is\s+)?good\s+from\s+(?:the\s+)?(\d{1,2})/i);
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
      record.flat["matchup.fg20_29"] = distances.filter((distance) => distance >= 20 && distance <= 29).length;
      record.flat["matchup.fg30_39"] = distances.filter((distance) => distance >= 30 && distance <= 39).length;
      record.flat["matchup.fg40_49"] = distances.filter((distance) => distance >= 40 && distance <= 49).length;
      record.flat["matchup.fg50plus"] = distances.filter((distance) => distance >= 50).length;
  }

  // ESPN's matchup page requests YAC from the Core per-player endpoint. Do the
  // same for this player's completed game log so YAC isn't a different source.
  await Promise.all(records
    .filter((record) => ["QB", "RB", "WR", "TE"].includes(record.posHint.toUpperCase()))
    .map(async (record) => {
      const espnTeamId = espnTeamIds.get(record.teamId);
      if (!espnTeamId) return;
      try {
        const stats = await memoize(`matchup-yac-${eventId}-${record.id}`, GAME_TTL_MS, async () => {
          const url = `${CORE_ODDS}/${eventId}/competitions/${eventId}/competitors/${espnTeamId}/roster/${record.id}/statistics/0`;
          const response = await fetch(url, { headers: { "User-Agent": "GamblingNFL/1.0" } });
          if (!response.ok) throw new Error(`ESPN player statistics failed [${response.status}]`);
          return response.json();
        });
        const yac = extractYacValue(stats);
        if (yac !== undefined) record.flat.yardsAfterCatch = yac;
      } catch {
        // Matchup page leaves YAC absent when ESPN's Core endpoint fails.
      }
    }));

  // Some ESPN feeds expose YAC on the receivers but omit it on the QB's own
  // stats endpoint. If this team used exactly one QB with pass attempts, sum
  // the receiving YAC for that game and attach it to that QB.
  const teamIds = new Set(records.filter((r) => r.posHint.toUpperCase() === "QB").map((r) => r.teamId));
  for (const teamId of teamIds) {
    const qbs = records.filter((r) => r.teamId === teamId && r.posHint.toUpperCase() === "QB" && (r.flat.pa ?? 0) > 0);
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
            if (row) record.flat.yardsAfterCatch = record.posHint.toUpperCase() === "QB" ? row.pyac : row.yac;
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
    { id: string; name: string; teamId: string; posHint: string; games: number; flat: Record<string, number> }
  >();

  for (const records of gameRecords) {
    for (const rec of records) {
      let a = acc.get(rec.id);
      if (!a) {
        a = { id: rec.id, name: rec.name, teamId: rec.teamId, posHint: rec.posHint, games: 0, flat: {} };
        acc.set(rec.id, a);
      }
      a.games += 1;
      a.teamId = rec.teamId; // games arrive oldest first, so this ends on the latest team
      for (const [key, value] of Object.entries(rec.flat)) {
        if (key === "yardsAfterCatch" || key.startsWith("matchup.")) continue; // per-game display details, not league totals
        a.flat[key] = MAX_KEYS.has(key) ? Math.max(a.flat[key] ?? 0, value) : (a.flat[key] ?? 0) + value;
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
        await Promise.all(batch.map(async (game, idx) => {
          const rec = records[idx].find((r) => r.id === playerId);
          if (!rec) return;
          // Add the same YAC value the game matchup page requests, but only
          // for this player's row so scanning the league doesn't fan out into
          // hundreds of unnecessary per-athlete requests.
          try {
            const yacRecords = rec.posHint.toUpperCase() === "QB"
              ? records[idx].filter((candidate) => candidate.teamId === rec.teamId && ["QB", "RB", "WR", "TE"].includes(candidate.posHint.toUpperCase()))
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
        }));
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
