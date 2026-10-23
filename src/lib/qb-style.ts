/**
 * Quarterback styles: pocket passer, scrambler or dual-threat, from each QB's recent starts.
 *
 * - Pocket passer: under 15 rushing yards a game.
 * - Mobile (20+ rushing yards a game): dual-threat if his passing EPA per dropback is at or above
 *   last season's median starter, scrambler if below.
 * - 15–20 yards: in between (no label used by the model).
 *
 * Walk-forward: a game uses only the QB's starts before its week (his last 16, at least 6), and
 * last season's median, so nothing from the game itself or later leaks in.
 *
 * Why it matters: a scrambler's team facing a pocket passer's team has covered the spread about
 * 53% of the time since 2000 (found on 2016–2026, confirmed on 2000–2015).
 *
 * Pure functions (browser- and server-safe).
 */

/** [season, week, playerId, rushingYards, passingEpa, dropbacks] */
export type QbGameRow = [number, number, string, number, number, number];

export type QbStyle = "pocket" | "scrambler" | "dual" | "between";

export const QB_STYLE_SETTINGS = {
  pocketMaxRushYds: 15,
  mobileMinRushYds: 20,
  lookbackStarts: 16,
  minStarts: 6,
} as const;

export const QB_STYLE_LABEL: Record<QbStyle, string> = {
  pocket: "pocket passer",
  scrambler: "scrambler",
  dual: "dual-threat",
  between: "in between",
};

const key = (season: number, week: number) => season * 100 + week;

export interface QbStyleProfile {
  style: QbStyle;
  /** Quarterback's name, when known. */
  name?: string;
  rushYdsPerGame: number;
  epaPerDropback: number;
}

/**
 * Builds the style lookup. `starts` = every QB game row; `isStart` optionally keeps only real
 * starts (e.g. from each game's listed starting QBs), dropping relief appearances.
 */
export function buildQbStyles(
  rows: QbGameRow[],
  isStart: (season: number, week: number, qb: string) => boolean = () => true,
) {
  const byQb = new Map<string, QbGameRow[]>();
  for (const r of [...rows].sort((a, b) => key(a[0], a[1]) - key(b[0], b[1]))) {
    if (!isStart(r[0], r[1], r[2])) continue;
    const list = byQb.get(r[2]) ?? [];
    list.push(r);
    byQb.set(r[2], list);
  }

  function profileOf(qb: string, season: number, week: number) {
    const k = key(season, week);
    const before = (byQb.get(qb) ?? []).filter((r) => key(r[0], r[1]) < k);
    const last = before.slice(-QB_STYLE_SETTINGS.lookbackStarts);
    if (last.length < QB_STYLE_SETTINGS.minStarts) return undefined;
    const rush = last.reduce((s, r) => s + r[3], 0) / last.length;
    const db = last.reduce((s, r) => s + r[5], 0);
    const epa = last.reduce((s, r) => s + r[4], 0) / Math.max(1, db);
    return { rush, epa };
  }

  // Median passing EPA per dropback of profiled starters, by season (each start's profile as of
  // that start). A season's games compare against the previous season's median.
  const medians = new Map<number, number>();
  const medianFor = (season: number) => {
    if (medians.has(season)) return medians.get(season)!;
    const values: number[] = [];
    for (const list of byQb.values())
      for (const r of list) {
        if (r[0] !== season) continue;
        const p = profileOf(r[2], r[0], r[1]);
        if (p) values.push(p.epa);
      }
    values.sort((a, b) => a - b);
    const m = values.length ? values[Math.floor(values.length / 2)] : 0;
    medians.set(season, m);
    return m;
  };

  /** A quarterback's style going into a game, or undefined without enough starts. */
  return function styleOf(
    qb: string | null | undefined,
    season: number,
    week: number,
  ): QbStyleProfile | undefined {
    if (!qb) return undefined;
    const p = profileOf(qb, season, week);
    if (!p) return undefined;
    const S = QB_STYLE_SETTINGS;
    const style: QbStyle =
      p.rush < S.pocketMaxRushYds
        ? "pocket"
        : p.rush >= S.mobileMinRushYds
          ? p.epa >= medianFor(season - 1)
            ? "dual"
            : "scrambler"
          : "between";
    return { style, rushYdsPerGame: p.rush, epaPerDropback: p.epa };
  };
}

export type QbStyleLookup = ReturnType<typeof buildQbStyles>;
