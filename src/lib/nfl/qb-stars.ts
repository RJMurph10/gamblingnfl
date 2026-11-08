/**
 * ★ NFL QB passing-yards overs: built by scripts/nfl/qb_stars.py (GitHub Actions, daily in season) into
 * props-site/nfl/qb-stars-<season>.json. ★ = the QB model's median projection is 8%+ above DraftKings' line.
 * Research (research/props/nfl_qb_bets.py), single book at the opening line: 2024 85-50 (+7.4%), 2025 45-37
 * (+2.2%), and 28-15 in 2026 weeks 1–9, which the rule had never seen.
 */
export const QB_STAR_EDGE = 0.08;

/** [date, game, player, team, opening line, over price, projection, passing yards, result] */
export type QbStarPick = [
  string,
  string,
  string,
  string,
  number,
  number | null,
  number,
  number,
  "win" | "loss" | "push",
];
/** [date, game, player, team, line, over price, projection, edge, earlier NFL starts (newer builds)] */
export type QbStarUpcoming = [
  string,
  string,
  string,
  string,
  number,
  number | null,
  number,
  number,
  number?,
];

export interface QbStarsFile {
  season: number;
  updated: string;
  /** minStarts: no ★ on a QB with fewer earlier NFL starts (his first start). */
  rule: { edge: number; minStarts?: number; stat: string; side: string };
  /** wins, losses, pushes, units (1u at the listed price, −110 when ESPN shows none) */
  record: [number, number, number, number];
  picks: QbStarPick[];
  upcoming: QbStarUpcoming[];
}
