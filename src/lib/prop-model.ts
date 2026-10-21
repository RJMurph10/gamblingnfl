/**
 * Offensive player prop definitions, range rules and accuracy helpers.
 *
 * Pure functions only (no React, no server code) so the page and any future model/evaluation
 * job can share them. The UI never calculates projections: it only displays stored ones.
 */

export type PropCategory = "passing" | "rushing" | "receiving" | "receptions" | "other" | "kicking" | "punting";

/** How a statistic behaves, which decides how its projected range is built. */
export type PropStatKind = "yards" | "long" | "count" | "touchdowns";

export interface PropMarketDef {
  /** Stable key stored with each prediction, e.g. "pass_yds". */
  key: string;
  label: string;
  category: PropCategory;
  kind: PropStatKind;
}

export const PROP_CATEGORIES: { key: PropCategory; label: string }[] = [
  { key: "passing", label: "Passing" },
  { key: "rushing", label: "Rushing" },
  { key: "receiving", label: "Receiving" },
  { key: "receptions", label: "Receptions" },
  { key: "other", label: "Other" },
  { key: "kicking", label: "Kicking" },
  { key: "punting", label: "Punting" },
];

export const PROP_MARKETS: PropMarketDef[] = [
  { key: "pass_yds", label: "Passing yards", category: "passing", kind: "yards" },
  { key: "pass_tds", label: "Passing TDs", category: "passing", kind: "touchdowns" },
  { key: "pass_cmp", label: "Pass completions", category: "passing", kind: "count" },
  { key: "pass_att", label: "Pass attempts", category: "passing", kind: "count" },
  { key: "pass_int", label: "Interceptions thrown", category: "passing", kind: "count" },

  { key: "rush_yds", label: "Rushing yards", category: "rushing", kind: "yards" },
  { key: "rush_att", label: "Rushing attempts", category: "rushing", kind: "count" },
  { key: "rush_tds", label: "Rushing TDs", category: "rushing", kind: "touchdowns" },
  { key: "rush_long", label: "Longest rush", category: "rushing", kind: "long" },

  { key: "rec_yds", label: "Receiving yards", category: "receiving", kind: "yards" },
  { key: "rec_tds", label: "Receiving TDs", category: "receiving", kind: "touchdowns" },
  { key: "rec_long", label: "Longest reception", category: "receiving", kind: "long" },

  { key: "receptions", label: "Receptions", category: "receptions", kind: "count" },
  { key: "targets", label: "Receiving targets", category: "receptions", kind: "count" },

  { key: "pass_rush_yds", label: "Passing + rushing yards", category: "other", kind: "yards" },
  { key: "rush_rec_yds", label: "Rushing + receiving yards", category: "other", kind: "yards" },
  { key: "pass_rush_tds", label: "Passing + rushing TDs", category: "other", kind: "touchdowns" },

  { key: "fg_made", label: "Field goals made", category: "kicking", kind: "count" },
  { key: "xp_made", label: "Extra points made", category: "kicking", kind: "count" },
  { key: "kick_pts", label: "Kicking points", category: "kicking", kind: "count" },
  { key: "fg_long", label: "Longest field goal", category: "kicking", kind: "long" },

  { key: "punts", label: "Punts", category: "punting", kind: "count" },
  { key: "punt_yds", label: "Punting yards", category: "punting", kind: "yards" },
  { key: "punt_long", label: "Longest punt", category: "punting", kind: "long" },
];

export const marketByKey = (key: string): PropMarketDef | undefined => PROP_MARKETS.find((m) => m.key === key);

export const marketsForCategory = (category: PropCategory): PropMarketDef[] =>
  PROP_MARKETS.filter((m) => m.category === category);

/** Offensive skill players. */
export const OFFENSIVE_POSITIONS = ["QB", "RB", "FB", "WR", "TE"] as const;

export const isOffensivePosition = (position?: string): boolean =>
  OFFENSIVE_POSITIONS.includes(String(position ?? "").toUpperCase() as (typeof OFFENSIVE_POSITIONS)[number]);

/** Players the props page covers: offensive skill players plus kickers and punters. */
export const PROP_PLAYER_POSITIONS = [...OFFENSIVE_POSITIONS, "K", "P"] as const;

export const isPropPlayerPosition = (position?: string): boolean =>
  PROP_PLAYER_POSITIONS.includes(String(position ?? "").toUpperCase() as (typeof PROP_PLAYER_POSITIONS)[number]);

/* ---------- projected ranges ---------- */

/** Increment this when the range rules change, so saved predictions stay comparable. */
export const RANGE_METHOD = "pct25-v1";

export const RANGE_METHOD_NOTE =
  "Yards and longs: projection ±25%. Counts: ±25% rounded outward to whole numbers. " +
  "Touchdowns: nearest whole number ±1. A range of likely outcomes — not a sportsbook line or a guarantee.";

/** Target share of actual results that should land inside the projected range. */
export const RANGE_COVERAGE_TARGET = 0.75;

export interface ProjectedRange {
  lower: number;
  upper: number;
}

/**
 * Projected range for a central estimate. Never negative; discrete statistics stay whole numbers.
 * Future versions can swap this for empirically calibrated intervals without touching the UI.
 */
export function computeRange(kind: PropStatKind, projected: number): ProjectedRange {
  const p = Number.isFinite(projected) ? Math.max(0, projected) : 0;
  switch (kind) {
    case "yards":
    case "long": {
      const lower = Math.round(p * 0.75);
      return { lower, upper: Math.max(lower, Math.round(p * 1.25)) };
    }
    case "count": {
      const lower = Math.max(0, Math.floor(p * 0.75));
      let upper = Math.ceil(p * 1.25);
      if (p > 0 && upper <= lower) upper = lower + 1;
      return { lower, upper };
    }
    case "touchdowns": {
      const centre = Math.round(p);
      return { lower: Math.max(0, centre - 1), upper: centre + 1 };
    }
  }
}

/** Display text for a projected value: whole yards, one decimal for counts and touchdowns. */
export function formatProjection(kind: PropStatKind, value: number): string {
  if (!Number.isFinite(value)) return "—";
  return kind === "yards" || kind === "long" ? String(Math.round(value)) : value.toFixed(1);
}

/* ---------- accuracy tracking ---------- */

export interface EvaluatedPrediction {
  category: PropCategory;
  projected: number;
  lower: number;
  upper: number;
  actual: number;
}

export function evaluatePrediction(p: { projected: number; lower: number; upper: number }, actual: number) {
  return {
    absError: Math.abs(actual - p.projected),
    inRange: actual >= p.lower && actual <= p.upper,
  };
}

export interface AccuracySummary {
  count: number;
  /** Mean absolute error of the central projection. */
  mae: number | null;
  /** Share of actual results inside the projected range (0–1). */
  coverage: number | null;
}

export function summarizeEvaluations(items: EvaluatedPrediction[]): {
  overall: AccuracySummary;
  byCategory: Partial<Record<PropCategory, AccuracySummary>>;
  coverageTarget: number;
} {
  const summarize = (rows: EvaluatedPrediction[]): AccuracySummary => {
    if (rows.length === 0) return { count: 0, mae: null, coverage: null };
    let errorSum = 0;
    let inside = 0;
    for (const row of rows) {
      const result = evaluatePrediction(row, row.actual);
      errorSum += result.absError;
      if (result.inRange) inside += 1;
    }
    return { count: rows.length, mae: errorSum / rows.length, coverage: inside / rows.length };
  };
  const byCategory: Partial<Record<PropCategory, AccuracySummary>> = {};
  for (const category of PROP_CATEGORIES.map((c) => c.key)) {
    const rows = items.filter((item) => item.category === category);
    if (rows.length > 0) byCategory[category] = summarize(rows);
  }
  return { overall: summarize(items), byCategory, coverageTarget: RANGE_COVERAGE_TARGET };
}
