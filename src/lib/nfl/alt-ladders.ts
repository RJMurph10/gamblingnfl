/** DraftKings alt-line ladders graded by price bucket (props-site/nfl/alt-ladders-<season>.json). */
export interface AltBucket {
  label: string;
  bets: number;
  wins: number;
  units: number;
  /** Average win rate the prices needed, %. */
  needed: number | null;
}

export interface AltLaddersFile {
  season: number;
  updated: string;
  games: number;
  buckets: AltBucket[];
  byMarket: Record<string, AltBucket[]>;
  /** Receiving / passing-yard rungs at −175 to −250: [date, player, team, game, market, line, price, actual, result]. */
  recent: [string, string, string, string, string, number, number, number, "win" | "loss"][];
}

/** The research hint being checked: receiving- and passing-yard alt overs at −175 to −250. */
export const HINT_BUCKET = "−249 to −175";
export const HINT_MARKETS = ["Rec yds", "Pass yds"];
