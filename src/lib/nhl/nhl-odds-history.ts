/** Browser-safe types for the NHL odds export (see nhl-odds-history.server.ts). */

export interface NhlPastGame {
  id: string;
  date: string;
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
  /** "Final", "Final/OT", "Final/SO". */
  detail: string;
}

/** One sportsbook's lines for one game. Odds are American text ("+150"); lines are numbers as text. */
export interface NhlOddsRow {
  gameId: string;
  date: string;
  away: string;
  home: string;
  awayScore: string;
  homeScore: string;
  detail: string;
  provider: string;
  mlAwayOpen: string;
  mlHomeOpen: string;
  mlAwayClose: string;
  mlHomeClose: string;
  plHomeOpenLine: string;
  plHomeOpenOdds: string;
  plAwayOpenOdds: string;
  plHomeCloseLine: string;
  plHomeCloseOdds: string;
  plAwayCloseOdds: string;
  totalOpenLine: string;
  overOpenOdds: string;
  underOpenOdds: string;
  totalCloseLine: string;
  overCloseOdds: string;
  underCloseOdds: string;
}

export const NHL_ODDS_COLUMNS: (keyof NhlOddsRow)[] = [
  "gameId", "date", "away", "home", "awayScore", "homeScore", "detail", "provider",
  "mlAwayOpen", "mlHomeOpen", "mlAwayClose", "mlHomeClose",
  "plHomeOpenLine", "plHomeOpenOdds", "plAwayOpenOdds", "plHomeCloseLine", "plHomeCloseOdds", "plAwayCloseOdds",
  "totalOpenLine", "overOpenOdds", "underOpenOdds", "totalCloseLine", "overCloseOdds", "underCloseOdds",
];
