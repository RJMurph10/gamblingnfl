/**
 * Live results: picks recorded the first time they appeared (scripts/picks/*-picks.ts), graded at that line
 * once final (scripts/picks/grade-picks.mjs). This is the honest record: the number you could actually bet
 * when the pick went out, not a replay.
 */
export interface LivePick {
  id: string;
  day: string;
  game: string;
  tip: string;
  market: "total" | "spread";
  pick: string;
  line: number;
  latest: number | null;
  /** The closing line (ESPN, once final); null before then. Same convention as `line`. */
  close?: number | null;
  model: number | null;
  edge: number | null;
  best: boolean;
  /** Football: which ★ rule or watch angle ("wind", "rivalry", "gusty-rain", ...). */
  tag?: string;
  /** Kickoff forecast behind a weather pick. */
  note?: string;
  /** The site stopped showing the pick well before kickoff. */
  dropped?: boolean;
  score: [number, number] | null;
  result: "win" | "loss" | "push" | null;
  /**
   * Closing-line value: points the closing line moved toward the pick from the line it was posted at
   * (> 0 = the pick beat the close). Falls back to the last line seen before tip.
   */
  clv: number | null;
}

export interface LiveRecord {
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  /** Graded picks: share that beat / lost to the closing line, and the average points. */
  beat: number | null;
  lost: number | null;
  avgClv: number | null;
}

/** Flat 1u at −110. */
export function liveRecord(picks: LivePick[]): LiveRecord {
  const r: LiveRecord = {
    wins: 0,
    losses: 0,
    pushes: 0,
    units: 0,
    beat: null,
    lost: null,
    avgClv: null,
  };
  let n = 0;
  let up = 0;
  let down = 0;
  let sum = 0;
  for (const p of picks) {
    if (p.result === "win") {
      r.wins++;
      r.units += 100 / 110;
    } else if (p.result === "loss") {
      r.losses++;
      r.units -= 1;
    } else if (p.result === "push") r.pushes++;
    if (p.result && p.clv !== null) {
      n++;
      sum += p.clv;
      if (p.clv > 0) up++;
      else if (p.clv < 0) down++;
    }
  }
  if (n) {
    r.beat = (100 * up) / n;
    r.lost = (100 * down) / n;
    r.avgClv = sum / n;
  }
  r.units = Math.round(r.units * 100) / 100;
  return r;
}

export const seasonLabel = (now = new Date()) => {
  const end = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  return `${end - 1}-${String(end).slice(2)}`;
};
