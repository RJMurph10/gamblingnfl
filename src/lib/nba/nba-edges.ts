/**
 * NBA prop edge finder file (props-site nba/edges-<season>.json, built by scripts/props/nba-edges.mjs):
 * props where one book's line or price is off the other books' consensus, with results.
 */
export type EdgeTier = "10" | "6" | "4";

export interface EdgeFlag {
  id: string;
  start: string;
  date: string;
  home: string;
  away: string;
  player: string;
  team: string;
  market: "PTS" | "REB" | "AST" | "3PT";
  side: "over" | "under";
  line: number;
  book: string;
  price: number;
  ev: number;
  chance: number;
  consLine: number;
  consMean: number;
  books: number;
  tier: EdgeTier;
  at: string;
  actual?: number;
  res?: "win" | "loss" | "push" | "void";
}

export interface EdgesFile {
  season: string;
  updated: string;
  flags: EdgeFlag[];
  /** per tier: [wins, losses, pushes, units at 1u] */
  record: Record<EdgeTier, [number, number, number, number]>;
  usage?: { used: number | null; max: number | null; at: string };
}

/** Tiers 10 and 6 are bets (1 unit each); tier 4 is tracked only. */
export const EDGE_TIERS: { tier: EdgeTier; label: string; bet: boolean; backtest: string }[] = [
  { tier: "10", label: "EV 10%+", bet: true, backtest: "+20.4%" },
  { tier: "6", label: "EV 6–10%", bet: true, backtest: "+7.4%" },
  { tier: "4", label: "EV 4–6%", bet: false, backtest: "+2.5%" },
];

export const fmtOdds = (o: number) => (o > 0 ? `+${o}` : `${o}`);
