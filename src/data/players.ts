/**
 * Active 2026 NFL players with at least one recorded statistic, generated from
 * ESPN box scores by `python/build_players.py`. Re-run that script to refresh.
 * `yards` = pass + rush + receiving yards; `touches` = completions + carries +
 * receptions (tackles for defenders, field goals for kickers).
 */

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export interface PlayerGameLog {
  week: number;
  opponent: string; // team id
  yards: number;
  tds: number;
  touches: number;
}

export interface PlayerProjection {
  market: string;
  line: number;
  projection: number;
}

export interface Player {
  id: string; // ESPN athlete id
  firstName: string;
  lastName: string;
  /** ESPN position abbreviation (QB, WR, LB, CB, ...). */
  position: string;
  teamId: string;
  jersey: number;
  age: number;
  heightIn: number;
  weightLb: number;
  season: { games: number; yards: number; tds: number; touches: number };
  gameLog: PlayerGameLog[];
  projections: PlayerProjection[];
}

const log = (
  entries: [week: number, opponent: string, yards: number, tds: number, touches: number][],
): PlayerGameLog[] =>
  entries.map(([week, opponent, yards, tds, touches]) => ({ week, opponent, yards, tds, touches }));

export const players: Player[] = [

];

export const playerById = (id: string): Player | undefined => players.find((p) => p.id === id);

export const playersByTeam = (teamId: string): Player[] =>
  players.filter((p) => p.teamId === teamId).sort((a, b) => b.season.yards - a.season.yards);

export const positions: Position[] = ["QB", "RB", "WR", "TE", "DEF", "K"];

/** Groups ESPN positions into the filter buckets. */
export const positionGroup = (pos: string): Position =>
  ["QB", "RB", "WR", "TE", "K"].includes(pos) ? (pos as Position) : pos === "FB" ? "RB" : pos === "P" || pos === "LS" ? "K" : "DEF";
