/**
 * Tracked NFL angle (not a ★ yet): when a team's top target is out, the UNDER on the next man up's receiving
 * yards. Built by scripts/nfl/next_man_up.py (GitHub Actions, daily in season) into
 * props-site/nfl/next-man-up-<season>.json. Research (research/props/nfl_wr1_out*.py), opening lines 2024–2026:
 * unders 67-48 (+10.6%) for every team, 28-15 (+24%) when the team isn't pass-heavy. Found by splitting the
 * data, so it's tracked live from November 7, 2026 before it can earn a ★.
 */

/** [date, game, player, team, top target, pass rate, opening line, under price, yards, result] */
export type NextManUpPick = [
  string,
  string,
  string,
  string,
  string,
  number | null,
  number,
  number | null,
  number,
  "win" | "loss" | "push",
];
/** [date, game, player, team, top target, his injury status, pass rate, line, under price] */
export type NextManUpCandidate = [
  string,
  string,
  string,
  string,
  string,
  string,
  number | null,
  number,
  number | null,
];
/** wins, losses, pushes, units (1u at the listed price, −110 when none) */
export type NextManUpRecord = [number, number, number, number];

export interface NextManUpFile {
  season: number;
  updated: string;
  /** First day of live tracking (YYYY-MM-DD); earlier picks are a replay of the season. */
  liveFrom: string;
  rule: { passRateMax: number; minShare: number; stat: string; side: string };
  record: {
    all: { replay: NextManUpRecord; live: NextManUpRecord };
    run: { replay: NextManUpRecord; live: NextManUpRecord };
  };
  picks: NextManUpPick[];
  upcoming: NextManUpCandidate[];
}

export const NEXT_MAN_UP_OUT = new Set(["Out", "Doubtful", "Injured Reserve"]);
