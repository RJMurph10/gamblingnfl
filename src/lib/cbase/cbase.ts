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
  /** Moneyline, run line or total. */
  k: "ml" | "rl" | "tot";
  /** home / away (moneyline, run line) or over / under (total). */
  side: "home" | "away" | "over" | "under";
  /** Model chance minus the no-vig opening chance. */
  edge: number;
  price: number;
  /** The picked side's run line (run line picks), or the total. */
  line?: number;
  /** P: a total that landed on the number. */
  res?: "W" | "L" | "P";
}

/** Model v2's game context: projected starters (home / away), first-pitch temperature (°F) and wind (mph). */
export interface CbaseContext {
  sph?: string;
  spa?: string;
  temp?: number;
  wind?: number;
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
  ctx?: CbaseContext;
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
  ctx?: CbaseContext;
  picks?: CbasePick[];
}

export interface CbaseTeam {
  name: string;
  conf: string;
  /** ESPN's college baseball team id (not the id in ESPN's logo URLs). */
  espn?: string | null;
  /** ESPN's logo for the team. */
  logo?: string | null;
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
    /** Total watch picks: model over/under chance this far over the no-vig opening total (v2). */
    totEdge?: number;
    halfLife: number;
    carry: number;
    priorGames: number;
  };
  effects: Partial<Record<"mu" | "home" | "midweek" | "fri" | "sun", number>>;
  teams: Record<string, CbaseTeam>;
  lined: CbaseLinedGame[];
  upcoming: CbaseUpcoming[];
  record: { ml: CbaseRecord; rl: CbaseRecord; tot?: CbaseRecord };
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
  p.k === "tot"
    ? `${p.side === "over" ? "Over" : "Under"} ${p.line} ${american(p.price)}`
    : `${p.side === "home" ? homeName : awayName} ${p.k === "ml" ? "ML" : signed(p.line, 1)} ${american(p.price)}`;

export const pickKindName = (k: CbasePick["k"]) =>
  k === "ml" ? "moneyline" : k === "rl" ? "run line" : "total";

export function recordText(r: CbaseRecord | undefined) {
  if (!r) return "—";
  const n = r.w + r.l;
  return `${r.w}-${r.l}${n ? ` · ${r.u > 0 ? "+" : ""}${r.u.toFixed(1)}u` : ""}`;
}

const implied = (x: number) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));

export interface CbaseDashStats {
  /** Lined games the model had numbers for and that finished. */
  graded: number;
  /** The model's winner (home chance above or below 50%) vs the no-vig opener's favorite. */
  winner: { right: number; wrong: number; market: number | null };
  /** The model's total vs the opening total (pushes and missing totals left out). */
  totals: { w: number; l: number };
  /** Moneyline watch picks whose price shortened from the opener to the close. */
  clv: { picks: number; ours: number; against: number };
  /** Date of the last graded game. */
  through: string | null;
}

/** Season numbers for the dashboard's cards, from the season file's lined games. */
export function cbaseDashStats(lined: CbaseLinedGame[]): CbaseDashStats {
  const out: CbaseDashStats = {
    graded: 0,
    winner: { right: 0, wrong: 0, market: null },
    totals: { w: 0, l: 0 },
    clv: { picks: 0, ours: 0, against: 0 },
    through: null,
  };
  let marketRight = 0;
  let marketN = 0;
  for (const g of lined) {
    if (g.hr === g.ar) continue;
    const homeWon = g.hr > g.ar;
    if (!out.through || g.date > out.through) out.through = g.date;
    if (g.m) {
      out.graded++;
      if (g.m.p !== 0.5) {
        if (g.m.p > 0.5 === homeWon) out.winner.right++;
        else out.winner.wrong++;
      }
      const tot = g.open?.tot;
      const runs = g.hr + g.ar;
      if (tot != null && g.m.t !== tot && runs !== tot) {
        if (g.m.t > tot === runs > tot) out.totals.w++;
        else out.totals.l++;
      }
    }
    const nv = noVig(g.open?.mlH, g.open?.mlA);
    if (nv != null && nv !== 0.5) {
      marketN++;
      if (nv > 0.5 === homeWon) marketRight++;
    }
    for (const p of g.picks ?? []) {
      if (p.k !== "ml" || !g.open || !g.close) continue;
      const o = p.side === "home" ? g.open.mlH : g.open.mlA;
      const c = p.side === "home" ? g.close.mlH : g.close.mlA;
      if (o == null || c == null) continue;
      out.clv.picks++;
      if (implied(c) > implied(o)) out.clv.ours++;
      else if (implied(c) < implied(o)) out.clv.against++;
    }
  }
  out.winner.market = marketN ? (marketRight / marketN) * 100 : null;
  return out;
}

/** Win share of a record, in percent (null before any result). */
export const winShare = (w: number, l: number) => (w + l ? (w / (w + l)) * 100 : null);

/** Return on 1-unit stakes, in percent. */
export const roi = (r: CbaseRecord) => (r.w + r.l ? (r.u / (r.w + r.l)) * 100 : null);
