/**
 * Server-only: reads SAVED player prop predictions for one game from Supabase.
 *
 * This file only reads. Predictions are written once, before kickoff, by the model job
 * (see supabase/migrations/20261020_player_prop_predictions.sql); the site never computes or
 * edits them. When nothing is saved the page says so instead of showing made-up numbers.
 */

export interface StoredPropPrediction {
  id: string;
  gameId: string;
  /** ESPN athlete id, matching the roster / player page ids used across the site. */
  playerId: string;
  playerName?: string;
  teamAbbr?: string;
  position?: string;
  /** Key from prop-model's PROP_MARKETS, e.g. "rush_yds". */
  stat: string;
  projected: number;
  lower: number;
  upper: number;
  rangeMethod: string;
  modelVersion: string;
  /** When the prediction was saved (locked). */
  createdAt: string;
  /** Filled in after the game, when real stats are available. */
  actual?: number | null;
  absError?: number | null;
  inRange?: boolean | null;
}

export interface GamePropPredictions {
  /**
   * ready: predictions exist · empty: table reachable but nothing saved for this game ·
   * not_configured: no database connection on the server · error: the request failed
   */
  status: "ready" | "empty" | "not_configured" | "error";
  predictions: StoredPropPrediction[];
  message?: string;
}

const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) ? n : undefined;
};

export async function fetchGamePropPredictions(gameId: string): Promise<GamePropPredictions> {
  const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key =
    env.SUPABASE_PUBLISHABLE_KEY ??
    env.SUPABASE_ANON_KEY ??
    env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return {
      status: "not_configured",
      predictions: [],
      message: "The projections database isn't connected to this site yet.",
    };
  }

  try {
    const query = `${url.replace(/\/$/, "")}/rest/v1/player_prop_predictions?game_id=eq.${encodeURIComponent(
      gameId,
    )}&select=*&order=created_at.asc&limit=2000`;
    const res = await fetch(query, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      return {
        status: "error",
        predictions: [],
        message: `The projections database returned an error (${res.status}).`,
      };
    }
    const rows = (await res.json()) as any[];
    const predictions: StoredPropPrediction[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const projected = num(row.projected);
      const lower = num(row.lower_bound);
      const upper = num(row.upper_bound);
      if (!row.player_id || !row.stat || projected === undefined || lower === undefined || upper === undefined) continue;
      predictions.push({
        id: String(row.id),
        gameId: String(row.game_id),
        playerId: String(row.player_id),
        playerName: row.player_name ?? undefined,
        teamAbbr: row.team_abbr ?? undefined,
        position: row.position ?? undefined,
        stat: String(row.stat),
        projected,
        lower,
        upper,
        rangeMethod: String(row.range_method ?? ""),
        modelVersion: String(row.model_version ?? ""),
        createdAt: String(row.created_at ?? ""),
        actual: num(row.actual) ?? null,
        absError: num(row.abs_error) ?? null,
        inRange: typeof row.in_range === "boolean" ? row.in_range : null,
      });
    }
    return predictions.length > 0
      ? { status: "ready", predictions }
      : { status: "empty", predictions: [], message: "No model projections have been saved for this game yet." };
  } catch (error) {
    return {
      status: "error",
      predictions: [],
      message: error instanceof Error ? error.message : "Could not reach the projections database.",
    };
  }
}
