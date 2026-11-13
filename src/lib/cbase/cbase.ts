/**
 * College baseball (NCAA Division I) types and helpers. The data is the season file the
 * "College baseball season" job publishes (props-site cbase/season-<year>.json, built by
 * scripts/cbase/build_season.py): NCAA results for every game, ESPN's lines where ESPN has them, and the
 * run-ratings model's numbers and watch picks.
 */

/** One line from one book: moneyline, run line (home's handicap and both prices) and total. */
export interface CbaseLine {
  mlH: number | null;
  mlA: number | null;
  /** Home team's run line: −1.5 or +1.5. */
  rl: number | null;
  rlH: number | null;
  rlA: number | null;
  tot: number | null;
  ov: number | null;
  un: number | null;
}

/** The model's pregame numbers: expected runs, home win chance, total. */
export interface CbaseModel {
  h: number;
  a: number;
  p: number;
  t: number;
}

export interface CbasePick {
  k: "ml" | "rl";
  side: "home" | "away";
  /** Model chance minus the no-vig opening chance. */
  edge: number;
  price: number;
  /** The picked side's run line (run line picks). */
  line?: number;
  res?: "W" | "L";
}

export interface CbaseLinedGame {
  /** NCAA game id. */
  id: string;
  espn: string;
  /** Game day (US). */
  date: string;
  start: string;
  home: string;
  away: string;
  hr: number;
  ar: number;
  book: string;
  open: CbaseLine | null;
  close: CbaseLine | null;
  m?: CbaseModel;
  picks?: CbasePick[];
}

export interface CbaseUpcoming {
  espn: string;
  start: string;
  /** NCAA team keys; missing when the team couldn't be matched. */
  home: string | null;
  away: string | null;
  homeName: string;
  awayName: string;
  book?: string;
  open?: CbaseLine | null;
  close?: CbaseLine | null;
  m?: CbaseModel;
  picks?: CbasePick[];
}

export interface CbaseTeam {
  name: string;
  conf: string;
  espn?: string | null;
  w: number;
  l: number;
  rs: number;
  ra: number;
  /** Runs above average scored (off) and prevented (dfn) per game, and the home park's runs effect. */
  off?: number;
  dfn?: number;
  park?: number;
  rank?: number;
}

export interface CbaseRecord {
  w: number;
  l: number;
  u: number;
}

export interface CbaseSeason {
  season: number;
  seasons: number[];
  updated: string;
  model: {
    K: number;
    SIGMA: number;
    SD: number;
    minGames: number;
    mlEdge: number;
    rlEdge: number;
    halfLife: number;
    carry: number;
    priorGames: number;
  };
  effects: Partial<Record<"mu" | "home" | "midweek" | "fri" | "sun", number>>;
  teams: Record<string, CbaseTeam>;
  lined: CbaseLinedGame[];
  upcoming: CbaseUpcoming[];
  record: { ml: CbaseRecord; rl: CbaseRecord };
}

/** A finished game, compact: [NCAA id, date, home, away, home runs, away runs]. */
export type CbaseResult = [string, string, string, string, number, number];

export interface CbaseTeamPage {
  season: number;
  seasons: number[];
  key: string;
  team: CbaseTeam;
  teams: Record<string, CbaseTeam>;
  results: CbaseResult[];
  lined: CbaseLinedGame[];
  upcoming: CbaseUpcoming[];
}

export const american = (n: number | null | undefined) =>
  n == null ? "—" : n > 0 ? `+${n}` : String(n);

export const signed = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

export const pct = (p: number | null | undefined, digits = 0) =>
  p == null ? "—" : `${(p * 100).toFixed(digits)}%`;

/** No-vig chance of the home side from a pair of American prices. */
export function noVig(h: number | null | undefined, a: number | null | undefined): number | null {
  const ip = (x: number) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
  if (h == null || a == null) return null;
  const ph = ip(h);
  const pa = ip(a);
  return ph / (ph + pa);
}

/** Units won or lost on a 1-unit bet. */
export const units = (price: number, won: boolean) =>
  won ? (price < 0 ? 100 / -price : price / 100) : -1;

export const teamName = (
  teams: Record<string, CbaseTeam>,
  key: string | null | undefined,
  fallback = "",
) => (key && teams[key]?.name) || fallback || key || "";

/** The US (Eastern) game day of a start time, YYYY-MM-DD. */
export function etDay(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function startTime(iso: string): string {
  return (
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) + " ET"
  );
}

export const pickLabel = (p: CbasePick, homeName: string, awayName: string) =>
  `${p.side === "home" ? homeName : awayName} ${p.k === "ml" ? "ML" : signed(p.line, 1)} ${american(p.price)}`;

export function recordText(r: CbaseRecord | undefined) {
  if (!r) return "—";
  const n = r.w + r.l;
  return `${r.w}-${r.l}${n ? ` · ${r.u > 0 ? "+" : ""}${r.u.toFixed(1)}u` : ""}`;
}
