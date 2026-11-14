/**
 * Line shopping: every listed sportsbook's main spread and total for upcoming games (SportsGameOdds pulls
 * saved to props-site best-lines/<league>.json by the NFL props and extra-lines workflows), and the best
 * number available for a ★ pick. Pure functions.
 */
export type ShopLeague = "nfl" | "nba" | "cbb";

export interface BookLine {
  key: string;
  /** [home spread, home price, away price] */
  spread: [number, number | null, number | null] | null;
  /** [total, over price, under price] */
  total: [number, number | null, number | null] | null;
}

export interface ShopGame {
  home: string;
  away: string;
  commence: string;
  at?: string;
  books: BookLine[];
}

export interface ShopFile {
  at: string | null;
  league: string | null;
  games: ShopGame[];
}

/** What a ★ pick needs to be priced at every book. */
export interface ShopRequest {
  /** Full team names, e.g. "Kansas City Chiefs", "Duke Blue Devils". */
  home: string;
  away: string;
  market: "total" | "spread";
  side: "over" | "under" | "home" | "away";
}

export interface BestLine {
  book: string;
  /** From the picked side (spread: that team's number; total: the total). */
  line: number;
  price: number | null;
  /** How many books list this market. */
  books: number;
  /** The same market at DraftKings, when listed (the site's usual line). */
  draftkings: number | null;
  /** When the snapshot was taken. */
  at: string | null;
}

const BOOK_NAMES: Record<string, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  williamhill: "Caesars",
  espnbet: "theScore Bet",
  thescorebet: "theScore Bet",
  bovada: "Bovada",
  betonline: "BetOnline",
  betrivers: "BetRivers",
  fanatics: "Fanatics",
  hardrockbet: "Hard Rock",
  pointsbet: "PointsBet",
  unibet: "Unibet",
  pinnacle: "Pinnacle",
  bet365: "bet365",
  ballybet: "Bally Bet",
  betparx: "BetParx",
  consensus: "Consensus",
};
export const bookName = (k: string) => BOOK_NAMES[k.toLowerCase()] ?? k;

/**
 * The big US books the site shops and bets at: DraftKings, FanDuel, BetMGM, Caesars, theScore Bet (was ESPN
 * BET), Fanatics, Hard Rock and bet365 (SportsGameOdds bookmaker ids). Offshore and regional books are left
 * out of every best price.
 */
export const MAJOR_BOOKS = new Set([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "williamhill",
  "espnbet",
  "thescorebet",
  "fanatics",
  "hardrockbet",
  "bet365",
]);
export const isMajorBook = (k: string) => MAJOR_BOOKS.has(k.toLowerCase());

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\bst\b\.?/g, "state")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );

/** Share of the shorter name's words found in the other (0-1). */
export function nameMatch(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  let n = 0;
  for (const t of small) if (big.has(t)) n++;
  return n / small.size;
}

/** The snapshot game for a pick: both teams match and the start is within 6 hours. */
export function findGame(games: ShopGame[], req: ShopRequest, when: string): ShopGame | null {
  const t = Date.parse(when);
  let best: ShopGame | null = null;
  let bestScore = 0;
  for (const g of games) {
    if (Math.abs(Date.parse(g.commence) - t) > 6 * 3_600_000) continue;
    const s = Math.min(nameMatch(g.home, req.home), nameMatch(g.away, req.away));
    if (s >= 0.6 && s > bestScore) {
      best = g;
      bestScore = s;
    }
  }
  return best;
}

/** The best number for a pick across every listed book (ties: the better price). */
export function bestLineFor(
  file: ShopFile | null | undefined,
  req: ShopRequest,
  when: string,
): BestLine | null {
  if (!file) return null;
  const g = findGame(file.games, req, when);
  if (!g) return null;
  const offers: { book: string; line: number; price: number | null }[] = [];
  for (const b of g.books) {
    if (!isMajorBook(b.key)) continue;
    if (req.market === "total" && b.total) {
      const [line, over, under] = b.total;
      offers.push({ book: b.key, line, price: req.side === "over" ? over : under });
    } else if (req.market === "spread" && b.spread) {
      const [home, hp, ap] = b.spread;
      offers.push({
        book: b.key,
        line: req.side === "home" ? home : -home,
        price: req.side === "home" ? hp : ap,
      });
    }
  }
  if (!offers.length) return null;
  // a lower total is better for an over; a higher total for an under; a bigger number for a spread side
  const better = (x: number) => (req.market === "total" && req.side === "over" ? -x : x);
  const payout = (p: number | null) => (p === null ? -1 : p > 0 ? p / 100 : 100 / -p);
  offers.sort((a, b) => better(b.line) - better(a.line) || payout(b.price) - payout(a.price));
  const dk = offers.find((o) => o.book === "draftkings");
  return {
    book: bookName(offers[0].book),
    line: offers[0].line,
    price: offers[0].price,
    books: offers.length,
    draftkings: dk ? dk.line : null,
    at: g.at ?? file.at,
  };
}
