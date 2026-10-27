/**
 * NHL player-prop projections and betting math. Pure functions.
 *
 * MODEL: a player's per-game rate for a stat (goals, assists, points, shots on goal, goalie
 * saves) = (season total + K × position average) / (games + K), with K = PRIOR_GAMES, so a few
 * games cannot swing a rate to an extreme. The stat is then treated as a Poisson count with that
 * mean. It does NOT know the opponent, ice time changes, power-play role, lines, injuries, or who
 * starts in goal (goalie saves assume the goalie plays a typical game).
 */
import { posGroup, type NhlPlayer, type NhlPosGroup, type NhlPropStat } from "./nhl";
import { americanToProb, expectedValue, noVigProb, probToAmerican } from "./nhl-model";

export const PRIOR_GAMES = 8;

export type RateTable = Record<NhlPosGroup, Partial<Record<NhlPropStat, number>>>;

/** A player's season total for a prop stat, or null when the feed has none. */
export function statTotal(p: NhlPlayer, stat: NhlPropStat): number | null {
  const s = p.stats;
  if (!s) return null;
  const v =
    stat === "goals" ? s.goals : stat === "assists" ? s.assists : stat === "points" ? s.points : stat === "sog" ? s.shots : s.saves;
  return v === null || v === undefined ? null : v;
}

/** League per-game rates by position group, weighted by games played. */
export function leagueRates(players: NhlPlayer[]): RateTable {
  const out: RateTable = { F: {}, D: {}, G: {} };
  const stats: NhlPropStat[] = ["goals", "assists", "points", "sog", "saves"];
  for (const g of ["F", "D", "G"] as const) {
    for (const stat of stats) {
      let total = 0;
      let gp = 0;
      for (const p of players) {
        if (posGroup(p.position) !== g || !p.stats || p.stats.gp < 1) continue;
        const t = statTotal(p, stat);
        if (t === null) continue;
        total += t;
        gp += p.stats.gp;
      }
      if (gp > 0) out[g][stat] = total / gp;
    }
  }
  return out;
}

export interface RateProjection {
  /** Expected count per game. */
  mean: number;
  /** Games behind the number. */
  games: number;
}

export function projectRate(p: NhlPlayer, stat: NhlPropStat, rates: RateTable): RateProjection | null {
  const total = statTotal(p, stat);
  const gp = p.stats?.gp ?? 0;
  const prior = rates[posGroup(p.position)][stat];
  if (total === null || gp < 1 || prior === undefined) return null;
  return { mean: (total + PRIOR_GAMES * prior) / (gp + PRIOR_GAMES), games: gp };
}

/** P(X = k) for a Poisson count with the given mean. */
export function poissonPmf(k: number, mean: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  let p = Math.exp(-mean);
  for (let i = 1; i <= k; i++) p *= mean / i;
  return p;
}

/** P(X ≤ k). */
export function poissonCdf(k: number, mean: number): number {
  let s = 0;
  for (let i = 0; i <= Math.floor(k); i++) s += poissonPmf(i, mean);
  return Math.min(1, s);
}

export interface PropEvaluation {
  pick: "over" | "under";
  /** Model chance of the pick (pushes removed). */
  prob: number;
  pOver: number;
  pUnder: number;
  pPush: number;
  fair: number | null;
  /** Model chance minus the price's chance: against the no-vig market when both prices exist, else the implied chance. */
  edge: number | null;
  edgeBasis: "no-vig" | "implied" | null;
  /** Expected profit per 1u at the picked side's price. */
  ev: number | null;
}

/** Over/under on a line (a half-line has no push; a whole-number line can push). */
export function evaluateProp(
  line: number,
  mean: number,
  overOdds: number | null,
  underOdds: number | null,
): PropEvaluation {
  const pOver = 1 - poissonCdf(Math.floor(line), mean);
  const pUnder = Number.isInteger(line) ? poissonCdf(line - 1, mean) : poissonCdf(Math.floor(line), mean);
  const pPush = Number.isInteger(line) ? poissonPmf(line, mean) : 0;
  const live = pOver + pUnder || 1;
  const overCond = pOver / live;
  const pick = overCond >= 0.5 ? "over" : "under";
  const prob = pick === "over" ? overCond : 1 - overCond;
  const price = pick === "over" ? overOdds : underOdds;
  let edge: number | null = null;
  let edgeBasis: PropEvaluation["edgeBasis"] = null;
  if (price !== null) {
    if (overOdds !== null && underOdds !== null) {
      const market = noVigProb(pick === "over" ? overOdds : underOdds, pick === "over" ? underOdds : overOdds);
      edge = prob - market;
      edgeBasis = "no-vig";
    } else {
      edge = prob - americanToProb(price);
      edgeBasis = "implied";
    }
  }
  return {
    pick,
    prob,
    pOver,
    pUnder,
    pPush,
    fair: probToAmerican(prob),
    edge,
    edgeBasis,
    ev: price === null ? null : expectedValue(prob, price),
  };
}

export interface YesEvaluation {
  /** Model chance of at least one. */
  prob: number;
  fair: number | null;
  /** Model chance minus the price's implied chance (vig included). */
  edge: number | null;
  ev: number | null;
}

/** An "anytime" market: at least one goal (or other event) in the game. */
export function evaluateAtLeastOne(mean: number, yesOdds: number | null): YesEvaluation {
  const prob = 1 - Math.exp(-mean);
  return {
    prob,
    fair: probToAmerican(prob),
    edge: yesOdds === null ? null : prob - americanToProb(yesOdds),
    ev: yesOdds === null ? null : expectedValue(prob, yesOdds),
  };
}
