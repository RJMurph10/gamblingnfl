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
