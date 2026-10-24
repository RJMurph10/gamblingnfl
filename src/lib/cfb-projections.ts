/**
 * College player projections for one game: passing, rushing and receiving medians with an 80%
 * range, and the chance of an anytime touchdown.
 *
 * How (fit on 2023–2024 FBS games, checked on 2025 for yards and on 2024 for touchdowns):
 * - Start from the player's recent games this season (last 8, each older game counting 0.85 as
 *   much as the next), at least 2 games played.
 * - Nudge for the opponent: how much it has allowed per game against the FBS average (passing or
 *   rushing), only partly, because defense explains little week to week.
 * - Scale to the median. Big recent numbers regress, so a projection is the middle outcome: on
 *   2025 games the actual landed over it 46–48% of the time and inside the range 80–83%.
 * - Anytime TD: from recent touchdowns and yards per game; on 2024 games, players given 20–30%
 *   scored 20–29% of the time.
 *
 * Not tested against sportsbook prop lines (there's no archive of past college prop prices), so
 * a projection that differs from a line is information, not a proven edge.
 *
 * Pure functions (browser- and server-safe).
 */

export type ProjStat = "passYds" | "passTd" | "rushYds" | "rushAtt" | "recYds" | "rec";

/** One player's line in one game. */
export interface PlayerGameStats {
  passYds: number;
  passTd: number;
  cmp: number;
  rushYds: number;
  rushAtt: number;
  rushTd: number;
  recYds: number;
  rec: number;
  recTd: number;
}

/** What a defense has allowed per game (passing and rushing), or the FBS average. */
export interface DefenseAllowed {
  passYds: number;
  cmp: number;
  passTd: number;
  rushYds: number;
  rushAtt: number;
}

/** FBS offense per team-game, 2023–2025. */
export const FBS_AVERAGE: DefenseAllowed = {
  passYds: 207.5,
  cmp: 17.5,
  passTd: 1.5,
  rushYds: 163.5,
  rushAtt: 31.5,
};

export const CFB_PROJECTION_SETTINGS = {
  decay: 0.85,
  lookback: 8,
  minGames: 2,
  /** Opponent ratio is capped so one odd game can't swing it. */
  ratioMin: 0.5,
  ratioMax: 1.6,
} as const;

interface StatSetting {
  /** Which defensive number the opponent adjustment uses. */
  defense: keyof DefenseAllowed;
  /** How much of the opponent's difference from average to apply (0–1). */
  weight: number;
  /** Projection = recent average × this (regression to the median). */
  scale: number;
  /** 80% range around the projection (multipliers). */
  low: number;
  high: number;
  /** Players below this recent average aren't projected for the stat. */
  minimum: number;
  label: string;
}

export const STAT_SETTINGS: Record<ProjStat, StatSetting> = {
  passYds: {
    defense: "passYds",
    weight: 0.1,
    scale: 0.981,
    low: 0.296,
    high: 1.662,
    minimum: 120,
    label: "Passing yards",
  },
  passTd: {
    defense: "passTd",
    weight: 0.3,
    scale: 0.879,
    low: 0,
    high: 0,
    minimum: 0.6,
    label: "Passing TDs",
  },
  rushYds: {
    defense: "rushYds",
    weight: 0.4,
    scale: 0.8,
    low: 0.175,
    high: 2.42,
    minimum: 35,
    label: "Rushing yards",
  },
  rushAtt: {
    defense: "rushAtt",
    weight: 0.3,
    scale: 0.931,
    low: 0.364,
    high: 1.766,
    minimum: 8,
    label: "Rushing attempts",
  },
  recYds: {
    defense: "passYds",
    weight: 0.2,
    scale: 0.751,
    low: 0.203,
    high: 2.563,
    minimum: 30,
    label: "Receiving yards",
  },
  rec: {
    defense: "cmp",
    weight: 0.1,
    scale: 0.837,
    low: 0.363,
    high: 2.096,
    minimum: 2.5,
    label: "Receptions",
  },
};

/** Anytime TD: P = 1 − e^−(td × recent TDs + yds100 × recent yards / 100 + base). */
export const ANY_TD = { td: 0.169, yds100: 0.357, base: 0.109, min: 0.01, max: 0.95 } as const;

export interface StatProjection {
  stat: ProjStat;
  /** Median projection (passing TDs: expected count). */
  median: number;
  /** 80% range (none for passing TDs). */
  low?: number;
  high?: number;
}

export interface PlayerProjection {
  playerId: string;
  name: string;
  position: string;
  teamId: string;
  games: number;
  stats: StatProjection[];
  /** Chance of scoring a rushing or receiving touchdown (0–1); absent for passers only. */
  anytimeTd?: number;
}

/** Recency-weighted average of a player's games (oldest first). */
export function recentAverage(games: PlayerGameStats[]): PlayerGameStats | null {
  const S = CFB_PROJECTION_SETTINGS;
  if (games.length < S.minGames) return null;
  const last = games.slice(-S.lookback);
  const keys = Object.keys(last[0]) as (keyof PlayerGameStats)[];
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as unknown as PlayerGameStats;
  let total = 0;
  last.forEach((g, i) => {
    const w = S.decay ** (last.length - 1 - i);
    total += w;
    for (const k of keys) out[k] += (g[k] ?? 0) * w;
  });
  for (const k of keys) out[k] /= total;
  return out;
}

/** A defense's allowed numbers relative to average, capped. */
export function defenseRatio(
  allowed: DefenseAllowed | null,
  key: keyof DefenseAllowed,
  average: DefenseAllowed = FBS_AVERAGE,
): number {
  if (!allowed || !average[key]) return 1;
  const S = CFB_PROJECTION_SETTINGS;
  return Math.min(S.ratioMax, Math.max(S.ratioMin, allowed[key] / average[key]));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Projections for one player, from his games so far and the opponent's defense. */
export function projectPlayer(
  player: { playerId: string; name: string; position: string; teamId: string },
  games: PlayerGameStats[],
  opponentAllowed: DefenseAllowed | null,
): PlayerProjection | null {
  const avg = recentAverage(games);
  if (!avg) return null;
  const stats: StatProjection[] = [];
  for (const stat of Object.keys(STAT_SETTINGS) as ProjStat[]) {
    const s = STAT_SETTINGS[stat];
    const base = avg[stat];
    if (base < s.minimum) continue;
    const raw = base * (1 + s.weight * (defenseRatio(opponentAllowed, s.defense) - 1));
    const median = raw * s.scale;
    stats.push(
      stat === "passTd"
        ? { stat, median: Math.round(median * 100) / 100 }
        : {
            stat,
            median: round1(median),
            low: round1(median * s.low),
            high: round1(median * s.high),
          },
    );
  }
  const touchdowns = avg.rushTd + avg.recTd;
  const yards = avg.rushYds + avg.recYds;
  const scorer = touchdowns > 0 || yards >= 30;
  const anytimeTd = scorer
    ? Math.min(
        ANY_TD.max,
        Math.max(
          ANY_TD.min,
          1 - Math.exp(-(ANY_TD.td * touchdowns + (ANY_TD.yds100 * yards) / 100 + ANY_TD.base)),
        ),
      )
    : undefined;
  if (!stats.length && anytimeTd === undefined) return null;
  return { ...player, games: games.length, stats, anytimeTd };
}

/** American odds → implied probability (0–1). */
export function impliedProbability(odds: string | number | undefined): number | null {
  const n = typeof odds === "number" ? odds : Number(String(odds ?? "").replace(/^\+/, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

/** Probability → fair American odds ("+250", "-130"). */
export function fairOdds(p: number): string {
  if (p <= 0 || p >= 1) return "—";
  return p >= 0.5 ? `${Math.round((-100 * p) / (1 - p))}` : `+${Math.round((100 * (1 - p)) / p)}`;
}

/** The sportsbook market name for a projected stat (as the prop feed labels it). */
export const MARKET_FOR_STAT: Record<ProjStat, string> = {
  passYds: "Passing Yards",
  passTd: "Passing TDs",
  rushYds: "Rushing Yards",
  rushAtt: "Rushing Attempts",
  recYds: "Receiving Yards",
  rec: "Receptions",
};
