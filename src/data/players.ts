/**
 * Sample player data for the visual prototype.
 *
 * Names are FICTIONAL and all numbers are PLACEHOLDER. Nothing here is a real
 * NFL statistic. Swap this module for reads of `players` + `player_game_stats`
 * once real play-by-play data is imported.
 */

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export interface PlayerGameLog {
  week: number;
  opponent: string; // team id
  /** Primary volume stat for the position (yards). */
  yards: number;
  tds: number;
  /** Receptions for WR/TE/RB, completions for QB. */
  touches: number;
}

export interface PlayerProjection {
  market: string;
  line: number;
  projection: number;
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  position: Position;
  teamId: string;
  jersey: number;
  age: number;
  heightIn: number;
  weightLb: number;
  season: {
    games: number;
    yards: number;
    tds: number;
    touches: number;
  };
  gameLog: PlayerGameLog[];
  projections: PlayerProjection[];
}

const log = (
  entries: [week: number, opponent: string, yards: number, tds: number, touches: number][],
): PlayerGameLog[] =>
  entries.map(([week, opponent, yards, tds, touches]) => ({ week, opponent, yards, tds, touches }));

export const players: Player[] = [
  {
    id: "j-marrow",
    firstName: "Jalen",
    lastName: "Marrow",
    position: "QB",
    teamId: "chiefs",
    jersey: 7,
    age: 26,
    heightIn: 75,
    weightLb: 219,
    season: { games: 9, yards: 2884, tds: 22, touches: 221 },
    gameLog: log([
      [9, "bills", 318, 3, 26],
      [8, "broncos", 274, 2, 22],
      [7, "raiders", 341, 4, 28],
      [6, "chargers", 229, 1, 19],
      [5, "texans", 302, 2, 24],
    ]),
    projections: [
      { market: "Pass yards", line: 274.5, projection: 291.0 },
      { market: "Pass TDs", line: 1.5, projection: 2.1 },
      { market: "Completions", line: 22.5, projection: 24.4 },
    ],
  },
  {
    id: "d-halloran",
    firstName: "Dane",
    lastName: "Halloran",
    position: "RB",
    teamId: "ravens",
    jersey: 28,
    age: 24,
    heightIn: 71,
    weightLb: 214,
    season: { games: 10, yards: 1102, tds: 14, touches: 208 },
    gameLog: log([
      [9, "bengals", 121, 2, 23],
      [8, "steelers", 88, 1, 18],
      [7, "browns", 142, 2, 25],
      [6, "colts", 61, 0, 14],
      [5, "titans", 97, 1, 20],
    ]),
    projections: [
      { market: "Rush yards", line: 92.5, projection: 104.8 },
      { market: "Rush attempts", line: 19.5, projection: 21.2 },
      { market: "Anytime TD", line: 0.5, projection: 0.74 },
    ],
  },
  {
    id: "t-vance",
    firstName: "Theo",
    lastName: "Vance",
    position: "WR",
    teamId: "eagles",
    jersey: 11,
    age: 27,
    heightIn: 73,
    weightLb: 196,
    season: { games: 10, yards: 948, tds: 9, touches: 68 },
    gameLog: log([
      [9, "commanders", 112, 1, 8],
      [8, "giants", 74, 1, 6],
      [7, "cowboys", 131, 2, 9],
      [6, "bears", 48, 0, 4],
      [5, "packers", 96, 1, 7],
    ]),
    projections: [
      { market: "Rec yards", line: 78.5, projection: 86.3 },
      { market: "Receptions", line: 5.5, projection: 6.4 },
    ],
  },
  {
    id: "m-reyes",
    firstName: "Marco",
    lastName: "Reyes",
    position: "WR",
    teamId: "49ers",
    jersey: 19,
    age: 25,
    heightIn: 74,
    weightLb: 204,
    season: { games: 10, yards: 1240, tds: 11, touches: 81 },
    gameLog: log([
      [9, "rams", 138, 2, 10],
      [8, "seahawks", 102, 1, 7],
      [7, "cardinals", 87, 1, 6],
      [6, "vikings", 164, 2, 11],
      [5, "lions", 71, 0, 5],
    ]),
    projections: [
      { market: "Rec yards", line: 88.5, projection: 95.1 },
      { market: "Receptions", line: 6.5, projection: 7.2 },
    ],
  },
  {
    id: "a-okafor",
    firstName: "Amari",
    lastName: "Okafor",
    position: "TE",
    teamId: "cowboys",
    jersey: 85,
    age: 29,
    heightIn: 78,
    weightLb: 251,
    season: { games: 10, yards: 612, tds: 6, touches: 54 },
    gameLog: log([
      [9, "eagles", 64, 1, 6],
      [8, "commanders", 41, 0, 4],
      [7, "giants", 88, 1, 7],
      [6, "buccaneers", 32, 0, 3],
      [5, "falcons", 57, 1, 5],
    ]),
    projections: [
      { market: "Rec yards", line: 52.5, projection: 58.0 },
      { market: "Receptions", line: 4.5, projection: 5.1 },
    ],
  },
  {
    id: "r-castellan",
    firstName: "Rhett",
    lastName: "Castellan",
    position: "QB",
    teamId: "bills",
    jersey: 3,
    age: 30,
    heightIn: 77,
    weightLb: 236,
    season: { games: 9, yards: 2510, tds: 19, touches: 198 },
    gameLog: log([
      [9, "chiefs", 289, 2, 23],
      [8, "jets", 241, 2, 20],
      [7, "patriots", 312, 3, 25],
      [6, "dolphins", 198, 1, 17],
      [5, "steelers", 267, 2, 21],
    ]),
    projections: [
      { market: "Pass yards", line: 261.5, projection: 272.4 },
      { market: "Pass TDs", line: 1.5, projection: 1.9 },
    ],
  },
  {
    id: "k-brennan",
    firstName: "Knox",
    lastName: "Brennan",
    position: "RB",
    teamId: "lions",
    jersey: 32,
    age: 23,
    heightIn: 70,
    weightLb: 208,
    season: { games: 10, yards: 1034, tds: 12, touches: 196 },
    gameLog: log([
      [9, "packers", 108, 2, 22],
      [8, "vikings", 76, 1, 17],
      [7, "bears", 131, 1, 24],
      [6, "49ers", 54, 0, 13],
      [5, "rams", 92, 2, 19],
    ]),
    projections: [
      { market: "Rush yards", line: 84.5, projection: 93.6 },
      { market: "Anytime TD", line: 0.5, projection: 0.68 },
    ],
  },
  {
    id: "s-ibarra",
    firstName: "Sol",
    lastName: "Ibarra",
    position: "WR",
    teamId: "bengals",
    jersey: 14,
    age: 28,
    heightIn: 72,
    weightLb: 191,
    season: { games: 9, yards: 884, tds: 7, touches: 63 },
    gameLog: log([
      [9, "ravens", 94, 1, 7],
      [8, "browns", 118, 1, 8],
      [7, "steelers", 57, 0, 5],
      [6, "texans", 103, 2, 8],
      [5, "colts", 66, 0, 5],
    ]),
    projections: [
      { market: "Rec yards", line: 74.5, projection: 80.2 },
      { market: "Receptions", line: 5.5, projection: 6.0 },
    ],
  },
  {
    id: "w-adeyemi",
    firstName: "Wes",
    lastName: "Adeyemi",
    position: "TE",
    teamId: "texans",
    jersey: 88,
    age: 26,
    heightIn: 77,
    weightLb: 245,
    season: { games: 10, yards: 571, tds: 5, touches: 49 },
    gameLog: log([
      [9, "colts", 48, 1, 5],
      [8, "jaguars", 72, 1, 6],
      [7, "titans", 35, 0, 3],
      [6, "bengals", 61, 1, 5],
      [5, "chiefs", 44, 0, 4],
    ]),
    projections: [{ market: "Rec yards", line: 48.5, projection: 52.7 }],
  },
  {
    id: "l-thibault",
    firstName: "Luc",
    lastName: "Thibault",
    position: "QB",
    teamId: "lions",
    jersey: 9,
    age: 28,
    heightIn: 74,
    weightLb: 224,
    season: { games: 10, yards: 2742, tds: 24, touches: 229 },
    gameLog: log([
      [9, "packers", 304, 3, 25],
      [8, "vikings", 268, 2, 22],
      [7, "bears", 251, 3, 20],
      [6, "49ers", 331, 2, 27],
      [5, "rams", 219, 1, 18],
    ]),
    projections: [
      { market: "Pass yards", line: 268.5, projection: 283.9 },
      { market: "Pass TDs", line: 1.5, projection: 2.3 },
    ],
  },
  {
    id: "c-nakamura",
    firstName: "Cory",
    lastName: "Nakamura",
    position: "RB",
    teamId: "packers",
    jersey: 24,
    age: 25,
    heightIn: 69,
    weightLb: 199,
    season: { games: 9, yards: 798, tds: 7, touches: 171 },
    gameLog: log([
      [9, "lions", 84, 1, 19],
      [8, "bears", 67, 0, 16],
      [7, "vikings", 112, 2, 23],
      [6, "seahawks", 51, 0, 12],
      [5, "cardinals", 88, 1, 18],
    ]),
    projections: [{ market: "Rush yards", line: 71.5, projection: 78.4 }],
  },
  {
    id: "b-oyelaran",
    firstName: "Bram",
    lastName: "Oyelaran",
    position: "WR",
    teamId: "chiefs",
    jersey: 17,
    age: 24,
    heightIn: 75,
    weightLb: 207,
    season: { games: 9, yards: 812, tds: 8, touches: 58 },
    gameLog: log([
      [9, "bills", 101, 1, 7],
      [8, "broncos", 64, 1, 5],
      [7, "raiders", 129, 2, 9],
      [6, "chargers", 43, 0, 4],
      [5, "texans", 78, 1, 6],
    ]),
    projections: [
      { market: "Rec yards", line: 69.5, projection: 77.8 },
      { market: "Receptions", line: 5.5, projection: 5.9 },
    ],
  },
];

export const playerById = (id: string): Player | undefined => players.find((p) => p.id === id);

export const playersByTeam = (teamId: string): Player[] =>
  players.filter((p) => p.teamId === teamId);

export const positions: Position[] = ["QB", "RB", "WR", "TE"];
