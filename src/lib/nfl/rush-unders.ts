/**
 * Tracked NFL angle (not a ★ yet): the under on every DraftKings rushing-yards main line, with the strongest
 * spots flagged. Built by scripts/nfl/rush_unders.py (GitHub Actions, daily in season) into
 * props-site/nfl/rush-unders-<season>.json. Research (research/props/nfl_line_props_*.py): unders +7.2%,
 * +1.9%, +4.7% at the opening line in 2024–2026. Rule fixed November 8, 2026, graded live from then.
 */

/** Why a line is flagged: "QB", "20.5-35 yds", "low script". */
export type RushReason = string;
/** [date, game, player, team, opening line, under price, yards, result, reasons] */
export type RushPick = [
  string,
  string,
  string,
  string,
  number,
  number | null,
  number,
  "win" | "loss" | "push",
  RushReason[],
];
/** [date, game, player, team, opening line, under price, current line, reasons] */
export type RushCandidate = [
  string,
  string,
  string,
  string,
  number,
  number | null,
  number | null,
  RushReason[],
];
/** wins, losses, pushes, units (1u at the listed price, −110 when none) */
export type RushRecord = [number, number, number, number];

export interface RushUndersFile {
  season: number;
  updated: string;
  liveFrom: string;
  record: {
    all: { replay: RushRecord; live: RushRecord };
    strong: { replay: RushRecord; live: RushRecord };
  };
  picks: RushPick[];
  upcoming: RushCandidate[];
}

export const RUSH_REASON_TEXT: Record<string, string> = {
  QB: "QB",
  "20.5-35 yds": "20.5–35 yd line",
  "low script": "team expected to score less than usual",
};
