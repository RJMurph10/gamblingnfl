/**
 * Per-play moneyline / puck-line / total probabilities for an NHL game's Markets tab (the same chart
 * as the NFL and NBA pages). Goals still to come are Poisson for each team, scaled to the time left;
 * scoring is slower early and much faster in the last minutes of close games (empty nets), weights
 * measured on 1,312 real 2024-25 games. A tie after regulation goes to overtime/shootout, whose
 * winner gets one more goal (as sportsbooks grade the puck line and total).
 *
 * The scoring rates come from the sportsbook (total and no-vig moneyline) when posted, else from
 * the site's model. Pure functions (browser- and server-safe).
 */
import type { GameProbabilityPoint } from "@/data/shared/games";
import type { NhlGame, NhlPlay } from "./nhl";
import { elapsedAt, isShootoutPeriod } from "./nhl-live";
import { noVigProb } from "./nhl-model";

const REGULATION = 3600;
/** Goal-rate weights by game time (relative to the average minute). */
const EDGES = [0, 1200, 2400, 3300, 3420, 3540, 3600];
const WEIGHTS = [0.88, 1.02, 0.92, 1.03, 1.74, 2.68];
/** Expected extra goal from overtime/shootout winners, taken off a total to get regulation goals. */
const OT_GOAL = 0.23;
const MAX = 14;

function remainingWeight(t: number, close: boolean): number {
  let w = 0;
  for (let i = 0; i < WEIGHTS.length; i++) {
    const lo = EDGES[i];
    const hi = EDGES[i + 1];
    if (hi <= t) continue;
    const weight = !close && i >= 3 ? WEIGHTS[2] : WEIGHTS[i];
    w += (hi - Math.max(lo, t)) * weight;
  }
  return w;
}
const TOTAL_WEIGHT = remainingWeight(0, true);

function pois(lambda: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= MAX; k++) {
    out.push(p);
    p = (p * lambda) / (k + 1);
  }
  return out;
}

export interface NhlRates {
  away: number;
  home: number;
}

/** Win / cover / over chances from a score at a point in the game. */
export function nhlChances(
  rates: NhlRates,
  t: number,
  away: number,
  home: number,
  lines: { spread?: number | null; total?: number | null },
): { homeWin: number; homeCover?: number; over?: number } {
  const close = Math.abs(away - home) <= 2;
  const f = t >= REGULATION ? 0 : remainingWeight(t, close) / TOTAL_WEIGHT;
  const pa = pois(rates.away * f);
  const ph = pois(rates.home * f);
  const q = rates.home / (rates.home + rates.away); // home's chance to win overtime/shootout
  let homeWin = 0;
  let cover = 0;
  let coverPush = 0;
  let over = 0;
  let overPush = 0;
  for (let i = 0; i <= MAX; i++)
    for (let j = 0; j <= MAX; j++) {
      const p = pa[i] * ph[j];
      if (p < 1e-12) continue;
      const fa = away + i;
      const fh = home + j;
      const outcomes: [number, number, number][] =
        fa === fh
          ? [
              [p * q, fh + 1, fa],
              [p * (1 - q), fh, fa + 1],
            ]
          : [[p, fh, fa]];
      for (const [w, h, a] of outcomes) {
        if (h > a) homeWin += w;
        if (lines.spread != null) {
          const m = h - a + lines.spread;
          if (m > 0) cover += w;
          else if (m === 0) coverPush += w;
        }
        if (lines.total != null) {
          const tot = h + a;
          if (tot > lines.total) over += w;
          else if (tot === lines.total) overPush += w;
        }
      }
    }
  return {
    homeWin,
    ...(lines.spread != null ? { homeCover: cover / Math.max(1e-9, 1 - coverPush) } : {}),
    ...(lines.total != null ? { over: over / Math.max(1e-9, 1 - overPush) } : {}),
  };
}

/**
 * Pregame scoring rates: the sportsbook's total and no-vig moneyline when both are posted (the
 * home share is solved so the pregame win chance matches the market), else the model's goals.
 */
export function pregameRates(
  game: NhlGame,
  model?: { away: number; home: number },
): NhlRates | undefined {
  const o = game.odds;
  const sum = o?.total ? o.total - OT_GOAL : model ? model.away + model.home : undefined;
  if (!sum || sum <= 0) return undefined;
  const pHome = o?.mlHome != null && o?.mlAway != null ? noVigProb(o.mlHome, o.mlAway) : undefined;
  if (pHome === undefined) {
    if (!model) return { away: sum / 2, home: sum / 2 };
    const share = model.home / (model.home + model.away);
    return { away: sum * (1 - share), home: sum * share };
  }
  let lo = 0.15;
  let hi = 0.85;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const p = nhlChances({ away: sum * (1 - mid), home: sum * mid }, 0, 0, 0, {}).homeWin;
    if (p < pHome) lo = mid;
    else hi = mid;
  }
  const share = (lo + hi) / 2;
  return { away: sum * (1 - share), home: sum * share };
}

/** One point per play (and puck drop), ending on the actual result when the game is final. */
export function buildNhlProbabilities(
  plays: NhlPlay[],
  game: NhlGame,
  rates: NhlRates,
): GameProbabilityPoint[] {
  const lines = { spread: game.odds?.spread ?? null, total: game.odds?.total ?? null };
  const estimated: ("cover" | "over")[] = [
    ...(lines.spread != null ? (["cover"] as const) : []),
    ...(lines.total != null ? (["over"] as const) : []),
  ];
  const point = (
    t: number,
    away: number,
    home: number,
    extra: Partial<GameProbabilityPoint>,
  ): GameProbabilityPoint => {
    const c = nhlChances(rates, t, away, home, lines);
    return {
      homeWinProbability: c.homeWin,
      ...(c.homeCover !== undefined ? { homeCoverProbability: c.homeCover } : {}),
      ...(c.over !== undefined ? { overProbability: c.over } : {}),
      awayScore: away,
      homeScore: home,
      secondsLeft: Math.max(0, REGULATION - t),
      estimatedMarkets: estimated,
      probabilitySource: "estimated",
      ...extra,
    };
  };

  const out: GameProbabilityPoint[] = [
    point(0, 0, 0, { quarter: 1, clock: "20:00", playText: "Puck drop" }),
  ];
  let away = 0;
  let home = 0;
  for (const p of plays) {
    if (!p.period || isShootoutPeriod(game, p.period)) continue;
    if (p.awayScore !== null) away = Math.max(away, p.awayScore);
    if (p.homeScore !== null) home = Math.max(home, p.homeScore);
    const t = Math.min(REGULATION, elapsedAt(game, p.period, p.clock));
    out.push(
      point(t, away, home, { playId: p.id, quarter: p.period, clock: p.clock, playText: p.text }),
    );
  }
  if (
    game.status === "final" &&
    game.away.score !== null &&
    game.home.score !== null &&
    out.length > 1
  ) {
    const a = game.away.score;
    const h = game.home.score;
    const last = out[out.length - 1];
    last.awayScore = a;
    last.homeScore = h;
    last.homeWinProbability = h > a ? 1 : 0;
    if (lines.spread != null) {
      const m = h - a + lines.spread;
      last.homeCoverProbability = m > 0 ? 1 : m < 0 ? 0 : 0.5;
    }
    if (lines.total != null) {
      const tot = h + a;
      last.overProbability = tot > lines.total ? 1 : tot < lines.total ? 0 : 0.5;
    }
  }
  return out;
}
