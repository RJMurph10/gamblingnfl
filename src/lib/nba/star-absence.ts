/**
 * Star absences for NBA totals. Research (claude/nba-model-audit.md, research/nba/scripts/star_absence.py),
 * 2023-24 to 2025-26 at the DraftKings / ESPN BET opener: ordinary absences don't move totals (bench and
 * role players are replaced), but a 20+ ppg scorer sitting does. For every point of star scoring missing
 * beyond what the team has been playing without lately, the final total came in about 0.09 lower than the
 * opener expected (the line closes only about half of that before tip). With it, ★ totals went 336-223
 * (60.1%) vs 304-212 (58.9%) without, each season's coefficient fit on the other seasons.
 * Pure functions; the star list (nba/stars-<season>.json on props-site) is rebuilt by scripts/picks/nba-stars.mjs.
 */

/** Total points per point of star scoring out (beyond the team's recent normal). */
export const STAR_COEF = -0.09;

export interface StarPlayer {
  id: string;
  name: string;
  /** Points per game over the team's last 15 games (games he played). */
  ppg: number;
  /** Share of the team's last 15 games he missed (what the ratings already reflect). */
  missed: number;
}

export interface StarFile {
  builtAt: string;
  /** ESPN team abbreviation → that team's 20+ ppg regulars. */
  teams: Record<string, StarPlayer[]>;
}

export interface NbaInjury {
  athleteId: string;
  name: string;
  team: string;
  status: string;
}

/** ESPN status → chance he sits (Out and suspensions only: "Day-To-Day" mostly plays). */
export function outChance(status: string): number {
  const s = status.toLowerCase();
  if (s.startsWith("out") || s.includes("suspen")) return 1;
  if (s.includes("doubtful")) return 0.75;
  return 0;
}

export interface StarAdjust {
  /** Points added to the projected total (negative when stars sit). */
  points: number;
  why: string[];
}

/** Star-absence adjustment to one game's projected total. */
export function starAdjust(
  home: string,
  away: string,
  stars: StarFile | null | undefined,
  injuries: NbaInjury[],
): StarAdjust {
  if (!stars) return { points: 0, why: [] };
  const status = new Map(injuries.map((i) => [i.athleteId, i.status]));
  let net = 0;
  const why: string[] = [];
  for (const team of [away, home]) {
    for (const p of stars.teams[team] ?? []) {
      const out = outChance(status.get(p.id) ?? "");
      // missing today minus what the recent games (and so the ratings) already went without
      net += p.ppg * (out - p.missed);
      if (out >= 0.75) why.push(`${p.name} out (${p.ppg.toFixed(0)} ppg)`);
      else if (p.missed >= 0.4) why.push(`${p.name} back (${p.ppg.toFixed(0)} ppg)`);
    }
  }
  return { points: Math.round(STAR_COEF * net * 10) / 10 || 0, why };
}
