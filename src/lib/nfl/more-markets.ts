/**
 * NFL "more markets": every book's halves, quarters, team totals, game specials and player 1st-half /
 * quarter props (props-site markets/nfl.json, saved by the SportsGameOdds props pull,
 * scripts/line-history/sgo-markets.mjs), plus the quarter / half edge finder's flags
 * (props-site nfl/partials-<season>.json, scripts/props/nfl-partials.mjs). Pure helpers.
 */
import { bookName, nameMatch } from "@/lib/shared/best-lines";

/** [line, a, b, c?] per book: ou [line, over, under]; sp [home spread, home, away]; ml [null, home, away]; ml3way [null, home, away, tie]; yn [null, yes, no]; eo [null, even, odd]. */
export type MarketCell = [number | null, number | null, number | null, (number | null)?];
export type MarketRow = [string, string, string, string, Record<string, MarketCell>];
export type PeriodProp = [
  string,
  string,
  string,
  Record<string, [number | null, number | null, number | null]>,
];

export interface MarketsGame {
  home: string;
  away: string;
  commence: string;
  at?: string;
  /** Full-game [home spread, total] (middle of the books). */
  full?: [number | null, number | null];
  mk: MarketRow[];
  pp: PeriodProp[];
}

export interface MarketsFile {
  at: string | null;
  games: MarketsGame[];
}

/** One book's full-game lines (scripts/line-history/sgo-games.mjs booksOf). */
export interface FullBookLine {
  key: string;
  spread: [number, number | null, number | null] | null;
  total: [number, number | null, number | null] | null;
  ml: [number | null, number | null] | null;
}

/** A game's saved lines (props-site markets/nfl/games/<file>.json): the last pull before kickoff, and the first. */
export interface LineGame {
  home: string;
  away: string;
  commence: string;
  at: string;
  full: [number | null, number | null] | null;
  books: FullBookLine[];
  mk: MarketRow[];
  open: { at: string; books: FullBookLine[]; mk: MarketRow[] };
}

export interface LineIndexRow {
  f: string;
  home: string;
  away: string;
  commence: string;
}

/** The full-game spread, moneyline and total as market rows, so they show with the rest. */
export function fullGameRows(books: FullBookLine[]): MarketRow[] {
  const sp: Record<string, MarketCell> = {};
  const ml: Record<string, MarketCell> = {};
  const tot: Record<string, MarketCell> = {};
  for (const b of books) {
    if (b.key === "consensus") continue;
    if (b.spread && (b.spread[1] != null || b.spread[2] != null))
      sp[b.key] = [b.spread[0], b.spread[1], b.spread[2]];
    if (b.ml && (b.ml[0] != null || b.ml[1] != null)) ml[b.key] = [null, b.ml[0], b.ml[1]];
    if (b.total && (b.total[1] != null || b.total[2] != null))
      tot[b.key] = [b.total[0], b.total[1], b.total[2]];
  }
  const rows: MarketRow[] = [];
  if (Object.keys(sp).length) rows.push(["game", "sp", "", "points", sp]);
  if (Object.keys(ml).length) rows.push(["game", "ml", "", "points", ml]);
  if (Object.keys(tot).length) rows.push(["game", "ou", "all", "points", tot]);
  return rows;
}

/** Points by period from line scores (OT counts toward the 2nd half and the game). */
export function periodPoints(q: number[], period: string): number | null {
  const s = (a: number, b: number) => q.slice(a, b).reduce((x, y) => x + y, 0);
  switch (period) {
    case "1q":
      return q.length >= 1 ? q[0] : null;
    case "2q":
      return q.length >= 2 ? q[1] : null;
    case "3q":
      return q.length >= 3 ? q[2] : null;
    case "4q":
      return q.length >= 4 ? q[3] : null;
    case "1h":
      return q.length >= 2 ? s(0, 2) : null;
    case "2h":
      return q.length >= 4 ? s(2, 99) : null;
    case "game":
      return q.length >= 4 ? s(0, 99) : null;
    default:
      return null;
  }
}

/** How many quarters a period needs before it's settled. */
export const periodEnd: Record<string, number> = {
  "1q": 1,
  "2q": 2,
  "3q": 3,
  "4q": 4,
  "1h": 2,
  "2h": 4,
  game: 4,
};

/**
 * Which side won a points market, in sideLabels order (true = won, false = lost, null = push / not
 * settled / not a points market). `done` = the period has finished.
 */
export function marketResult(
  r: MarketRow,
  line: number | null,
  home: number[],
  away: number[],
  done: boolean,
): (boolean | null)[] | null {
  const [period, bet, who, stat] = r;
  if (!done || stat !== "points") return null;
  const h = periodPoints(home, period);
  const a = periodPoints(away, period);
  if (h == null || a == null) return null;
  const win = (x: number) => (x > 0 ? true : x < 0 ? false : null);
  if (bet === "ou") {
    const v = who === "home" ? h : who === "away" ? a : h + a;
    if (line == null) return null;
    const o = win(v - line);
    return [o, o == null ? null : !o];
  }
  if (bet === "sp") {
    if (line == null) return null;
    const homeCovers = win(h - a + line);
    return [homeCovers == null ? null : !homeCovers, homeCovers];
  }
  if (bet === "ml") {
    const hw = win(h - a);
    return [hw == null ? null : !hw, hw];
  }
  if (bet === "ml3way") return [a > h, h > a, a === h];
  return null;
}

export interface PartialFlag {
  id: string;
  key: string;
  label: string;
  start: string;
  home: string;
  away: string;
  side: "over" | "under" | "home" | "away";
  line: number | null;
  book: string;
  price: number;
  ev: number;
  chance: number;
  tier: "watch" | "track";
  at: string;
  actual?: number;
  res?: "win" | "loss" | "push" | "void";
}

export interface PartialsFile {
  season: number;
  updated: string;
  flags: PartialFlag[];
  record: { watch: number[]; track: number[]; byMarket: Record<string, number[]> };
}

export const PERIODS: Record<string, string> = {
  "1h": "1st half",
  "2h": "2nd half",
  "1q": "1st quarter",
  "2q": "2nd quarter",
  "3q": "3rd quarter",
  "4q": "4th quarter",
  game: "Game",
};

const STAT: Record<string, string> = {
  points: "points",
  touchdowns: "touchdowns",
  fieldGoals_made: "field goals",
  fieldGoals_longestMade: "longest field goal",
  firstToScore: "first to score",
  lastToScore: "last to score",
  bothTeamsScored: "both teams score",
  largestLead: "largest lead",
  punting_numPunts: "punts",
  turnovers: "turnovers",
  defense_safeties: "safety",
  defense_sacks: "sacks",
  yards: "yards",
};

/** A readable market name, e.g. "Total points", "Home team total", "Moneyline (3-way)". */
export function marketName(r: MarketRow, home: string, away: string): string {
  const [, bet, who, stat] = r;
  const team = who === "home" ? home : who === "away" ? away : "";
  const s = STAT[stat] ?? stat;
  if (bet === "sp") return "Spread";
  if (bet === "ml" && stat === "points") return "Moneyline";
  if (bet === "ml") return s[0].toUpperCase() + s.slice(1);
  if (bet === "ml3way") return "Moneyline, tie a result";
  if (bet === "eo") return `${team ? `${team} ` : "Total "}${s}: odd / even`;
  if (bet === "yn") return `${team ? `${team} ` : "Any "}${s}?`;
  return team ? `${team} ${s}` : `Total ${s}`;
}

export const sideLabels = (r: MarketRow, home: string, away: string): string[] => {
  switch (r[1]) {
    case "ou":
      return ["Over", "Under"];
    case "sp":
    case "ml":
      return [away, home];
    case "ml3way":
      return [away, home, "Tie"];
    case "yn":
      return ["Yes", "No"];
    case "eo":
      return ["Even", "Odd"];
    default:
      return ["", ""];
  }
};

const payout = (p: number) => (p > 0 ? p / 100 : 100 / -p);

export interface BestOffer {
  book: string;
  line: number | null;
  price: number;
}

/** The line most books post (home number for spreads); ties go to the lower line. */
export function mainLine(r: MarketRow): number | null {
  const n = new Map<number, number>();
  for (const c of Object.values(r[4])) if (c[0] != null) n.set(c[0], (n.get(c[0]) ?? 0) + 1);
  let best: number | null = null;
  for (const [line, k] of n)
    if (best == null || k > n.get(best)! || (k === n.get(best)! && line < best)) best = line;
  return best;
}

/**
 * Best price per side at the main line (books on other numbers are left out: alternate or stale lines),
 * in the order of sideLabels. Spread lines are from that side's point of view.
 */
export function bestOffers(r: MarketRow): (BestOffer | null)[] {
  const bet = r[1];
  const main = mainLine(r);
  const slots = bet === "sp" || bet === "ml" ? [2, 1] : bet === "ml3way" ? [2, 1, 3] : [1, 2];
  return slots.map((slot) => {
    let best: BestOffer | null = null;
    for (const [book, cell] of Object.entries(r[4])) {
      const price = cell[slot];
      if (price == null || cell[0] !== main) continue;
      const line = bet === "sp" && main != null ? (slot === 1 ? main : -main) : main;
      if (!best || payout(price) > payout(best.price)) best = { book: bookName(book), line, price };
    }
    return best;
  });
}

const RANK = ["sp|", "ml|", "ou|all", "ou|home", "ou|away", "ml3way|"];
/** Main markets first (spread, moneyline, total, team totals), then the specials. */
export function marketRank(r: MarketRow): number {
  const i = r[3] === "points" ? RANK.indexOf(`${r[1]}|${r[2]}`) : -1;
  return i < 0 ? RANK.length : i;
}

/** This game's markets: both teams match and the start is within 6 hours. */
export function findMarketsGame(
  file: MarketsFile | null | undefined,
  home: string,
  away: string,
  when: string,
): MarketsGame | null {
  if (!file) return null;
  const t = Date.parse(when);
  return (
    file.games.find(
      (g) =>
        Math.abs(Date.parse(g.commence) - t) <= 6 * 3_600_000 &&
        nameMatch(g.home, home) >= 0.6 &&
        nameMatch(g.away, away) >= 0.6,
    ) ?? null
  );
}

export const fmtOdds = (o: number) => (o > 0 ? `+${o}` : `${o}`);
export const fmtLine = (x: number | null, signed = false) =>
  x == null ? "" : signed && x > 0 ? `+${x}` : `${x}`;
