/**
 * Quarterback ratings for the game model.
 *
 * Every start is scored by the team's passing EPA per dropback that game. A quarterback's rating
 * is the average of his starts (older seasons count less), pulled toward the typical rating of
 * rarely used quarterbacks until he has enough starts. When a team starts someone other than its
 * usual quarterback, the difference between the two ratings moves the model's line.
 *
 * Walk-forward like the rest of the model: a game is adjusted only from starts before its week.
 * Pure functions (browser- and server-safe).
 */

export const QB_SETTINGS = {
  /** Each earlier season's starts count this much of the season after it. */
  seasonDecay: 0.6,
  /** Starts of "rarely used quarterback" average a new or little-used QB is blended with. */
  priorStarts: 12,
  /** Quarterbacks with fewer (weighted) starts than this define that "rarely used" average. */
  lowStartCutoff: 4,
  /** Regular starter: each start counts this much less per team game since (over 2 seasons). */
  usualDecay: 0.93,
  /** Baseline the adjustment is measured from: the team's last starts, newest weighted most. */
  baselineStarts: 8,
  baselineDecay: 0.85,
  /** Points of margin per 1.0 EPA per dropback of quarterback difference. */
  pointsPerEpa: 30,
  /** Largest adjustment for one game (points of margin). */
  maxAdjustment: 7,
} as const;

/** One quarterback start with how his team passed that game. */
export interface QbStart {
  season: number;
  week: number;
  teamId: string;
  qb: string;
  name: string;
  /** Passing EPA per dropback that game; missing when the stats aren't available. */
  epaPerDropback?: number;
}

export interface QbSide {
  name: string;
  /** Points this starter is worth vs the team's usual quarterback (negative = downgrade). */
  points: number;
  /** True when he isn't the team's usual starter. */
  change: boolean;
  /** The regular starter he's replacing (when `change`). */
  regularName?: string;
}

export interface QbAdjustment {
  home?: QbSide;
  away?: QbSide;
  /** Points of home margin added to the model's line (home − away), capped. */
  margin: number;
}

interface WeekRatings {
  rating: (qb: string) => number;
  usual: Map<string, { value: number; qb: string; name: string }>;
}

const key = (season: number, week: number) => season * 100 + week;

/**
 * Builds the QB adjuster from every known start. Ratings for a given week are computed once and
 * cached, from starts before that week only.
 */
export function buildQbRatings(
  starts: QbStart[],
  settings: Partial<Record<keyof typeof QB_SETTINGS, number>> = {},
) {
  const S = { ...QB_SETTINGS, ...settings };
  const sorted = starts
    .filter((s) => s.qb)
    .sort((a, b) => key(a.season, a.week) - key(b.season, b.week));
  const cache = new Map<number, WeekRatings>();

  function ratingsBefore(season: number, week: number): WeekRatings {
    const k = key(season, week);
    const hit = cache.get(k);
    if (hit) return hit;
    const sum = new Map<string, number>();
    const n = new Map<string, number>();
    const recent = new Map<string, QbStart[]>();
    for (const s of sorted) {
      if (key(s.season, s.week) >= k) break;
      if (s.epaPerDropback !== undefined) {
        const w = S.seasonDecay ** (season - s.season);
        sum.set(s.qb, (sum.get(s.qb) ?? 0) + w * s.epaPerDropback);
        n.set(s.qb, (n.get(s.qb) ?? 0) + w);
      }
      if (s.season >= season - 1) {
        const list = recent.get(s.teamId) ?? [];
        list.push(s);
        recent.set(s.teamId, list);
      }
    }
    const lows = [...n.entries()]
      .filter(([, c]) => c > 0 && c < S.lowStartCutoff)
      .map(([qb, c]) => sum.get(qb)! / c);
    const prior = lows.length ? lows.reduce((a, b) => a + b, 0) / lows.length : -0.1;
    const rating = (qb: string) =>
      ((sum.get(qb) ?? 0) + S.priorStarts * prior) / ((n.get(qb) ?? 0) + S.priorStarts);
    // The team's regular starter: most starts over this season and last, each start counting a
    // bit less for every team game since (so a starter returning from a short injury is still
    // the regular, and a backup's spot starts don't make him one). The adjustment is measured
    // against the regular's rating.
    // Offseason moves: once a team has started anyone this season, last season's starts only
    // count for quarterbacks who have also started for it this season (a starter who left in the
    // offseason isn't the regular any more).
    const usual = new Map<string, { value: number; qb: string; name: string }>();
    for (const [team, list] of recent) {
      const thisSeason = new Set(list.filter((s) => s.season === season).map((s) => s.qb));
      const score = new Map<string, number>();
      list.forEach((s, i) => {
        if (thisSeason.size && !thisSeason.has(s.qb)) return;
        const w = S.usualDecay ** (list.length - 1 - i) * (s.season === season ? 1 : 0.5);
        score.set(s.qb, (score.get(s.qb) ?? 0) + w);
      });
      const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!best) continue;
      const regular = best[0];
      // The baseline the adjustment is measured from is what the team has actually been
      // fielding lately (its ratings already reflect those games): its last starts, newest
      // weighted most.
      const last = list.slice(-S.baselineStarts);
      let num = 0;
      let den = 0;
      last.forEach((s, i) => {
        const w = S.baselineDecay ** (last.length - 1 - i);
        num += w * rating(s.qb);
        den += w;
      });
      usual.set(team, {
        value: num / den,
        qb: regular,
        name: [...list].reverse().find((s) => s.qb === regular)?.name ?? "",
      });
    }
    const out = { rating, usual };
    cache.set(k, out);
    return out;
  }

  /** The adjustment for one game, or undefined when neither starter is known. */
  return function adjust(input: {
    season: number;
    week: number;
    homeTeamId: string;
    awayTeamId: string;
    homeQb?: string | null;
    awayQb?: string | null;
    homeQbName?: string | null;
    awayQbName?: string | null;
  }): QbAdjustment | undefined {
    if (!input.homeQb && !input.awayQb) return undefined;
    const r = ratingsBefore(input.season, input.week);
    const side = (team: string, qb?: string | null, name?: string | null): QbSide | undefined => {
      if (!qb) return undefined;
      const usual = r.usual.get(team);
      if (!usual) return { name: name ?? "", points: 0, change: false };
      return {
        name: name ?? "",
        points: S.pointsPerEpa * (r.rating(qb) - usual.value),
        change: usual.qb !== qb,
        regularName: usual.qb !== qb ? usual.name : undefined,
      };
    };
    const home = side(input.homeTeamId, input.homeQb, input.homeQbName);
    const away = side(input.awayTeamId, input.awayQb, input.awayQbName);
    const raw = (home?.points ?? 0) - (away?.points ?? 0);
    const cap = S.maxAdjustment;
    return { home, away, margin: Math.max(-cap, Math.min(cap, raw)) };
  };
}

export type QbAdjuster = ReturnType<typeof buildQbRatings>;
