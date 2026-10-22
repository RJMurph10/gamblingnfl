/**
 * Player prop projections: what the model expects a player to put up in each prop stat.
 *
 *   projection = recent form (recency-weighted, pulled toward the position average when there are
 *                few games) × opponent defense factor × game-script factor
 *
 * Walk-forward, like the game model: a projection for week N only uses games before week N, so the
 * season accuracy shown on the site is an honest test.
 *
 * Pure functions (browser- and server-safe), no network.
 */

import { MARKET_SOURCES, summarizeMarket, type PlayerGameInput } from "./prop-analytics";
import {
  PROP_MARKETS,
  computeRange,
  isMarketForPosition,
  marketByKey,
  normalizePropPosition,
  type PropCategory,
} from "./prop-model";

export const PROJECTION_SETTINGS = {
  version: "gnfl-props-v1",
  /** Recency weighting: a game this many games ago counts half as much as the latest one. */
  halfLifeGames: 3,
  /** How strongly early-season form is pulled toward the position average (in games). */
  positionPriorGames: 1.5,
  /** Shrinkage on the opponent defense factor, in defensive games. */
  defenseShrinkGames: 4,
  /** Limits on the adjustments, so one blowout can't swing a projection wildly. */
  defenseClamp: [0.75, 1.25] as const,
  scriptClamp: [0.8, 1.25] as const,
  /** Projections (and accuracy tests) need at least this many earlier games in the stat. */
  minGames: 2,
} as const;

/* ---------------- league context (defense + position averages) ---------------- */

/** One player's box score in one finished game, with game context. Teams are abbreviations. */
export interface LeagueRecord {
  playerId: string;
  week: number;
  team: string;
  opponent: string;
  home: boolean;
  /** Position (any feed's wording; normalized internally). */
  position: string;
  flat: Record<string, number>;
}

/** Defenses are compared by position group: backs (RB/FB), receivers, tight ends, QBs. */
export const positionGroup = (position: string) => {
  const p = normalizePropPosition(position);
  return p === "FB" ? "RB" : p;
};

/** Markets where a defense adjustment makes sense (not longest plays, kicking or punting). */
const DEFENSE_CATEGORIES: PropCategory[] = [
  "passing",
  "rushing",
  "receiving",
  "receptions",
  "other",
];
const usesDefense = (key: string) => {
  const m = marketByKey(key);
  return !!m && m.kind !== "long" && DEFENSE_CATEGORIES.includes(m.category);
};

export interface WeekContext {
  /** Per defense / position group / market: total allowed and that defense's games. */
  allowed: Map<string, number>;
  defenseGames: Map<string, number>;
  /** League totals per position group / market, and total team-games, for the average. */
  leagueAllowed: Map<string, number>;
  teamGames: number;
  /** Average per player-game for each position group / market (among players with the stat). */
  positionMean: Map<string, { sum: number; n: number }>;
}

/** Each record's prop values, worked out once and reused for every week's context. */
const recordValues = new WeakMap<
  LeagueRecord,
  { key: string; value: number; defense: boolean }[]
>();
function valuesOf(r: LeagueRecord) {
  let list = recordValues.get(r);
  if (list) return list;
  list = [];
  for (const market of PROP_MARKETS) {
    if (!isMarketForPosition(market.key, r.position)) continue;
    const summary = summarizeMarket(market.key, [
      { gameId: "", week: r.week, opponent: r.opponent, home: r.home, flat: r.flat },
    ]);
    if (summary)
      list.push({ key: market.key, value: summary.log[0].value, defense: usesDefense(market.key) });
  }
  recordValues.set(r, list);
  return list;
}

/** League context from every finished game before `week`. */
export function buildWeekContext(records: LeagueRecord[], week: number): WeekContext {
  const allowed = new Map<string, number>();
  const leagueAllowed = new Map<string, number>();
  const positionMean = new Map<string, { sum: number; n: number }>();
  const defenseGameSet = new Map<string, Set<string>>();

  for (const r of records) {
    if (r.week >= week) continue;
    const group = positionGroup(r.position);
    const games = defenseGameSet.get(r.opponent) ?? new Set<string>();
    games.add(`${r.week}:${r.team}`);
    defenseGameSet.set(r.opponent, games);

    for (const { key, value, defense } of valuesOf(r)) {
      const pmKey = `${group}|${key}`;
      const pm = positionMean.get(pmKey);
      if (pm) {
        pm.sum += value;
        pm.n += 1;
      } else positionMean.set(pmKey, { sum: value, n: 1 });
      if (!defense) continue;
      const k = `${r.opponent}|${group}|${key}`;
      allowed.set(k, (allowed.get(k) ?? 0) + value);
      leagueAllowed.set(pmKey, (leagueAllowed.get(pmKey) ?? 0) + value);
    }
  }
  const defenseGames = new Map<string, number>();
  let teamGames = 0;
  for (const [team, set] of defenseGameSet) {
    defenseGames.set(team, set.size);
    teamGames += set.size;
  }
  return { allowed, defenseGames, leagueAllowed, teamGames, positionMean };
}

/** How much this defense gives up in a stat to a position group vs. the league (1 = average). */
export function defenseFactor(
  ctx: WeekContext,
  defense: string,
  position: string,
  key: string,
): number {
  if (!usesDefense(key)) return 1;
  const group = positionGroup(position);
  const games = ctx.defenseGames.get(defense) ?? 0;
  const leagueTotal = ctx.leagueAllowed.get(`${group}|${key}`) ?? 0;
  if (!games || !ctx.teamGames || leagueTotal <= 0) return 1;
  const perGame = (ctx.allowed.get(`${defense}|${group}|${key}`) ?? 0) / games;
  const leaguePerGame = leagueTotal / ctx.teamGames;
  const raw = perGame / leaguePerGame;
  const k = PROJECTION_SETTINGS.defenseShrinkGames;
  const shrunk = 1 + (raw - 1) * (games / (games + k));
  const [lo, hi] = PROJECTION_SETTINGS.defenseClamp;
  return Math.min(hi, Math.max(lo, shrunk));
}

/* ---------------- game script ---------------- */

/**
 * Game-script multiplier for a market, from the team's expected points this game divided by its
 * average points so far (e.g. 1.1 = expected to score 10% more than usual). Touchdowns and kicking
 * points move fully with it, yards and counts by the square root, punts the other way.
 */
export function scriptMultiplier(key: string, teamScriptRatio: number): number {
  const [lo, hi] = PROJECTION_SETTINGS.scriptClamp;
  const r = Math.min(hi, Math.max(lo, Number.isFinite(teamScriptRatio) ? teamScriptRatio : 1));
  const m = marketByKey(key);
  if (!m || m.kind === "long" || key === "pass_int") return 1;
  if (m.category === "punting") return 1 / Math.sqrt(r);
  if (m.kind === "touchdowns" || m.category === "kicking") return r;
  return Math.sqrt(r);
}

/* ---------------- projections ---------------- */

export interface StatProjection {
  projected: number;
  lower: number;
  upper: number;
  /** The pieces, so the page can explain the number. */
  form: number;
  defense: number;
  script: number;
  /** Earlier games the projection is built on. */
  games: number;
}

/**
 * Projection for one player and stat, from his earlier games (all before the target game).
 * Returns undefined when he hasn't recorded the stat in enough games.
 */
export function projectStat(
  key: string,
  position: string,
  priorGames: PlayerGameInput[],
  ctx: WeekContext,
  opponent: string,
  teamScriptRatio: number,
): StatProjection | undefined {
  const market = marketByKey(key);
  if (!market || !MARKET_SOURCES[key] || !isMarketForPosition(key, position)) return undefined;
  const summary = summarizeMarket(key, priorGames);
  if (!summary || summary.games < PROJECTION_SETTINGS.minGames) return undefined;

  // Recency-weighted form: the latest game counts 1, one game earlier 0.79, three earlier 0.5...
  const values = summary.log.map((g) => g.value);
  const decay = Math.pow(0.5, 1 / PROJECTION_SETTINGS.halfLifeGames);
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    const w = Math.pow(decay, values.length - 1 - i);
    num += w * v;
    den += w;
  });
  const pm = ctx.positionMean.get(`${positionGroup(position)}|${key}`);
  const prior = pm && pm.n ? pm.sum / pm.n : num / den;
  const k = PROJECTION_SETTINGS.positionPriorGames;
  const form = (num + k * prior) / (den + k);

  const defense = defenseFactor(ctx, opponent, position, key);
  const script = scriptMultiplier(key, teamScriptRatio);
  const projected = Math.max(0, form * defense * script);
  const range = computeRange(market.kind, projected);
  return {
    projected: Math.round(projected * 10) / 10,
    lower: range.lower,
    upper: range.upper,
    form: Math.round(form * 10) / 10,
    defense: Math.round(defense * 100) / 100,
    script: Math.round(script * 100) / 100,
    games: summary.games,
  };
}

/* ---------------- accuracy (walk-forward) ---------------- */

export interface BacktestPoint {
  week: number;
  opponent: string;
  projected: number;
  lower: number;
  upper: number;
  actual: number;
}

export interface AccuracySummary {
  n: number;
  /** Share of actual results inside the projected range, 0–100. */
  inRangePct: number | null;
  /** Average absolute miss, in the stat's units. */
  mae: number | null;
  /** Share of results above the projection, 0–100 (≈50 means no lean high or low). */
  overPct: number | null;
}

export function summarizeAccuracy(points: BacktestPoint[]): AccuracySummary {
  if (!points.length) return { n: 0, inRangePct: null, mae: null, overPct: null };
  const inside = points.filter((p) => p.actual >= p.lower && p.actual <= p.upper).length;
  const over = points.filter((p) => p.actual > p.projected).length;
  const mae = points.reduce((s, p) => s + Math.abs(p.actual - p.projected), 0) / points.length;
  return {
    n: points.length,
    inRangePct: Math.round((inside / points.length) * 1000) / 10,
    mae: Math.round(mae * 10) / 10,
    overPct: Math.round((over / points.length) * 1000) / 10,
  };
}

/**
 * Re-runs the projection for each of the player's earlier games, using only what was known before
 * that game, and compares it with what actually happened.
 */
export function backtestStat(
  key: string,
  position: string,
  games: PlayerGameInput[],
  contextFor: (week: number) => WeekContext,
  scriptFor: (game: PlayerGameInput) => number,
  beforeWeek: number,
): BacktestPoint[] {
  const points: BacktestPoint[] = [];
  const ordered = [...games].filter((g) => g.week < beforeWeek).sort((a, b) => a.week - b.week);
  for (const game of ordered) {
    const actualSummary = summarizeMarket(key, [game]);
    if (!actualSummary) continue; // he didn't record this stat that game
    const prior = ordered.filter((g) => g.week < game.week);
    const p = projectStat(
      key,
      position,
      prior,
      contextFor(game.week),
      game.opponent,
      scriptFor(game),
    );
    if (!p) continue;
    points.push({
      week: game.week,
      opponent: game.opponent,
      projected: p.projected,
      lower: p.lower,
      upper: p.upper,
      actual: actualSummary.log[0].value,
    });
  }
  return points;
}

/* ---------------- shapes shared by the server and the page ---------------- */

export interface PlayerStatModel {
  /** Projection for this game; missing when the player hasn't enough earlier games in the stat. */
  projection?: StatProjection;
  /** How the model did on this player's earlier games in this stat. */
  accuracy: AccuracySummary;
  history: BacktestPoint[];
}

export interface GamePropProjections {
  week: number;
  modelVersion: string;
  /** By player id, then prop key. */
  players: Record<string, Record<string, PlayerStatModel>>;
  /** Season accuracy across every player and stat on this page. */
  accuracy: {
    overall: AccuracySummary;
    byCategory: Partial<Record<PropCategory, AccuracySummary>>;
  };
}
