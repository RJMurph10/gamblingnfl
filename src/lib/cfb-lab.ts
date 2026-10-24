/**
 * The college model lab: runs the every-game model several ways on the same finished games, so
 * each change can be judged on the numbers before it stays. Everything is walk-forward (a week
 * is predicted only from earlier weeks), so a variant's record is what it would have done live.
 *
 * Pure functions (browser- and server-safe).
 */

import { gameScore, type Game } from "@/data/games";
import { CFB_CONFIG } from "./cfb-model";
import {
  NFL_CONFIG,
  runModel,
  summarizeModel,
  type GameModelRow,
  type MarketRecord,
  type ModelConfig,
  type PriorResult,
} from "./game-model";

export interface LabVariant {
  id: string;
  label: string;
  note: string;
  config: ModelConfig;
  /** Uses last season's results (the other variants start the year from nothing). */
  usesPrior: boolean;
}

/** The old settings first, then each change on its own, then all of them together. */
export const LAB_VARIANTS: LabVariant[] = [
  {
    id: "old",
    label: "Old (NFL settings)",
    note: "What the college model ran on before",
    config: NFL_CONFIG,
    usesPrior: false,
  },
  {
    id: "constants",
    label: "+ College constants",
    note: "Margin SD 17, home field 2.5, neutral sites",
    config: {
      ...NFL_CONFIG,
      marginSd: CFB_CONFIG.marginSd,
      homeFieldPrior: CFB_CONFIG.homeFieldPrior,
      neutralSites: true,
    },
    usesPrior: false,
  },
  {
    id: "blowouts",
    label: "+ Blowout cap & FCS",
    note: "Margins capped at 28, FCS games count 25%",
    config: { ...NFL_CONFIG, marginCap: CFB_CONFIG.marginCap, fcsWeight: CFB_CONFIG.fcsWeight },
    usesPrior: false,
  },
  {
    id: "prior",
    label: "+ Last season",
    note: "Ratings start from last year's results",
    config: NFL_CONFIG,
    usesPrior: true,
  },
  {
    id: "all",
    label: "All changes",
    note: "What the model page runs now",
    config: CFB_CONFIG,
    usesPrior: true,
  },
];

export interface LabRow {
  variant: LabVariant;
  games: number;
  /** Average miss of the model's own margin / total, in points (lower is better). */
  marginMae: number;
  totalMae: number;
  /** Average miss of the anchored line the picks use. */
  anchoredMae: number;
  /** Brier score of the win probability (lower is better; 0.25 = coin flip). */
  brier: number;
  spread: MarketRecord;
  total: MarketRecord;
  winner: MarketRecord;
  units: number;
}

export interface LabResult {
  rows: LabRow[];
  /** The market's own average miss on the same games: the bar to beat. */
  marketMarginMae: number;
  marketTotalMae: number;
  /** Games every variant predicted (the fair comparison set). */
  common: number;
  /** The model's disagreement with the line, bucketed (all-changes variant, raw ratings). */
  edgeBuckets: EdgeBucket[];
}

export interface EdgeBucket {
  market: "spread" | "total";
  minEdge: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number | null;
  units: number;
}

const WIN = 100 / 110;

function mae(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length : 0;
}

/** Runs every variant and scores it on the games they all predicted. */
export function runLab(games: Game[], prior: PriorResult[]): LabResult | null {
  const runs = LAB_VARIANTS.map((variant) => ({
    variant,
    rows: runModel(
      games,
      variant.usesPrior ? prior : [],
      [],
      undefined,
      undefined,
      undefined,
      false,
      variant.config,
    ),
  }));
  const usable = (r: GameModelRow) =>
    r.game.status === "final" &&
    !r.game.fcs &&
    r.modelPrediction !== undefined &&
    r.prediction !== undefined &&
    r.marketHomeLine !== null &&
    r.marketTotal !== null;
  // Only games every variant could predict, so one variant isn't judged on easier games.
  const ids = runs
    .map((run) => new Set(run.rows.filter(usable).map((r) => r.game.id)))
    .reduce((a, b) => new Set([...a].filter((id) => b.has(id))));
  if (ids.size === 0) return null;

  const rows: LabRow[] = runs.map(({ variant, rows: all }) => {
    const set = all.filter((r) => ids.has(r.game.id));
    const marginErr: number[] = [];
    const totalErr: number[] = [];
    const anchoredErr: number[] = [];
    let brier = 0;
    for (const r of set) {
      const s = gameScore(r.game);
      const actual = s.home - s.away;
      marginErr.push(actual - -r.modelPrediction!.homeLine);
      totalErr.push(s.home + s.away - r.modelPrediction!.total);
      anchoredErr.push(actual - -r.prediction!.homeLine);
      const homeWon = actual > 0 ? 1 : actual < 0 ? 0 : 0.5;
      brier += (r.prediction!.homeWinProb - homeWon) ** 2;
    }
    const summary = summarizeModel(set, "predictions");
    return {
      variant,
      games: set.length,
      marginMae: mae(marginErr),
      totalMae: mae(totalErr),
      anchoredMae: mae(anchoredErr),
      brier: set.length ? brier / set.length : 0,
      spread: summary.byMarket.spread,
      total: summary.byMarket.total,
      winner: summary.byMarket.moneyline,
      units: summary.overall.units,
    };
  });

  const base = runs[runs.length - 1].rows.filter((r) => ids.has(r.game.id));
  const marketMargin: number[] = [];
  const marketTotal: number[] = [];
  for (const r of base) {
    const s = gameScore(r.game);
    marketMargin.push(s.home - s.away - -r.marketHomeLine!);
    marketTotal.push(s.home + s.away - r.marketTotal!);
  }

  const buckets: EdgeBucket[] = [];
  for (const market of ["spread", "total"] as const) {
    for (const minEdge of market === "spread" ? [0, 2, 4, 6] : [0, 2, 4, 6]) {
      let wins = 0;
      let losses = 0;
      let pushes = 0;
      for (const r of base) {
        const s = gameScore(r.game);
        const m = r.modelPrediction!;
        let diff: number; // + = the model's side won against the line
        let edge: number;
        if (market === "spread") {
          // Model margin minus market margin: + means the model likes the home team.
          edge = -m.homeLine - -r.marketHomeLine!;
          const homeCover = s.home - s.away + r.marketHomeLine!;
          diff = edge > 0 ? homeCover : -homeCover;
        } else {
          edge = m.total - r.marketTotal!;
          const over = s.home + s.away - r.marketTotal!;
          diff = edge > 0 ? over : -over;
        }
        if (Math.abs(edge) < minEdge || Math.abs(edge) < 1e-9) continue;
        if (diff > 0) wins++;
        else if (diff < 0) losses++;
        else pushes++;
      }
      buckets.push({
        market,
        minEdge,
        wins,
        losses,
        pushes,
        winPct: wins + losses ? (wins / (wins + losses)) * 100 : null,
        units: Math.round((wins * WIN - losses) * 100) / 100,
      });
    }
  }

  return {
    rows,
    marketMarginMae: mae(marketMargin),
    marketTotalMae: mae(marketTotal),
    common: ids.size,
    edgeBuckets: buckets,
  };
}
