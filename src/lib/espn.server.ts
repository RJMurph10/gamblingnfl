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

const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
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
          } else if (/long/i.test(key)) {
            // Only the longest kick / punt is useful, and it is a max, not a sum.
            if (groupName === "kicking" || groupName === "punting") {
              const target = groupName === "kicking" ? "fgLong" : "puntLong";
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

async function fetchGameRecords(eventId: string): Promise<GameRecord[]> {
  try {
    return await memoize(`league-game-${eventId}`, GAME_TTL_MS, async () => {
      const res = await fetch(`${SUMMARY}?event=${eventId}`, {
        headers: { "User-Agent": "GamblingNFL/1.0" },
      });
      // Throwing (instead of returning []) keeps a failed fetch from being cached.
      if (!res.ok) throw new Error(`ESPN summary failed [${res.status}]`);
      return extractGameRecords(await res.json(), (abbr) => teamByAbbr(abbr)?.id);
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
 * full stat line for that game. Pass the player's current team to look at
 * that team's games first (much faster); if nothing turns up (traded
 * players) every game is checked.
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
        batch.forEach((game, idx) => {
          const rec = records[idx].find((r) => r.id === playerId);
          if (!rec) return;
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
        });
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
