/**
 * Sample game data for the visual prototype: line scores, drive charts,
 * team stat lines, and box scores.
 *
 * Every number here is PLACEHOLDER. Replace with reads of `games`,
 * `game_quarter_scores`, `drives`, `team_game_stats`, and `player_game_stats`
 * once real play-by-play data is imported.
 */

export type DriveResult = "TD" | "FG" | "PUNT" | "TO" | "DOWNS" | "EOH" | "EOG";

export interface Drive {
  index: number;
  teamId: string;
  quarter: number;
  plays: number;
  yards: number;
  timeOfPossession: string;
  startAt: string;
  result: DriveResult;
}

export interface TeamGameStats {
  totalYards: number;
  passYards: number;
  rushYards: number;
  firstDowns: number;
  thirdDownPct: number;
  turnovers: number;
  penalties: number;
  timeOfPossession: string;
  /* Extended stats. All optional: sample data leaves them out and the
     comparison hides any stat that neither team has recorded. */
  touchdowns?: number;
  passingTouchdowns?: number;
  rushingTouchdowns?: number;
  fieldGoalsMade?: number;
  fieldGoalAttempts?: number;
  thirdDownMade?: number;
  thirdDownAtt?: number;
  fourthDownMade?: number;
  fourthDownAtt?: number;
  redZoneMade?: number;
  redZoneAtt?: number;
  extraPointsMade?: number;
  extraPointAttempts?: number;
  penaltyYards?: number;
  /** Defensive stats: things this team's DEFENSE recorded. */
  sacks?: number;
  defensiveTouchdowns?: number;
  interceptions?: number;
  forcedFumbles?: number;
  tacklesForLoss?: number;
  passesDefended?: number;
  qbHits?: number;
}

export interface BoxScoreLine {
  playerId?: string;
  name: string;
  position: string;
  teamId: string;
  statLine: string;
  category?: "offense" | "defense";

}

export interface Game {
  id: string;
  week: number;
  date: string;
  time?: string;
  kickoffIso?: string;
  clock?: string;
  kickoff: string;
  status: "final" | "live" | "scheduled";
  venue: string;
  /** City, state (or city, country for international games). */
  location: string;
  awayTeamId: string;
  homeTeamId: string;
  quarters: { away: number[]; home: number[] };
  spread: string;
  total: number;
  drives: Drive[];
  stats: { away: TeamGameStats; home: TeamGameStats };
  boxScore: BoxScoreLine[];
  possession?: "away" | "home" | null;
  isRedZone?: boolean;
  /** Live down & distance, e.g. "1st & 10". Empty between plays / on kickoffs. */
  downDistance?: string;
  awayRecord?: string;
  homeRecord?: string;
  possessionText?: string;
  distance?: number;

}


const sum = (nums: number[]) => nums.reduce((a, b) => a + b, 0);

export const gameScore = (game: Game) => ({
  away: sum(game.quarters.away),
  home: sum(game.quarters.home),
});

const baseDrives = (awayTeamId: string, homeTeamId: string): Drive[] => [
  { index: 1, teamId: awayTeamId, quarter: 1, plays: 8, yards: 62, timeOfPossession: "4:12", startAt: "Own 25", result: "TD" },
  { index: 2, teamId: homeTeamId, quarter: 1, plays: 6, yards: 41, timeOfPossession: "3:05", startAt: "Own 31", result: "FG" },
  { index: 3, teamId: awayTeamId, quarter: 1, plays: 3, yards: 4, timeOfPossession: "1:38", startAt: "Own 20", result: "PUNT" },
  { index: 4, teamId: homeTeamId, quarter: 2, plays: 11, yards: 75, timeOfPossession: "6:21", startAt: "Own 25", result: "TD" },
  { index: 5, teamId: awayTeamId, quarter: 2, plays: 7, yards: 38, timeOfPossession: "2:54", startAt: "Own 28", result: "FG" },
  { index: 6, teamId: homeTeamId, quarter: 2, plays: 4, yards: 12, timeOfPossession: "1:10", startAt: "Own 22", result: "EOH" },
  { index: 7, teamId: awayTeamId, quarter: 3, plays: 9, yards: 58, timeOfPossession: "4:48", startAt: "Own 32", result: "TD" },
  { index: 8, teamId: homeTeamId, quarter: 3, plays: 5, yards: 21, timeOfPossession: "2:16", startAt: "Own 19", result: "TO" },
  { index: 9, teamId: awayTeamId, quarter: 3, plays: 6, yards: 29, timeOfPossession: "3:02", startAt: "Own 41", result: "PUNT" },
  { index: 10, teamId: homeTeamId, quarter: 4, plays: 12, yards: 80, timeOfPossession: "6:44", startAt: "Own 20", result: "TD" },
  { index: 11, teamId: awayTeamId, quarter: 4, plays: 8, yards: 47, timeOfPossession: "3:31", startAt: "Own 26", result: "FG" },
  { index: 12, teamId: homeTeamId, quarter: 4, plays: 7, yards: 52, timeOfPossession: "3:18", startAt: "Own 30", result: "FG" },
  { index: 13, teamId: awayTeamId, quarter: 4, plays: 5, yards: 18, timeOfPossession: "1:02", startAt: "Own 24", result: "DOWNS" },
];

export const games: Game[] = [
  {
    id: "2025-w09-kc-buf",
    week: 9,
    kickoff: "Sun 4:25 PM ET",
    date: "Sun, Nov 2",
    status: "final",
    venue: "Highmark Stadium",
    location: "Orchard Park, NY",
    awayTeamId: "chiefs",
    homeTeamId: "bills",
    quarters: { away: [7, 3, 7, 7], home: [10, 7, 0, 10] },
    spread: "BUF -1.5",
    total: 47.5,
    drives: baseDrives("chiefs", "bills"),
    stats: {
      away: { totalYards: 412, passYards: 342, rushYards: 118, firstDowns: 23, thirdDownPct: 46, turnovers: 1, penalties: 5, timeOfPossession: "22:14" },
      home: { totalYards: 445, passYards: 289, rushYards: 156, firstDowns: 25, thirdDownPct: 52, turnovers: 2, penalties: 7, timeOfPossession: "27:46" },
    },
    boxScore: [
      { playerId: "j-marrow", name: "Jalen Marrow", position: "QB", teamId: "chiefs", statLine: "26/38, 318 yds, 3 TD, 1 INT" },
      { playerId: "b-oyelaran", name: "Bram Oyelaran", position: "WR", teamId: "chiefs", statLine: "7 rec, 101 yds, 1 TD" },
      { playerId: "r-castellan", name: "Rhett Castellan", position: "QB", teamId: "bills", statLine: "23/34, 289 yds, 2 TD" },
      { name: "Ivo Lindqvist", position: "RB", teamId: "bills", statLine: "21 car, 104 yds, 1 TD" },
    ],
  },
  {
    id: "2025-w09-bal-cin",
    week: 9,
    kickoff: "Sun 1:00 PM ET",
    date: "Sun, Nov 2",
    status: "final",
    venue: "Paycor Stadium",
    location: "Cincinnati, OH",
    awayTeamId: "ravens",
    homeTeamId: "bengals",
    quarters: { away: [3, 7, 7, 3], home: [0, 10, 7, 0] },
    spread: "BAL -3.5",
    total: 49.0,
    drives: baseDrives("ravens", "bengals"),
    stats: {
      away: { totalYards: 388, passYards: 231, rushYards: 157, firstDowns: 21, thirdDownPct: 50, turnovers: 0, penalties: 4, timeOfPossession: "31:08" },
      home: { totalYards: 341, passYards: 268, rushYards: 73, firstDowns: 19, thirdDownPct: 38, turnovers: 2, penalties: 6, timeOfPossession: "28:52" },
    },
    boxScore: [
      { playerId: "d-halloran", name: "Dane Halloran", position: "RB", teamId: "ravens", statLine: "23 car, 121 yds, 2 TD" },
      { playerId: "s-ibarra", name: "Sol Ibarra", position: "WR", teamId: "bengals", statLine: "7 rec, 94 yds, 1 TD" },
    ],
  },
  {
    id: "2025-w09-det-gb",
    week: 9,
    kickoff: "Sun 8:20 PM ET",
    date: "Sun, Nov 2",
    status: "final",
    venue: "Lambeau Field",
    location: "Green Bay, WI",
    awayTeamId: "lions",
    homeTeamId: "packers",
    quarters: { away: [7, 14, 3, 7], home: [7, 3, 10, 7] },
    spread: "DET -2.5",
    total: 51.5,
    drives: baseDrives("lions", "packers"),
    stats: {
      away: { totalYards: 467, passYards: 304, rushYards: 163, firstDowns: 26, thirdDownPct: 55, turnovers: 1, penalties: 3, timeOfPossession: "30:41" },
      home: { totalYards: 402, passYards: 276, rushYards: 126, firstDowns: 22, thirdDownPct: 43, turnovers: 1, penalties: 8, timeOfPossession: "29:19" },
    },
    boxScore: [
      { playerId: "l-thibault", name: "Luc Thibault", position: "QB", teamId: "lions", statLine: "25/33, 304 yds, 3 TD" },
      { playerId: "k-brennan", name: "Knox Brennan", position: "RB", teamId: "lions", statLine: "22 car, 108 yds, 2 TD" },
      { playerId: "c-nakamura", name: "Cory Nakamura", position: "RB", teamId: "packers", statLine: "19 car, 84 yds, 1 TD" },
    ],
  },
  {
    id: "2025-w09-sf-lar",
    week: 9,
    kickoff: "Sun 4:05 PM ET",
    date: "Sun, Nov 2",
    status: "final",
    venue: "SoFi Stadium",
    location: "Inglewood, CA",
    awayTeamId: "49ers",
    homeTeamId: "rams",
    quarters: { away: [10, 7, 7, 7], home: [7, 7, 7, 7] },
    spread: "SF -4.0",
    total: 48.5,
    drives: baseDrives("49ers", "rams"),
    stats: {
      away: { totalYards: 431, passYards: 298, rushYards: 133, firstDowns: 24, thirdDownPct: 48, turnovers: 0, penalties: 5, timeOfPossession: "32:02" },
      home: { totalYards: 396, passYards: 281, rushYards: 115, firstDowns: 21, thirdDownPct: 41, turnovers: 2, penalties: 6, timeOfPossession: "27:58" },
    },
    boxScore: [
      { playerId: "m-reyes", name: "Marco Reyes", position: "WR", teamId: "49ers", statLine: "10 rec, 138 yds, 2 TD" },
    ],
  },
  {
    id: "2025-w09-phi-was",
    week: 9,
    kickoff: "Sun 1:00 PM ET",
    date: "Sun, Nov 2",
    status: "final",
    venue: "Northwest Stadium",
    location: "Landover, MD",
    awayTeamId: "eagles",
    homeTeamId: "commanders",
    quarters: { away: [7, 7, 3, 7], home: [3, 7, 7, 3] },
    spread: "PHI -5.5",
    total: 45.0,
    drives: baseDrives("eagles", "commanders"),
    stats: {
      away: { totalYards: 379, passYards: 244, rushYards: 135, firstDowns: 20, thirdDownPct: 44, turnovers: 1, penalties: 4, timeOfPossession: "30:12" },
      home: { totalYards: 352, passYards: 239, rushYards: 113, firstDowns: 19, thirdDownPct: 39, turnovers: 1, penalties: 5, timeOfPossession: "29:48" },
    },
    boxScore: [
      { playerId: "t-vance", name: "Theo Vance", position: "WR", teamId: "eagles", statLine: "8 rec, 112 yds, 1 TD" },
    ],
  },
  {
    id: "2025-w10-hou-ind",
    week: 10,
    kickoff: "Sun 1:00 PM ET",
    date: "Sun, Nov 9",
    status: "scheduled",
    venue: "Lucas Oil Stadium",
    location: "Indianapolis, IN",
    awayTeamId: "texans",
    homeTeamId: "colts",
    quarters: { away: [0, 0, 0, 0], home: [0, 0, 0, 0] },
    spread: "HOU -2.5",
    total: 43.5,
    drives: [],
    stats: {
      away: { totalYards: 0, passYards: 0, rushYards: 0, firstDowns: 0, thirdDownPct: 0, turnovers: 0, penalties: 0, timeOfPossession: "00:00" },
      home: { totalYards: 0, passYards: 0, rushYards: 0, firstDowns: 0, thirdDownPct: 0, turnovers: 0, penalties: 0, timeOfPossession: "00:00" },
    },
    boxScore: [],
  },
  {
    id: "2025-w10-dal-chi",
    week: 10,
    kickoff: "Sun 4:25 PM ET",
    date: "Sun, Nov 9",
    status: "scheduled",
    venue: "Soldier Field",
    location: "Chicago, IL",
    awayTeamId: "cowboys",
    homeTeamId: "bears",
    quarters: { away: [0, 0, 0, 0], home: [0, 0, 0, 0] },
    spread: "CHI -1.0",
    total: 44.0,
    drives: [],
    stats: {
      away: { totalYards: 0, passYards: 0, rushYards: 0, firstDowns: 0, thirdDownPct: 0, turnovers: 0, penalties: 0, timeOfPossession: "00:00" },
      home: { totalYards: 0, passYards: 0, rushYards: 0, firstDowns: 0, thirdDownPct: 0, turnovers: 0, penalties: 0, timeOfPossession: "00:00" },
    },
    boxScore: [],
  },
  {
    id: "2025-w10-kc-den",
    week: 10,
    kickoff: "Sun 8:20 PM ET",
    date: "Sun, Nov 9",
    status: "scheduled",
    venue: "Empower Field",
    location: "Denver, CO",
    awayTeamId: "chiefs",
    homeTeamId: "broncos",
    quarters: { away: [0, 0, 0, 0], home: [0, 0, 0, 0] },
    spread: "KC -3.0",
    total: 46.5,
    drives: [],
    stats: {
      away: { totalYards: 0, passYards: 0, rushYards: 0, firstDowns: 0, thirdDownPct: 0, turnovers: 0, penalties: 0, timeOfPossession: "00:00" },
      home: { totalYards: 0, passYards: 0, rushYards: 0, firstDowns: 0, thirdDownPct: 0, turnovers: 0, penalties: 0, timeOfPossession: "00:00" },
    },
    boxScore: [],
  },
];

export const gameById = (id: string): Game | undefined => games.find((g) => g.id === id);

export const gamesByTeam = (teamId: string): Game[] =>
  games.filter((g) => g.awayTeamId === teamId || g.homeTeamId === teamId);

export const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => b - a);
