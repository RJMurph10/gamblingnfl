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
