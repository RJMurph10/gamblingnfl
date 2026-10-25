/**
 * GamblingNFL game model: predicts each game's score, turns that into a spread, total and win
 * probability, compares them with the betting line, and makes picks. Every pick is graded at a
 * flat 1 unit against the closing line and price.
 *
 * Walk-forward: a game in week N is predicted only from games finished in weeks before N, so the
 * season record is an honest test of what the model would have picked at the time.
 *
 * Pure functions (browser- and server-safe), no network.
 */

import { gameScore, type Game } from "@/data/games";
import { homeLine } from "./season-pulse";
import type { QbAdjustment } from "./qb-ratings";
import type { QbStyleProfile } from "./qb-style";

/** Kickoff conditions the model uses (dome / closed roof = not outdoor). */
export interface KickoffWeather {
  outdoor: boolean;
  wind: number | null;
  temp: number | null;
}

/* ---------------- settings (tune here) ---------------- */

export const MODEL_SETTINGS = {
  version: "gnfl-anchored-v5",
  /**
   * Last season's games count this much each (vs 1 for this season), so week 1 starts from last
   * year's ratings and this season's results take over as they come in.
   */
  priorSeasonWeight: 0.3,
  /** Ridge shrinkage on team ratings, in "games of average play". Higher = more cautious early. */
  shrinkGames: 4,
  /** Home-field prior (points of margin) and how many games of evidence it is worth. */
  homeFieldPrior: 1.5,
  homeFieldPriorGames: 40,
  /**
   * Both teams need this many finished games before the model makes picks for them. Last season's
   * games count at their reduced weight, so with last season loaded the model can bet from week 1.
   */
  minGamesPerTeam: 2,
  /**
   * How much evidence (in games) the learned market weight needs before it moves off zero. Until
   * the model's disagreements have actually predicted results, it trusts the market.
   */
  calibrationPriorGames: 40,
  /** Typical squared disagreement (points²) used to scale that evidence. */
  calibrationScale: 16,
  /** Limit on the learned scoring bias for totals (points). */
  maxTotalBias: 2.5,
  /** An underdog getting at least this many points is a ★ best bet against the spread. */
  bigUnderdogPts: 7,
  /** Outdoor wind at kickoff (mph) at or above this makes the under a ★ best bet. */
  windUnderMph: 10,
  /** Standard deviation of NFL final margins, used for win probability. */
  marginSd: 13.5,
  /** Spreads and totals are always graded at this standard price; moneylines at their real odds. */
  defaultPrice: -110,
  /** Flat stake per pick, in units. */
  stake: 1,
} as const;

/**
 * The settings that differ between leagues. The NFL runs on NFL_CONFIG (exactly the numbers
 * above); college football passes its own (see CFB_CONFIG in cfb-model.ts).
 */
export interface ModelConfig {
  /** Standard deviation of final margins, used for win probability. */
  marginSd: number;
  /** Home-field prior (points of margin) and how many games of evidence it is worth. */
  homeFieldPrior: number;
  homeFieldPriorGames: number;
  /** Ridge shrinkage on team ratings, in "games of average play". */
  shrinkGames: number;
  /** Weight of each game from last season (vs 1 for this season). */
  priorSeasonWeight: number;
  /** Biggest margin a game counts for in the ratings (a bigger blowout is trimmed). 0 = no cap. */
  marginCap: number;
  /** Weight in the ratings of a game against an FCS team (1 = like any other game). */
  fcsWeight: number;
  /** Neutral-site games have no home field. */
  neutralSites: boolean;
  /**
   * Weight of each finished game's closing line as an extra rating observation (0 = scores only).
   * A line is a far less noisy read on how good two teams are than one score, and it already
   * carries injuries and news. Only lines of games before the one being predicted are used.
   */
  marketWeight: number;
}

export const NFL_CONFIG: ModelConfig = {
  marginSd: MODEL_SETTINGS.marginSd,
  homeFieldPrior: MODEL_SETTINGS.homeFieldPrior,
  homeFieldPriorGames: MODEL_SETTINGS.homeFieldPriorGames,
  shrinkGames: MODEL_SETTINGS.shrinkGames,
  priorSeasonWeight: MODEL_SETTINGS.priorSeasonWeight,
  marginCap: 0,
  fcsWeight: 1,
  neutralSites: false,
  marketWeight: 0,
};

/** Trims a blowout to `cap` points of margin, keeping the game's total. */
function trimMargin(home: number, away: number, cap: number): [number, number] {
  const margin = home - away;
  if (!cap || Math.abs(margin) <= cap) return [home, away];
  const excess = (Math.abs(margin) - cap) / 2;
  return margin > 0 ? [home - excess, away + excess] : [home + excess, away - excess];
}

/* ---------------- ratings ---------------- */

export interface TeamRatings {
  /** League average points per team per game. */
  mean: number;
  /** Home-field advantage in points of margin. */
  homeField: number;
  /** Points a team scores above average (offense), by team id. */
  offense: Record<string, number>;
  /** Points a team allows above average (defense; lower is better), by team id. */
  defense: Record<string, number>;
  /** Finished games per team in the fit (last season's games count at their reduced weight). */
  games: Record<string, number>;
  /** This season's finished games per team. */
  currentGames: Record<string, number>;
}

/** A final score from an earlier season (same team ids as this season). */
export interface PriorResult {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

interface PointsObs {
  team: string;
  opp: string;
  /** +0.5 for the home team's points, -0.5 for the away team's, 0 at a neutral site. */
  home: number;
  points: number;
  weight: number;
}

/**
 * Fits offense / defense ratings to final scores by weighted ridge regression:
 * points = mean + homeField * home + offense[team] + defense[opponent].
 * Last season's results (if given) join at a reduced weight.
 */
export function fitRatings(
  finals: Game[],
  prior: PriorResult[] = [],
  cfg: ModelConfig = NFL_CONFIG,
): TeamRatings {
  const obs: PointsObs[] = [];
  const games: Record<string, number> = {};
  const currentGames: Record<string, number> = {};
  const add = (
    homeId: string,
    awayId: string,
    homePts: number,
    awayPts: number,
    weight: number,
    neutral = false,
  ) => {
    [homePts, awayPts] = trimMargin(homePts, awayPts, cfg.marginCap);
    const side = neutral && cfg.neutralSites ? 0 : 0.5;
    obs.push({ team: homeId, opp: awayId, home: side, points: homePts, weight });
    obs.push({ team: awayId, opp: homeId, home: -side, points: awayPts, weight });
    games[homeId] = (games[homeId] ?? 0) + weight;
    games[awayId] = (games[awayId] ?? 0) + weight;
  };
  for (const g of finals) {
    const s = gameScore(g);
    add(g.homeTeamId, g.awayTeamId, s.home, s.away, g.fcs ? cfg.fcsWeight : 1, Boolean(g.neutralSite));
    currentGames[g.homeTeamId] = (currentGames[g.homeTeamId] ?? 0) + 1;
    currentGames[g.awayTeamId] = (currentGames[g.awayTeamId] ?? 0) + 1;
    if (cfg.marketWeight > 0 && !g.fcs && g.total > 0) {
      // The closing line as if it were a score: the margin and total it implied.
      const line = homeLine(g);
      if (line !== null)
        add(
          g.homeTeamId,
          g.awayTeamId,
          (g.total - line) / 2,
          (g.total + line) / 2,
          cfg.marketWeight,
          Boolean(g.neutralSite),
        );
    }
  }
  for (const r of prior) {
    if (!Number.isFinite(r.homeScore) || !Number.isFinite(r.awayScore)) continue;
    add(r.homeTeamId, r.awayTeamId, r.homeScore, r.awayScore, cfg.priorSeasonWeight);
  }
  const offense: Record<string, number> = {};
  const defense: Record<string, number> = {};
  for (const id of Object.keys(games)) {
    offense[id] = 0;
    defense[id] = 0;
  }
  if (obs.length === 0)
    return {
      mean: 22,
      homeField: cfg.homeFieldPrior,
      offense,
      defense,
      games,
      currentGames,
    };

  const totalWeight = obs.reduce((sum, o) => sum + o.weight, 0);
  let mean = obs.reduce((sum, o) => sum + o.weight * o.points, 0) / totalWeight;
  let homeField: number = cfg.homeFieldPrior;
  const lambda = cfg.shrinkGames;
  const predict = (o: PointsObs) => mean + homeField * o.home + offense[o.team] + defense[o.opp];

  for (let iter = 0; iter < 60; iter++) {
    const offSum: Record<string, number> = {};
    const defSum: Record<string, number> = {};
    for (const o of obs)
      offSum[o.team] = (offSum[o.team] ?? 0) + o.weight * (o.points - predict(o) + offense[o.team]);
    for (const id of Object.keys(offense))
      offense[id] = (offSum[id] ?? 0) / ((games[id] ?? 0) + lambda);
    for (const o of obs)
      defSum[o.opp] = (defSum[o.opp] ?? 0) + o.weight * (o.points - predict(o) + defense[o.opp]);
    for (const id of Object.keys(defense))
      defense[id] = (defSum[id] ?? 0) / ((games[id] ?? 0) + lambda);
    // Home field, pulled toward its prior. Each game contributes 0.5 to the denominator
    // (two observations at ±0.5), times its weight.
    const priorWeight = cfg.homeFieldPriorGames * 0.5;
    let hfNum = cfg.homeFieldPrior * priorWeight;
    let hfDen: number = priorWeight;
    for (const o of obs) {
      if (o.home === 0) continue;
      const resid = o.points - (mean + offense[o.team] + defense[o.opp]);
      hfNum += o.weight * resid * o.home;
      hfDen += o.weight * o.home * o.home;
    }
    homeField = hfNum / hfDen;
    mean =
      obs.reduce(
        (sum, o) =>
          sum + o.weight * (o.points - homeField * o.home - offense[o.team] - defense[o.opp]),
        0,
      ) / totalWeight;
  }
  return { mean, homeField, offense, defense, games, currentGames };
}

/* ---------------- predictions ---------------- */

export interface GamePrediction {
  homePoints: number;
  awayPoints: number;
  /** Model line for the home team, betting convention (-3.5 = home favored by 3.5). */
  homeLine: number;
  total: number;
  homeWinProb: number;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function normalCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function predictGame(
  r: TeamRatings,
  homeId: string,
  awayId: string,
  cfg: ModelConfig = NFL_CONFIG,
  neutral = false,
): GamePrediction {
  const hf = neutral && cfg.neutralSites ? 0 : r.homeField;
  const homePoints = r.mean + hf / 2 + (r.offense[homeId] ?? 0) + (r.defense[awayId] ?? 0);
  const awayPoints = r.mean - hf / 2 + (r.offense[awayId] ?? 0) + (r.defense[homeId] ?? 0);
  const margin = homePoints - awayPoints;
  return {
    homePoints,
    awayPoints,
    homeLine: -margin,
    total: homePoints + awayPoints,
    homeWinProb: normalCdf(margin / cfg.marginSd),
  };
}

/* ---------------- odds helpers ---------------- */

/** Profit in units for a winning 1-unit bet at American odds. */
export const payout = (odds: number) => (odds > 0 ? odds / 100 : 100 / Math.abs(odds));

/** Break-even probability of American odds. */
export const impliedProb = (odds: number) =>
  odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);

/* ---------------- picks ---------------- */

export type Market = "spread" | "total" | "moneyline";
export type PickResult = "win" | "loss" | "push" | "pending";

export interface ModelPick {
  gameId: string;
  week: number;
  market: Market;
  /** "home" / "away" for spread and moneyline, "over" / "under" for totals. */
  side: "home" | "away" | "over" | "under";
  /** The line bet: home-perspective spread for "home", away-perspective for "away", or the total. */
  line?: number;
  /** American odds; missing when ESPN lists no price (record counts, units don't). */
  odds?: number;
  /** ★ Best bet: a 7+ point underdog, the under in 10+ mph wind, or a scrambler vs a pocket passer. */
  best: boolean;
  /** Kickoff wind (mph) behind a wind best bet. */
  wind?: number;
  /** Which rule made it a best bet. */
  reason?: "underdog" | "wind" | "qb-style" | "bounce" | "travel" | "early" | "academy";
  /** Points (spread/total) or probability (moneyline) by which the model beats the market. */
  edge: number;
  /** Model's win probability for moneyline picks. */
  modelProb?: number;
  result: PickResult;
  /** Units won or lost (0 for push / pending). */
  units: number;
}

/**
 * What the model has learned from earlier weeks about its own disagreements with the market:
 * weight 0 = its disagreements haven't predicted anything (trust the market), 1 = fully trust it.
 */
export interface MarketCalibration {
  spreadWeight: number;
  totalWeight: number;
  /** Points games have been finishing above (+) or below (−) the closing totals. */
  totalBias: number;
  /**
   * How much the model's ratings squeeze games toward a tie (or totals toward average) compared
   * with the market: 1.4 means market lines are 40% wider. Its lines are stretched back by this
   * before comparing, so "closer than the market" stops reading as a reason to take the underdog.
   */
  spreadScale: number;
  totalScale: number;
  /** Average closing total, the center the totals scale stretches around. */
  totalCenter: number;
  /** Graded earlier games behind the calibration. */
  samples: number;
}

export interface GameModelRow {
  game: Game;
  /** The line the model bets on: the market, moved by the learned weight toward the model. */
  prediction?: GamePrediction;
  /** The model's own ratings-only prediction, before anchoring to the market. */
  modelPrediction?: GamePrediction;
  calibration?: MarketCalibration;
  /** Why there is no prediction (early season, no line, ...). */
  skipped?: string;
  marketHomeLine: number | null;
  marketTotal: number | null;
  /** The model's call on every market for this game (winner, spread side, over/under). */
  predictions: ModelPick[];
  /** ★ Best bets (7+ point underdogs, unders in 10+ mph wind). */
  picks: ModelPick[];
  /** Starting-quarterback adjustment applied to the model's own line, when starters are known. */
  qb?: QbAdjustment;
  /** Each starting quarterback's style going into the game. */
  styles?: { home?: QbStyleProfile; away?: QbStyleProfile };
  /** College: why a game has a ★ best bet, shown under its picks. */
  ruleNotes?: string[];
}

/** Moves a ratings-only prediction by a quarterback adjustment (points of home margin). */
export function applyQbAdjustment(p: GamePrediction, margin: number): GamePrediction {
  if (!margin) return p;
  const m = -p.homeLine + margin;
  return {
    homePoints: p.homePoints + margin / 2,
    awayPoints: p.awayPoints - margin / 2,
    homeLine: -m,
    total: p.total,
    homeWinProb: normalCdf(m / MODEL_SETTINGS.marginSd),
  };
}

function grade(pick: Omit<ModelPick, "result" | "units">, game: Game): ModelPick {
  if (game.status !== "final") return { ...pick, result: "pending", units: 0 };
  const s = gameScore(game);
  let margin = 0;
  if (pick.market === "spread") {
    // The line is from the picked side's point of view (e.g. away +3.5).
    const sideMargin = pick.side === "home" ? s.home - s.away : s.away - s.home;
    margin = sideMargin + (pick.line ?? 0);
  } else if (pick.market === "total") {
    const diff = s.home + s.away - (pick.line ?? 0);
    margin = pick.side === "over" ? diff : -diff;
  } else {
    margin = pick.side === "home" ? s.home - s.away : s.away - s.home;
  }
  const stake = MODEL_SETTINGS.stake;
  if (pick.odds === undefined)
    return { ...pick, result: margin > 0 ? "win" : margin < 0 ? "loss" : "push", units: 0 };
  if (margin > 0) return { ...pick, result: "win", units: stake * payout(pick.odds) };
  if (margin < 0) return { ...pick, result: "loss", units: -stake };
  return { ...pick, result: "push", units: 0 };
}

/**
 * The model's call on every market for one game: which side covers, over or under, and who wins.
 * `p` is the line the model bets on (market-anchored); `raw` is its own ratings-only view, used
 * to break ties when the anchored line sits exactly on the market and for the sanity caps.
 * Calls with a real edge (and inside the guardrails) are flagged as best bets.
 */
export function predictionsForGame(
  game: Game,
  p: GamePrediction,
  raw: GamePrediction = p,
  /** Kickoff weather (recorded for finished games, forecast for upcoming ones), if known. */
  weather?: KickoffWeather | null,
  /** Each starting quarterback's style going into the game, if known. */
  styles?: { home?: QbStyleProfile; away?: QbStyleProfile },
  /** Apply the NFL ★ best-bet rules (college games have their own, added afterwards). */
  nflRules = true,
): ModelPick[] {
  const out: ModelPick[] = [];
  const base = { gameId: game.id, week: game.week };
  const odds = game.odds ?? {};
  const sign = (x: number) => (x > 1e-9 ? 1 : x < -1e-9 ? -1 : 0);

  const mLine = homeLine(game);
  if (mLine !== null) {
    // Positive edge -> the model expects home to do better than the line.
    const edge = mLine - p.homeLine;
    // ★ Best bets: every underdog getting 7+ points. Big favorites have been overrated in every
    // season since 2022 (162-128 ATS through week 6 of 2026).
    const bigDog = nflRules && Math.abs(mLine) >= MODEL_SETTINGS.bigUnderdogPts;
    // ★ Best bets: a scrambler's team against a pocket passer's team (53% since 2000; found on
    // 2016–2026, confirmed on 2000–2015). The underdog rule wins if the two disagree.
    const hs = styles?.home?.style;
    const as = styles?.away?.style;
    const styleSide =
      !bigDog && hs === "scrambler" && as === "pocket"
        ? 1
        : !bigDog && as === "scrambler" && hs === "pocket"
          ? -1
          : 0;
    const lean = bigDog
      ? mLine > 0
        ? 1
        : -1
      : styleSide || sign(edge) || sign(mLine - raw.homeLine) || (mLine <= 0 ? 1 : -1);
    const side = lean > 0 ? "home" : "away";
    out.push(
      grade(
        {
          ...base,
          market: "spread",
          side,
          line: side === "home" ? mLine : -mLine,
          // Spreads and totals are graded at the standard -110, whatever price was listed.
          odds: MODEL_SETTINGS.defaultPrice,
          edge: Math.abs(edge),
          best: bigDog || styleSide !== 0,
          reason: bigDog ? "underdog" : styleSide ? "qb-style" : undefined,
        },
        game,
      ),
    );
  }

  if (game.total > 0) {
    const edge = p.total - game.total;
    // ★ Best bets: the under in outdoor games with 10+ mph wind at kickoff (469-361 since 2012;
    // chosen on 2012–2021 and confirmed on 2022–2026 games it never saw).
    const windy =
      !!weather?.outdoor && weather.wind !== null && weather.wind >= MODEL_SETTINGS.windUnderMph;
    const lean = windy ? -1 : sign(edge) || sign(raw.total - game.total) || 1;
    out.push(
      grade(
        {
          ...base,
          market: "total",
          side: lean > 0 ? "over" : "under",
          line: game.total,
          odds: MODEL_SETTINGS.defaultPrice,
          edge: Math.abs(edge),
          best: windy,
          reason: windy ? "wind" : undefined,
          wind: windy ? weather!.wind! : undefined,
        },
        game,
      ),
    );
  }

  // Winner: the team the model expects to win (ties go to the market favorite).
  const homeWins =
    p.homeWinProb > 0.5 || (p.homeWinProb === 0.5 && (mLine === null ? true : mLine <= 0));
  const winProb = homeWins ? p.homeWinProb : 1 - p.homeWinProb;
  let edge = 0;
  if (odds.homeMoneyline !== undefined && odds.awayMoneyline !== undefined) {
    // Remove the bookmaker's margin so the two implied probabilities add to 1.
    const ih = impliedProb(odds.homeMoneyline);
    const ia = impliedProb(odds.awayMoneyline);
    const fairHome = ih / (ih + ia);
    edge = winProb - (homeWins ? fairHome : 1 - fairHome);
  }
  out.push(
    grade(
      {
        ...base,
        market: "moneyline",
        side: homeWins ? "home" : "away",
        odds: homeWins ? odds.homeMoneyline : odds.awayMoneyline,
        edge,
        modelProb: winProb,
        best: false,
      },
      game,
    ),
  );
  return out;
}

/** ★ Best bets only (7+ point underdogs, unders in 10+ mph wind, scramblers vs pocket passers). */
export function picksForGame(game: Game, p: GamePrediction, raw: GamePrediction = p): ModelPick[] {
  return predictionsForGame(game, p, raw).filter((pick) => pick.best);
}

/**
 * Learns, from earlier graded games only, how much the model's disagreements with the closing
 * line actually predicted the result (ridge regression toward 0 = "trust the market"), plus how
 * far games have been finishing above or below the totals.
 */
export function calibrateToMarket(history: GameModelRow[]): MarketCalibration {
  const K = MODEL_SETTINGS.calibrationPriorGames * MODEL_SETTINGS.calibrationScale;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const spreads: { model: number; market: number; actual: number }[] = [];
  const totals: { model: number; market: number; actual: number }[] = [];
  for (const row of history) {
    const raw = row.modelPrediction;
    if (!raw || row.game.status !== "final") continue;
    const s = gameScore(row.game);
    if (row.marketHomeLine !== null)
      spreads.push({ model: -raw.homeLine, market: -row.marketHomeLine, actual: s.home - s.away });
    if (row.marketTotal !== null)
      totals.push({ model: raw.total, market: row.marketTotal, actual: s.home + s.away });
  }

  // Compression: how much wider the market's lines are than the model's (shrunk toward 1).
  const scaleOf = (pairs: { model: number; market: number }[], center: number) => {
    let mm = 0;
    let me = 0;
    for (const p of pairs) {
      mm += (p.model - center) ** 2;
      me += (p.model - center) * (p.market - center);
    }
    const prior = MODEL_SETTINGS.calibrationPriorGames * MODEL_SETTINGS.calibrationScale;
    return clamp((me + prior) / (mm + prior), 1, 2.5);
  };
  const spreadScale = scaleOf(spreads, 0);
  const totalCenter = totals.length
    ? totals.reduce((sum, t) => sum + t.market, 0) / totals.length
    : 44;
  const totalScale = scaleOf(totals, totalCenter);

  // Weight: how much the (stretched) disagreement predicted the result, shrunk toward 0.
  let sxy = 0;
  let sxx = 0;
  for (const p of spreads) {
    const x = p.model * spreadScale - p.market;
    sxy += x * (p.actual - p.market);
    sxx += x * x;
  }
  const spreadWeight = clamp(sxy / (sxx + K), 0, 1);

  const bias = clamp(
    totals.reduce((sum, t) => sum + (t.actual - t.market), 0) /
      (totals.length + MODEL_SETTINGS.calibrationPriorGames),
    -MODEL_SETTINGS.maxTotalBias,
    MODEL_SETTINGS.maxTotalBias,
  );
  let txy = 0;
  let txx = 0;
  for (const t of totals) {
    const x = totalCenter + (t.model - totalCenter) * totalScale - t.market;
    txy += x * (t.actual - t.market - bias);
    txx += x * x;
  }
  const totalWeight = clamp(txy / (txx + K), 0, 1);
  return {
    spreadWeight,
    totalWeight,
    totalBias: bias,
    spreadScale,
    totalScale,
    totalCenter,
    samples: Math.max(spreads.length, totals.length),
  };
}

/** The line the model bets on: the market, moved toward the model by the learned weights. */
export function anchorToMarket(
  game: Game,
  raw: GamePrediction,
  cal: MarketCalibration,
  cfg: ModelConfig = NFL_CONFIG,
): GamePrediction {
  const mLine = homeLine(game);
  const marketMargin = mLine === null ? -raw.homeLine : -mLine;
  const weight = mLine === null ? 1 : cal.spreadWeight;
  const stretchedMargin = -raw.homeLine * cal.spreadScale;
  const margin = marketMargin + weight * (stretchedMargin - marketMargin);
  const stretchedTotal = cal.totalCenter + (raw.total - cal.totalCenter) * cal.totalScale;
  const total =
    game.total > 0
      ? game.total + cal.totalBias + cal.totalWeight * (stretchedTotal - game.total)
      : raw.total;
  // Win probability starts from the moneyline market's own (no-vig) price and moves only by as
  // much as the anchored margin moved off the market's. Converting the spread straight into a
  // probability would disagree with the moneyline on its own and invent "edges" from nothing.
  let homeWinProb = normalCdf(margin / cfg.marginSd);
  const ml = game.odds;
  if (ml?.homeMoneyline !== undefined && ml.awayMoneyline !== undefined && mLine !== null) {
    const ih = impliedProb(ml.homeMoneyline);
    const ia = impliedProb(ml.awayMoneyline);
    const fairHome = ih / (ih + ia);
    const shift =
      normalCdf(margin / cfg.marginSd) - normalCdf(marketMargin / cfg.marginSd);
    homeWinProb = Math.min(0.99, Math.max(0.01, fairHome + shift));
  }
  return {
    homePoints: (total + margin) / 2,
    awayPoints: (total - margin) / 2,
    homeLine: -margin,
    total,
    homeWinProb,
  };
}

/**
 * Walk-forward run over the whole schedule: predictions, picks and grades for every game. Each
 * week's ratings AND its market calibration use only earlier weeks, so the record is honest.
 */
export function runModel(
  schedule: Game[],
  priorSeason: PriorResult[] = [],
  /**
   * Graded rows from earlier seasons. They join the market calibration, so the model learns how
   * far to trust itself from hundreds of past games instead of starting from zero every September.
   */
  pastSeasons: GameModelRow[] = [],
  /** Starting-quarterback adjustment for a game (from starts before its week), if known. */
  qbFor?: (game: Game) => QbAdjustment | undefined,
  /** Kickoff weather for a game (recorded or forecast), if known. */
  weatherFor?: (game: Game) => KickoffWeather | null | undefined,
  /** Starting quarterbacks' styles for a game, if known. */
  stylesFor?: (game: Game) => { home?: QbStyleProfile; away?: QbStyleProfile } | undefined,
  /** False for college: every-game calls only, without the NFL ★ best-bet rules. */
  nflRules = true,
  /** League settings (college passes its own); the NFL's by default. */
  cfg: ModelConfig = NFL_CONFIG,
): GameModelRow[] {
  const finals = schedule.filter((g) => g.status === "final");
  const weeks = [...new Set(schedule.map((g) => g.week))].sort((a, b) => a - b);
  const rows: GameModelRow[] = [];
  for (const week of weeks) {
    const ratings = fitRatings(
      finals.filter((g) => g.week < week),
      priorSeason,
      cfg,
    );
    const calibration = calibrateToMarket([
      ...pastSeasons,
      ...rows.filter((r) => r.game.week < week),
    ]);
    for (const game of schedule.filter((g) => g.week === week)) {
      const marketHomeLine = homeLine(game);
      const marketTotal = game.total > 0 ? game.total : null;
      const enough =
        (ratings.games[game.homeTeamId] ?? 0) >= MODEL_SETTINGS.minGamesPerTeam &&
        (ratings.games[game.awayTeamId] ?? 0) >= MODEL_SETTINGS.minGamesPerTeam;
      if (!enough) {
        rows.push({
          game,
          marketHomeLine,
          marketTotal,
          predictions: [],
          picks: [],
          skipped: "Not enough games played yet",
        });
        continue;
      }
      const qb = qbFor?.(game);
      const modelPrediction = applyQbAdjustment(
        predictGame(ratings, game.homeTeamId, game.awayTeamId, cfg, Boolean(game.neutralSite)),
        qb?.margin ?? 0,
      );
      const prediction = anchorToMarket(game, modelPrediction, calibration, cfg);
      // Live games keep their pregame calls but aren't graded until final.
      const styles = stylesFor?.(game);
      const predictions = predictionsForGame(
        game,
        prediction,
        modelPrediction,
        weatherFor?.(game),
        styles,
        nflRules,
      );
      rows.push({
        game,
        prediction,
        modelPrediction,
        qb,
        styles,
        calibration,
        marketHomeLine,
        marketTotal,
        predictions,
        picks: predictions.filter((pick) => pick.best),
      });
    }
  }
  return rows;
}

/* ---------------- record & units ---------------- */

export interface MarketRecord {
  wins: number;
  losses: number;
  pushes: number;
  /** Win % of decided picks (pushes excluded), 0–100, or null with no decided picks. */
  winPct: number | null;
  units: number;
  /** Units per unit risked, %. */
  roi: number | null;
  pending: number;
}

export interface ModelSummary {
  overall: MarketRecord;
  byMarket: Record<Market, MarketRecord>;
  /** Cumulative units after each week with graded picks. */
  unitsByWeek: { week: number; units: number; weekUnits: number }[];
  /** Same figures through the previous week, for week-over-week changes. */
  previous: { overall: MarketRecord; byMarket: Record<Market, MarketRecord> } | null;
}

function record(picks: ModelPick[]): MarketRecord {
  const graded = picks.filter((p) => p.result !== "pending");
  const wins = graded.filter((p) => p.result === "win").length;
  const losses = graded.filter((p) => p.result === "loss").length;
  const pushes = graded.filter((p) => p.result === "push").length;
  const units = graded.reduce((s, p) => s + p.units, 0);
  const risked = (wins + losses) * MODEL_SETTINGS.stake;
  return {
    wins,
    losses,
    pushes,
    winPct: wins + losses ? (wins / (wins + losses)) * 100 : null,
    units: Math.round(units * 100) / 100,
    roi: risked ? (units / risked) * 100 : null,
    pending: picks.length - graded.length,
  };
}

const MARKETS: Market[] = ["spread", "total", "moneyline"];

/**
 * Record and units. "predictions" grades the model's call on every game (the dashboard numbers);
 * "bets" grades only the best bets.
 */
export function summarizeModel(
  rows: GameModelRow[],
  kind: "predictions" | "bets" = "predictions",
): ModelSummary {
  const picks = rows.flatMap((r) => (kind === "bets" ? r.picks : r.predictions));
  const by = (list: ModelPick[]) =>
    Object.fromEntries(
      MARKETS.map((m) => [m, record(list.filter((p) => p.market === m))]),
    ) as Record<Market, MarketRecord>;

  const gradedWeeks = [
    ...new Set(picks.filter((p) => p.result !== "pending").map((p) => p.week)),
  ].sort((a, b) => a - b);
  let running = 0;
  const unitsByWeek = gradedWeeks.map((week) => {
    const weekUnits = picks
      .filter((p) => p.week === week && p.result !== "pending")
      .reduce((s, p) => s + p.units, 0);
    running += weekUnits;
    return {
      week,
      units: Math.round(running * 100) / 100,
      weekUnits: Math.round(weekUnits * 100) / 100,
    };
  });

  const lastWeek = gradedWeeks.at(-1);
  const before = lastWeek === undefined ? [] : picks.filter((p) => p.week < lastWeek);
  return {
    overall: record(picks),
    byMarket: by(picks),
    unitsByWeek,
    previous: gradedWeeks.length > 1 ? { overall: record(before), byMarket: by(before) } : null,
  };
}

/** "+4.35u" / "-1.20u" */
export const unitsText = (u: number) =>
  `${u > 0 ? "+" : u < 0 ? "−" : ""}${Math.abs(u).toFixed(2)}u`;
