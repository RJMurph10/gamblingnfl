/**
 * The NBA model: team power ratings, game predictions, graded picks and player projections.
 *
 * Ratings: every team has an offense and a defense number (points above/below the league
 * average, adjusted for opponent and home court). They start from last season's scoring
 * (shrunk toward average, since rosters change) and are pulled toward this season's results as
 * games are played, like a ridge regression. Predictions for a finished game only use games
 * played BEFORE its day, so the record is an honest walk-forward test, not hindsight.
 *
 * Picks: spread / total picks when the model disagrees with the closing line (★ = a big gap),
 * and a moneyline winner for every game. Units are flat 1u per pick at -110 (moneyline picks
 * use the listed moneyline when ESPN has one).
 */
import {
  atsResult,
  etDayKey,
  hasScore,
  impliedProb,
  isRatedGame,
  normCdf,
  ouResult,
  statValue,
  winnerOf,
  type NbaGame,
  type NbaLogRow,
  type NbaPriorTeam,
  type NbaStatKey,
} from "./nba";

export const HOME_COURT = 2.3;
/** Games' worth of weight given to last season before this season's results take over. */
const PRIOR_WEIGHT = 14;
/** Rosters change; last year's ratings are only trusted this much. */
const PRIOR_SHRINK = 0.7;
/** Typical standard deviation of an NBA final margin around a good prediction. */
export const MARGIN_SD = 12;
const TOTAL_SD = 17;
const DEFAULT_AVG = 114;

export const SPREAD_PICK_MIN = 1.0;
export const SPREAD_BEST_MIN = 3.0;
export const TOTAL_PICK_MIN = 2.0;
export const TOTAL_BEST_MIN = 5.0;
const WIN_UNITS = 100 / 110;

export interface RatingTable {
  avg: number;
  off: Map<string, number>;
  def: Map<string, number>;
  games: Map<string, number>;
}

export function buildRatings(finals: NbaGame[], prior: NbaPriorTeam[]): RatingTable {
  const priorAvg = prior.length ? prior.reduce((s, t) => s + t.ppg, 0) / prior.length : DEFAULT_AVG;
  const scores = finals.length * 2;
  const seasonAvg = scores
    ? finals.reduce((s, g) => s + (g.away.score ?? 0) + (g.home.score ?? 0), 0) / scores
    : priorAvg;
  // Blend: early on the league average is mostly last season's.
  const avg = (priorAvg * 120 + seasonAvg * scores) / (120 + scores);

  const priorOff = new Map<string, number>();
  const priorDef = new Map<string, number>();
  for (const t of prior) {
    priorOff.set(t.teamId, PRIOR_SHRINK * (t.ppg - priorAvg));
    priorDef.set(t.teamId, PRIOR_SHRINK * (t.oppPpg - priorAvg));
  }
  const off = new Map(priorOff);
  const def = new Map(priorDef);
  const games = new Map<string, number>();
  const ids = new Set<string>(prior.map((t) => t.teamId));
  for (const g of finals) {
    ids.add(g.home.team.id);
    ids.add(g.away.team.id);
    games.set(g.home.team.id, (games.get(g.home.team.id) ?? 0) + 1);
    games.set(g.away.team.id, (games.get(g.away.team.id) ?? 0) + 1);
  }
  for (const id of ids) {
    if (!off.has(id)) off.set(id, 0);
    if (!def.has(id)) def.set(id, 0);
  }
  if (!finals.length) return { avg, off, def, games };

  const h = HOME_COURT / 2;
  for (let iter = 0; iter < 25; iter++) {
    const offSum = new Map<string, number>();
    const defSum = new Map<string, number>();
    for (const g of finals) {
      const hs = g.home.score as number;
      const as = g.away.score as number;
      const H = g.home.team.id;
      const A = g.away.team.id;
      offSum.set(H, (offSum.get(H) ?? 0) + (hs - avg - h - (def.get(A) ?? 0)));
      offSum.set(A, (offSum.get(A) ?? 0) + (as - avg + h - (def.get(H) ?? 0)));
      defSum.set(A, (defSum.get(A) ?? 0) + (hs - avg - h - (off.get(H) ?? 0)));
      defSum.set(H, (defSum.get(H) ?? 0) + (as - avg + h - (off.get(A) ?? 0)));
    }
    for (const id of ids) {
      const n = games.get(id) ?? 0;
      off.set(id, ((offSum.get(id) ?? 0) + PRIOR_WEIGHT * (priorOff.get(id) ?? 0)) / (n + PRIOR_WEIGHT));
      def.set(id, ((defSum.get(id) ?? 0) + PRIOR_WEIGHT * (priorDef.get(id) ?? 0)) / (n + PRIOR_WEIGHT));
    }
  }
  return { avg, off, def, games };
}

export interface Prediction {
  home: number;
  away: number;
  /** Home margin (positive = home wins). */
  margin: number;
  total: number;
  homeWinProb: number;
}

export function predictGame(r: RatingTable, homeId: string, awayId: string): Prediction {
  const home = r.avg + (r.off.get(homeId) ?? 0) + (r.def.get(awayId) ?? 0) + HOME_COURT / 2;
  const away = r.avg + (r.off.get(awayId) ?? 0) + (r.def.get(homeId) ?? 0) - HOME_COURT / 2;
  const margin = home - away;
  return { home, away, margin, total: home + away, homeWinProb: normCdf(margin / MARGIN_SD) };
}

/** Ratings as table rows: offense/defense in points per game, net = off − def. */
export function ratingRows(r: RatingTable) {
  return [...r.off.keys()]
    .map((id) => {
      const offense = r.avg + (r.off.get(id) ?? 0);
      const defense = r.avg + (r.def.get(id) ?? 0);
      return { teamId: id, offense, defense, net: offense - defense, games: r.games.get(id) ?? 0 };
    })
    .sort((a, b) => b.net - a.net)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/* ---------- graded picks ---------- */

export type PickResult = "win" | "loss" | "push";

export interface NbaModelRow {
  game: NbaGame;
  pred: Prediction;
  moneyline: { pick: "home" | "away"; prob: number; result: PickResult | null; units: number | null };
  spread: {
    pick: "home" | "away";
    line: number;
    /** Points of disagreement with the market. */
    edge: number;
    best: boolean;
    result: PickResult | null;
  } | null;
  total: {
    pick: "over" | "under";
    line: number;
    edge: number;
    best: boolean;
    result: PickResult | null;
  } | null;
}

const toResult = (won: boolean, push = false): PickResult => (push ? "push" : won ? "win" : "loss");

function mlUnits(pickHome: boolean, game: NbaGame, result: PickResult | null): number | null {
  if (!result) return null;
  const price = pickHome ? game.odds?.mlHome : game.odds?.mlAway;
  if (price === null || price === undefined) return null;
  if (result === "push") return 0;
  if (result === "loss") return -1;
  return price > 0 ? price / 100 : 100 / -price;
}

export function rowFor(game: NbaGame, pred: Prediction): NbaModelRow {
  const pickHome = pred.margin >= 0;
  const winner = winnerOf(game);
  const mlResult = winner ? toResult(winner === (pickHome ? "home" : "away")) : null;

  let spread: NbaModelRow["spread"] = null;
  const line = game.odds?.spread;
  if (line !== null && line !== undefined) {
    const edge = pred.margin + line; // >0: model likes home against the number
    if (Math.abs(edge) >= SPREAD_PICK_MIN) {
      const pick = edge > 0 ? "home" : "away";
      const res = atsResult(game, line);
      spread = {
        pick,
        line,
        edge: Math.abs(edge),
        best: Math.abs(edge) >= SPREAD_BEST_MIN,
        result: res ? toResult(res === pick, res === "push") : null,
      };
    }
  }
  let total: NbaModelRow["total"] = null;
  const tl = game.odds?.total;
  if (tl !== null && tl !== undefined) {
    const edge = pred.total - tl;
    if (Math.abs(edge) >= TOTAL_PICK_MIN) {
      const pick = edge > 0 ? "over" : "under";
      const res = ouResult(game, tl);
      total = {
        pick,
        line: tl,
        edge: Math.abs(edge),
        best: Math.abs(edge) >= TOTAL_BEST_MIN,
        result: res ? toResult(res === pick, res === "push") : null,
      };
    }
  }
  return {
    game,
    pred,
    moneyline: {
      pick: pickHome ? "home" : "away",
      prob: pickHome ? pred.homeWinProb : 1 - pred.homeWinProb,
      result: mlResult,
      units: mlUnits(pickHome, game, mlResult),
    },
    spread,
    total,
  };
}

/**
 * Model rows for every rated game. Finished games are predicted from the games before their
 * day only; unfinished games use everything played so far.
 */
export function runNbaModel(games: NbaGame[], prior: NbaPriorTeam[]): NbaModelRow[] {
  const rated = games.filter((g) => isRatedGame(g) && g.status !== "postponed");
  const finals = rated
    .filter((g) => g.status === "final" && hasScore(g))
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows: NbaModelRow[] = [];

  const days = [...new Set(finals.map((g) => etDayKey(g.date)))];
  let cursor = 0;
  for (const day of days) {
    while (cursor < finals.length && etDayKey(finals[cursor].date) < day) cursor++;
    const table = buildRatings(finals.slice(0, cursor), prior);
    for (const g of finals.filter((x) => etDayKey(x.date) === day))
      rows.push(rowFor(g, predictGame(table, g.home.team.id, g.away.team.id)));
  }
  const now = buildRatings(finals, prior);
  for (const g of rated.filter((x) => x.status !== "final" || !hasScore(x)))
    rows.push(rowFor(g, predictGame(now, g.home.team.id, g.away.team.id)));
  return rows.sort((a, b) => a.game.date.localeCompare(b.game.date));
}

export interface Record3 {
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  winPct: number | null;
  roi: number | null;
}

const emptyRecord = (): Record3 => ({ wins: 0, losses: 0, pushes: 0, units: 0, winPct: null, roi: null });

function add(rec: Record3, result: PickResult | null, units: number | null) {
  if (!result) return;
  if (result === "win") rec.wins++;
  else if (result === "loss") rec.losses++;
  else rec.pushes++;
  rec.units += units ?? 0;
}

function finish(rec: Record3, staked: number) {
  const decided = rec.wins + rec.losses;
  rec.winPct = decided ? (rec.wins / decided) * 100 : null;
  rec.roi = staked ? (rec.units / staked) * 100 : null;
  rec.units = Math.round(rec.units * 100) / 100;
}

export interface NbaModelSummary {
  moneyline: Record3;
  spread: Record3;
  total: Record3;
  /** Spread + total picks (the units card). */
  overall: Record3;
}

/**
 * Record of the picks. `bets` counts only ★ best bets; `predictions` counts every pick the
 * model makes. `asOf` ignores games that finished after that moment (for week-over-week change).
 */
export function summarizeNba(
  rows: NbaModelRow[],
  scope: "predictions" | "bets",
  asOf?: Date,
): NbaModelSummary {
  const moneyline = emptyRecord();
  const spread = emptyRecord();
  const total = emptyRecord();
  const overall = emptyRecord();
  let mlStaked = 0;
  let stakes = 0;
  let spreadStaked = 0;
  let totalStaked = 0;
  for (const r of rows) {
    if (r.game.status !== "final") continue;
    if (asOf && new Date(r.game.date).getTime() > asOf.getTime()) continue;
    if (scope === "predictions") {
      add(moneyline, r.moneyline.result, r.moneyline.units);
      if (r.moneyline.units !== null) mlStaked++;
    }
    for (const [pick, rec] of [
      [r.spread, spread],
      [r.total, total],
    ] as const) {
      if (!pick || !pick.result) continue;
      if (scope === "bets" && !pick.best) continue;
      const u = pick.result === "win" ? WIN_UNITS : pick.result === "loss" ? -1 : 0;
      add(rec, pick.result, u);
      add(overall, pick.result, u);
      stakes++;
      if (rec === spread) spreadStaked++;
      else totalStaked++;
    }
  }
  finish(moneyline, mlStaked);
  finish(spread, spreadStaked);
  finish(total, totalStaked);
  finish(overall, stakes);
  return { moneyline, spread, total, overall };
}

export const unitsText = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;

/* ---------- player projections ---------- */

export interface StatProjection {
  stat: NbaStatKey;
  mean: number;
  sd: number;
  /** Middle-50% range. */
  p25: number;
  p75: number;
  /** Games behind the number (this season, plus last season's if the sample is small). */
  games: number;
  /** This season's per-game average for context. */
  seasonAvg: number | null;
}

const played = (rows: NbaLogRow[]) => rows.filter((r) => r.min > 0 && r.part !== "pre");

/**
 * Projects one stat for the next game. Recent games count more; early in the season last
 * season's average fills in. `teamFactor` nudges the projection for the game's expected pace
 * and scoring (the model's team score ÷ that team's usual score).
 */
export function projectStat(
  log: NbaLogRow[],
  priorLog: NbaLogRow[],
  stat: NbaStatKey,
  teamFactor = 1,
): StatProjection | null {
  const cur = played(log).slice(0, 20); // already newest first
  const old = played(priorLog).slice(0, 40);
  if (!cur.length && !old.length) return null;

  const values = cur.map((r) => statValue(r, stat));
  const oldValues = old.map((r) => statValue(r, stat));
  const decay = 0.93;
  let wSum = 0;
  let vSum = 0;
  values.forEach((v, i) => {
    const w = Math.pow(decay, i);
    wSum += w;
    vSum += w * v;
  });
  const curMean = wSum ? vSum / wSum : null;
  const oldMean = oldValues.length ? oldValues.reduce((a, b) => a + b, 0) / oldValues.length : null;
  let mean: number;
  if (curMean === null) mean = oldMean as number;
  else if (oldMean === null) mean = curMean;
  else {
    const priorWeight = Math.max(0, 10 - values.length) / 10; // fades out by 10 games
    mean = curMean * (1 - 0.6 * priorWeight) + oldMean * 0.6 * priorWeight;
  }
  const factor = Math.min(1.1, Math.max(0.9, Math.pow(teamFactor, 0.8)));
  mean *= factor;

  const pool = values.length >= 8 ? values : [...values, ...oldValues].slice(0, 25);
  const avgPool = pool.reduce((a, b) => a + b, 0) / (pool.length || 1);
  const variance =
    pool.length > 1 ? pool.reduce((s, v) => s + (v - avgPool) ** 2, 0) / (pool.length - 1) : 0;
  const sd = Math.max(Math.sqrt(variance), 0.55 * Math.sqrt(Math.max(mean, 1)));
  const seasonAvg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    stat,
    mean,
    sd,
    p25: Math.max(0, mean - 0.674 * sd),
    p75: mean + 0.674 * sd,
    games: values.length,
    seasonAvg,
  };
}

/** Chance the stat finishes above a line (the line is a half point for most props). */
export function probOver(line: number, p: StatProjection): number {
  return 1 - normCdf((line - p.mean) / p.sd);
}

export interface PropEdge {
  pick: "over" | "under";
  /** Model probability of the picked side. */
  prob: number;
  /** Model probability minus the price's implied probability (null with no price). */
  edge: number | null;
  /** Projection minus the line. */
  diff: number;
}

export function evaluateProp(
  line: number,
  p: StatProjection,
  overOdds?: string,
  underOdds?: string,
): PropEdge {
  const over = probOver(line, p);
  const pick = over >= 0.5 ? "over" : "under";
  const prob = pick === "over" ? over : 1 - over;
  const price = Number(pick === "over" ? overOdds : underOdds);
  return {
    pick,
    prob,
    edge: Number.isFinite(price) && price !== 0 ? prob - impliedProb(price) : null,
    diff: p.mean - line,
  };
}
