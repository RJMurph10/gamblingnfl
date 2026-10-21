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
  version: "gnfl-ratings-v1",
  /** Ridge shrinkage on team ratings, in "games of average play". Higher = more cautious early. */
  shrinkGames: 4,
  /** Home-field prior (points of margin) and how many games of evidence it is worth. */
  homeFieldPrior: 1.5,
  homeFieldPriorGames: 40,
  /** Both teams need this many finished games before the model makes picks for them. */
  minGamesPerTeam: 2,
  /** Spread pick when the model line differs from the market by at least this many points. */
  spreadEdgePts: 2.5,
  /** Total pick when the model total differs from the market total by at least this many points. */
  totalEdgePts: 3,
  /** Moneyline pick when the model's win probability beats the no-vig price by this much (0–1). */
  moneylineEdgeProb: 0.05,
  /** Skip moneylines longer than this either way (no +400 long shots or -400 favorites). */
  moneylineMaxOdds: 250,
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
  /** Finished games per team in the fit. */
  games: Record<string, number>;
}

interface PointsObs {
  team: string;
  opp: string;
  /** +0.5 for the home team's points, -0.5 for the away team's, 0 at a neutral site. */
  home: number;
  points: number;
}

/**
 * Fits offense / defense ratings to final scores by ridge regression:
 * points = mean + homeField * home + offense[team] + defense[opponent].
 */
export function fitRatings(finals: Game[]): TeamRatings {
  const obs: PointsObs[] = [];
  const games: Record<string, number> = {};
  for (const g of finals) {
    const s = gameScore(g);
    obs.push({ team: g.homeTeamId, opp: g.awayTeamId, home: 0.5, points: s.home });
    obs.push({ team: g.awayTeamId, opp: g.homeTeamId, home: -0.5, points: s.away });
    games[g.homeTeamId] = (games[g.homeTeamId] ?? 0) + 1;
    games[g.awayTeamId] = (games[g.awayTeamId] ?? 0) + 1;
  }
  const offense: Record<string, number> = {};
  const defense: Record<string, number> = {};
  for (const id of Object.keys(games)) {
    offense[id] = 0;
    defense[id] = 0;
  }
  if (obs.length === 0)
    return { mean: 22, homeField: MODEL_SETTINGS.homeFieldPrior, offense, defense, games };

  let mean = obs.reduce((sum, o) => sum + o.points, 0) / obs.length;
  let homeField: number = MODEL_SETTINGS.homeFieldPrior;
  const lambda = MODEL_SETTINGS.shrinkGames;
  const predict = (o: PointsObs) => mean + homeField * o.home + offense[o.team] + defense[o.opp];

  for (let iter = 0; iter < 60; iter++) {
    // Offense
    const offSum: Record<string, number> = {};
    const defSum: Record<string, number> = {};
    for (const o of obs)
      offSum[o.team] = (offSum[o.team] ?? 0) + (o.points - predict(o) + offense[o.team]);
    for (const id of Object.keys(offense))
      offense[id] = (offSum[id] ?? 0) / ((games[id] ?? 0) + lambda);
    // Defense
    for (const o of obs)
      defSum[o.opp] = (defSum[o.opp] ?? 0) + (o.points - predict(o) + defense[o.opp]);
    for (const id of Object.keys(defense))
      defense[id] = (defSum[id] ?? 0) / ((games[id] ?? 0) + lambda);
    // Home field, pulled toward its prior: each game's margin carries it once (0.5 + 0.5).
    // Each game contributes 0.5 to the denominator (two observations at ±0.5).
    const priorWeight = MODEL_SETTINGS.homeFieldPriorGames * 0.5;
    let hfNum = MODEL_SETTINGS.homeFieldPrior * priorWeight;
    let hfDen: number = priorWeight;
    for (const o of obs) {
      if (o.home === 0) continue;
      const resid = o.points - (mean + offense[o.team] + defense[o.opp]);
      hfNum += resid * o.home;
      hfDen += o.home * o.home;
    }
    homeField = hfNum / hfDen;
    // League mean
    mean =
      obs.reduce(
        (sum, o) => sum + (o.points - homeField * o.home - offense[o.team] - defense[o.opp]),
        0,
      ) / obs.length;
  }
  return { mean, homeField, offense, defense, games };
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

export interface GameModelRow {
  game: Game;
  prediction?: GamePrediction;
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
export function picksForGame(game: Game, p: GamePrediction): ModelPick[] {
  const picks: ModelPick[] = [];
  const base = { gameId: game.id, week: game.week };
  const odds = game.odds ?? {};

  const mLine = homeLine(game);
  if (mLine !== null) {
    // Positive edge -> the home side is the value (model expects home to do better than the line).
    const edge = mLine - p.homeLine;
    if (Math.abs(edge) >= MODEL_SETTINGS.spreadEdgePts) {
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
    if (Math.abs(edge) >= MODEL_SETTINGS.totalEdgePts) {
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
    if (Math.abs(homeEdge) >= MODEL_SETTINGS.moneylineEdgeProb) {
      const side = homeEdge > 0 ? "home" : "away";
      const price = side === "home" ? odds.homeMoneyline : odds.awayMoneyline;
      if (Math.abs(price) <= MODEL_SETTINGS.moneylineMaxOdds)
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

/** Walk-forward run over the whole schedule: predictions, picks and grades for every game. */
export function runModel(schedule: Game[]): GameModelRow[] {
  const finals = schedule.filter((g) => g.status === "final");
  const weeks = [...new Set(schedule.map((g) => g.week))].sort((a, b) => a - b);
  const rows: GameModelRow[] = [];
  for (const week of weeks) {
    const ratings = fitRatings(finals.filter((g) => g.week < week));
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
      const prediction = predictGame(ratings, game.homeTeamId, game.awayTeamId);
      // Live games keep their pregame picks but aren't graded until final.
      rows.push({
        game,
        prediction,
        marketHomeLine,
        marketTotal,
        picks: picksForGame(game, prediction),
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
