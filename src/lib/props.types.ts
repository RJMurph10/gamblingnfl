export type PropCategory = "td-scorers" | "passing" | "rushing" | "receiving";

export type TDMarket = "all" | "anytime" | "first" | "multi";
export type PassingMetric = "yards" | "tds" | "completions" | "ints";
export type RushingMetric = "yards" | "attempts" | "longest";
export type ReceivingMetric = "yards" | "receptions" | "longest";

export interface PropPlayer {
  id: string;
  name: string;
  teamAbbr: string;
  position: string;
  jersey?: string;
  headshot?: string;
}

export interface PlayerPropLine {
  playerId: string;
  playerName: string;
  teamAbbr: string;
  position: string;
  jersey?: string;
  headshot?: string;
  metric: string;
  line: number;
  overOdds: string;
  underOdds: string;
  currentStat?: number;
  result?: "over" | "under" | "push" | "pending";
}

export interface TDScorerLine {
  playerId: string;
  playerName: string;
  teamAbbr: string;
  position: string;
  jersey?: string;
  headshot?: string;
  firstOdds: string;
  anytimeOdds: string;
  multiOdds: string;
  scoredTD?: boolean;
  firstTDScorer?: boolean;
  tdCount?: number;
}

/** One real DraftKings prop offer from ESPN's core odds feed. */
export interface LivePropOffer {
  playerId: string;
  playerName: string;
  teamAbbr: string;
  position: string;
  headshot?: string;
  category: "td" | "passing" | "rushing" | "receiving";
  /** e.g. "Passing Yards", "Anytime TD", "First TD", "2+ TDs". */
  market: string;
  /** over-under: a line with two prices; milestone: "N+" with one price; yes: a one-price yes/no market. */
  kind: "over-under" | "milestone" | "yes";
  line?: number;
  /** Where the line opened, when ESPN reports it. */
  openLine?: number;
  /** American odds. Over/Yes/milestone price. */
  overOdds?: string;
  underOdds?: string;
}

export interface GamePropBoard {
  /** True when ESPN returned any props for this game. */
  available: boolean;
  /** True when at least one offer has a posted price. */
  priced: boolean;
  offers: LivePropOffer[];
  fetchedAt: number;
  /** What ESPN returned, shown when the board is empty so problems are easy to spot. */
  diagnostics?: {
    providersTried: string[];
    itemCount: number;
    sampleTypes: string[];
    error?: string;
    /** True when the browser fetched ESPN directly because the server was refused. */
    viaBrowser?: boolean;
    /** One raw touchdown-scorer item, so we can see where ESPN puts the price. */
    sampleTd?: string;
  };
}
