/**
 * ★ NBA rebound unders, browser-safe: the same rule as scripts/line-history/nba-reb-stars.mjs (keep the two
 * in step). The daily props job replays the season, grades every ★ pick at DraftKings' opening line, and
 * saves each player's projection inputs to props-site/nba/reb-stars-<season>.json; the props page stars
 * today's lines from those inputs.
 *
 * Projection = (0.6 × season rebounds per minute + 0.4 × last-10 rebounds per minute) × recent minutes
 * (exponentially weighted, half-life 5 games), from this season's games only. ★ when it's 10%+ below the
 * line, he has 8+ games, and the under is priced −160 or better.
 *
 * Research (research/props/nba_model.py, nba_reb.py; site replay of the same rule): 2066-1465 (+6.6% ROI)
 * in 2023-24, 838-689 (+1.2%) in 2024-25, 215-150 (+7.3%) in 2025-26 through January.
 */
export const REB_STAR_EDGE = 0.1;
export const REB_STAR_MIN_GAMES = 8;
export const REB_STAR_WORST_PRICE = -160;

/** [season reb/min, last-10 reb/min | null, weighted minutes, games] */
export type RebInputs = [number, number | null, number, number];

/** [date, gameId, game, player, team, opening line, under price, projection, rebounds, result] */
export type RebStarPick = [string, string, string, string, string, number, number | null, number, number, "win" | "loss" | "push"];

export interface RebStarsFile {
  season: string;
  updated: string;
  rule: { edge: number; minGames: number; worstPrice: number };
  /** wins, losses, pushes, units (1u at the listed price) */
  record: [number, number, number, number];
  picks: RebStarPick[];
  inputs: Record<string, RebInputs>;
}

export const rebProjection = (x: RebInputs) => (0.6 * x[0] + 0.4 * (x[1] ?? x[0])) * x[2];

/** ★ for a rebounds line: projection 10%+ below it, 8+ games, under priced −160 or better. */
export function isRebStar(x: RebInputs | undefined, line: number, under?: string | number | null): boolean {
  const price = Number(under);
  if (!x || x[3] < REB_STAR_MIN_GAMES || !(line > 0)) return false;
  if (!Number.isFinite(price) || price === 0 || price < REB_STAR_WORST_PRICE) return false;
  return (rebProjection(x) - line) / Math.max(1, line) <= -REB_STAR_EDGE;
}
