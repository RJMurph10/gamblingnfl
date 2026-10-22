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

/* ---------------- settings (tune here) ---------------- */

export const MODEL_SETTINGS = {
  version: "gnfl-anchored-v3",
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
   * Bets are judged on the market-anchored line (market + learned weight × model disagreement).
   * Spread pick when that line is at least this many points off the market...
   */
  spreadEdgePts: 1.5,
  /** ...total pick when the anchored total is this many points off the market total... */
  totalEdgePts: 1.5,
  /** ...moneyline pick when the anchored win probability beats the no-vig price by this much. */
  moneylineEdgeProb: 0.03,
  /**
   * How much evidence (in games) the learned market weight needs before it moves off zero. Until
   * the model's disagreements have actually predicted results, it trusts the market.
   */
  calibrationPriorGames: 40,
  /** Typical squared disagreement (points²) used to scale that evidence. */
  calibrationScale: 16,
  /** Limit on the learned scoring bias for totals (points). */
  maxTotalBias: 2.5,
  /** Skip moneylines longer than this either way (no +400 long shots or -400 favorites). */
  moneylineMaxOdds: 250,
  /**
   * Credibility guardrails. A moneyline pick must be the team the model expects to WIN (no
   * "the price is nice but they probably lose" underdog bets). And when the model disagrees with
   * the market by more than these amounts it is almost certainly missing news (an injury, a QB
   * change), so it passes instead of betting the long shot.
   */
  moneylineMinWinProb: 0.5,
  maxSpreadDisagreementPts: 7,
  maxTotalDisagreementPts: 8,
  maxMoneylineDisagreementProb: 0.15,
  /** Standard deviation of NFL final margins, used for win probability. */
  marginSd: 13.5,
  /** Price used when ESPN lists no price for a spread or total. */
  defaultPrice: -110,
  /** Flat stake per pick, in units. */
  stake: 1,
} as const;

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
export function fitRatings(finals: Game[], prior: PriorResult[] = []): TeamRatings {
  const obs: PointsObs[] = [];
  const games: Record<string, number> = {};
  const currentGames: Record<string, number> = {};
  const add = (
    homeId: string,
    awayId: string,
    homePts: number,
    awayPts: number,
    weight: number,
  ) => {
    obs.push({ team: homeId, opp: awayId, home: 0.5, points: homePts, weight });
    obs.push({ team: awayId, opp: homeId, home: -0.5, points: awayPts, weight });
    games[homeId] = (games[homeId] ?? 0) + weight;
    games[awayId] = (games[awayId] ?? 0) + weight;
  };
  for (const g of finals) {
    const s = gameScore(g);
    add(g.homeTeamId, g.awayTeamId, s.home, s.away, 1);
    currentGames[g.homeTeamId] = (currentGames[g.homeTeamId] ?? 0) + 1;
    currentGames[g.awayTeamId] = (currentGames[g.awayTeamId] ?? 0) + 1;
  }
  for (const r of prior) {
    if (!Number.isFinite(r.homeScore) || !Number.isFinite(r.awayScore)) continue;
    add(r.homeTeamId, r.awayTeamId, r.homeScore, r.awayScore, MODEL_SETTINGS.priorSeasonWeight);
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
      homeField: MODEL_SETTINGS.homeFieldPrior,
      offense,
      defense,
      games,
      currentGames,
    };

  const totalWeight = obs.reduce((sum, o) => sum + o.weight, 0);
  let mean = obs.reduce((sum, o) => sum + o.weight * o.points, 0) / totalWeight;
  let homeField: number = MODEL_SETTINGS.homeFieldPrior;
  const lambda = MODEL_SETTINGS.shrinkGames;
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
    const priorWeight = MODEL_SETTINGS.homeFieldPriorGames * 0.5;
    let hfNum = MODEL_SETTINGS.homeFieldPrior * priorWeight;
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

export function predictGame(r: TeamRatings, homeId: string, awayId: string): GamePrediction {
  const homePoints = r.mean + r.homeField / 2 + (r.offense[homeId] ?? 0) + (r.defense[awayId] ?? 0);
  const awayPoints = r.mean - r.homeField / 2 + (r.offense[awayId] ?? 0) + (r.defense[homeId] ?? 0);
  const margin = homePoints - awayPoints;
  return {
    homePoints,
    awayPoints,
    homeLine: -margin,
    total: homePoints + awayPoints,
    homeWinProb: normalCdf(margin / MODEL_SETTINGS.marginSd),
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
  odds: number;
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
  picks: ModelPick[];
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
  if (margin > 0) return { ...pick, result: "win", units: stake * payout(pick.odds) };
  if (margin < 0) return { ...pick, result: "loss", units: -stake };
  return { ...pick, result: "push", units: 0 };
}

/** Model picks for one game given a prediction and the market. */
export function picksForGame(game: Game, p: GamePrediction, raw: GamePrediction = p): ModelPick[] {
  const picks: ModelPick[] = [];
  const base = { gameId: game.id, week: game.week };
  const odds = game.odds ?? {};

  const mLine = homeLine(game);
  if (mLine !== null) {
    // Positive edge -> the home side is the value (model expects home to do better than the line).
    const edge = mLine - p.homeLine;
    // The sanity cap looks at the model's own disagreement: a huge gap means missing news.
    if (
      Math.abs(edge) >= MODEL_SETTINGS.spreadEdgePts &&
      Math.abs(mLine - raw.homeLine) <= MODEL_SETTINGS.maxSpreadDisagreementPts
    ) {
      const side = edge > 0 ? "home" : "away";
      picks.push(
        grade(
          {
            ...base,
            market: "spread",
            side,
            line: side === "home" ? mLine : -mLine,
            odds:
              (side === "home" ? odds.homeSpreadOdds : odds.awaySpreadOdds) ??
              MODEL_SETTINGS.defaultPrice,
            edge: Math.abs(edge),
          },
          game,
        ),
      );
    }
  }

  if (game.total > 0) {
    const edge = p.total - game.total;
    if (
      Math.abs(edge) >= MODEL_SETTINGS.totalEdgePts &&
      Math.abs(raw.total - game.total) <= MODEL_SETTINGS.maxTotalDisagreementPts
    ) {
      const side = edge > 0 ? "over" : "under";
      picks.push(
        grade(
          {
            ...base,
            market: "total",
            side,
            line: game.total,
            odds: (side === "over" ? odds.overOdds : odds.underOdds) ?? MODEL_SETTINGS.defaultPrice,
            edge: Math.abs(edge),
          },
          game,
        ),
      );
    }
  }

  if (odds.homeMoneyline !== undefined && odds.awayMoneyline !== undefined) {
    // Remove the bookmaker's margin so the two implied probabilities add to 1.
    const ih = impliedProb(odds.homeMoneyline);
    const ia = impliedProb(odds.awayMoneyline);
    const fairHome = ih / (ih + ia);
    const homeEdge = p.homeWinProb - fairHome;
    if (
      Math.abs(homeEdge) >= MODEL_SETTINGS.moneylineEdgeProb &&
      Math.abs(raw.homeWinProb - fairHome) <= MODEL_SETTINGS.maxMoneylineDisagreementProb
    ) {
      const side = homeEdge > 0 ? "home" : "away";
      const price = side === "home" ? odds.homeMoneyline : odds.awayMoneyline;
      const winProb = side === "home" ? p.homeWinProb : 1 - p.homeWinProb;
      // Only back a team on the moneyline if the model expects it to win.
      if (
        Math.abs(price) <= MODEL_SETTINGS.moneylineMaxOdds &&
        winProb > MODEL_SETTINGS.moneylineMinWinProb
      )
        picks.push(
          grade(
            {
              ...base,
              market: "moneyline",
              side,
              odds: side === "home" ? odds.homeMoneyline : odds.awayMoneyline,
              edge: Math.abs(homeEdge),
              modelProb: side === "home" ? p.homeWinProb : 1 - p.homeWinProb,
            },
            game,
          ),
        );
    }
  }
  return picks;
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
  return {
    homePoints: (total + margin) / 2,
    awayPoints: (total - margin) / 2,
    homeLine: -margin,
    total,
    homeWinProb: normalCdf(margin / MODEL_SETTINGS.marginSd),
  };
}

/**
 * Walk-forward run over the whole schedule: predictions, picks and grades for every game. Each
 * week's ratings AND its market calibration use only earlier weeks, so the record is honest.
 */
export function runModel(schedule: Game[], priorSeason: PriorResult[] = []): GameModelRow[] {
  const finals = schedule.filter((g) => g.status === "final");
  const weeks = [...new Set(schedule.map((g) => g.week))].sort((a, b) => a - b);
  const rows: GameModelRow[] = [];
  for (const week of weeks) {
    const ratings = fitRatings(
      finals.filter((g) => g.week < week),
      priorSeason,
    );
    const calibration = calibrateToMarket(rows.filter((r) => r.game.week < week));
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
          picks: [],
          skipped: "Not enough games played yet",
        });
        continue;
      }
      const modelPrediction = predictGame(ratings, game.homeTeamId, game.awayTeamId);
      const prediction = anchorToMarket(game, modelPrediction, calibration);
      // Live games keep their pregame picks but aren't graded until final.
      rows.push({
        game,
        prediction,
        modelPrediction,
        calibration,
        marketHomeLine,
        marketTotal,
        picks: picksForGame(game, prediction, modelPrediction),
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

export function summarizeModel(rows: GameModelRow[]): ModelSummary {
  const picks = rows.flatMap((r) => r.picks);
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
