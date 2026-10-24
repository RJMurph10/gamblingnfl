/**
 * College football ★ best bets: three rules that made money on past seasons they were not built
 * on (found on 2009–2017, confirmed on 2018–2025, closing lines, 1 unit at -110).
 *
 * - Road bounce-back: the road team against the spread after losing its last game by 21+.
 *   (Markets overreact to a blowout; home teams in the same spot don't bounce back.)
 * - Early-season unders: the under in weeks 1–2, when totals are set on last season's offenses.
 *   (Flat on 2009–2017, strong since 2018: kept as the newest, least proven rule.)
 * - Service academies: the under when Army, Navy and Air Force play each other (option offenses
 *   that know each other and keep the clock running).
 *
 * FBS vs FBS regular-season games only. Pure functions (browser- and server-safe).
 */

import { gameScore, type Game } from "@/data/games";
import { homeLine } from "./season-pulse";

export type CfbRuleId = "bounce" | "early" | "academy";

export interface CfbRule {
  id: CfbRuleId;
  title: string;
  bet: string;
  why: string;
  /** Record on the seasons the rule was found on, and on the newer ones it was tested on. */
  found: string;
  tested: string;
}

export const CFB_RULES: CfbRule[] = [
  {
    id: "bounce",
    title: "Road bounce-back",
    bet: "Road team against the spread after losing its last game by 21+",
    why: "Lines overreact to a blowout loss. Home teams in the same spot don't bounce back, so it's road teams only.",
    found: "433-381 · 53.2% · +12.6u (2009–17)",
    tested: "404-344 · 54.0% · +23.3u (2018–25)",
  },
  {
    id: "early",
    title: "Early-season unders",
    bet: "Under in weeks 1–2",
    why: "Opening totals lean on last season's offenses, and new quarterbacks and transfers start slow. Flat before 2018, strong in the transfer-portal era.",
    found: "371-339 · 52.3% · −1.7u (2009–17)",
    tested: "374-295 · 55.9% · +45.0u (2018–25)",
  },
  {
    id: "academy",
    title: "Service academies",
    bet: "Under when Army, Navy and Air Force play each other",
    why: "Two option offenses that know each other: long drives, few possessions, a running clock.",
    found: "22-5 · 81.5% · +15.0u (2009–17)",
    tested: "17-6 · 73.9% · +9.5u (2018–25)",
  },
];

/** Army, Navy, Air Force (ESPN team ids). */
export const ACADEMY_IDS = new Set(["cfb-349", "cfb-2426", "cfb-2005"]);
export const BOUNCE_LOSS_MARGIN = 21;
export const EARLY_LAST_WEEK = 2;

export type PickResult = "win" | "loss" | "push" | "pending";

export interface CfbPick {
  game: Game;
  rule: CfbRuleId;
  market: "spread" | "total";
  side: "away" | "under";
  /** The road team's spread (+7.5 = getting 7.5), or the total. */
  line: number;
  result: PickResult;
  /** Units at -110 (0 while pending). */
  units: number;
  /** Bounce-back: the loss behind the pick. */
  lastLoss?: { gameId: string; margin: number };
}

const WIN_UNITS = 100 / 110;

function grade(diff: number | null): { result: PickResult; units: number } {
  if (diff === null) return { result: "pending", units: 0 };
  if (diff > 0) return { result: "win", units: WIN_UNITS };
  if (diff < 0) return { result: "loss", units: -1 };
  return { result: "push", units: 0 };
}

const kickoff = (g: Game) => (g.kickoffIso ? Date.parse(g.kickoffIso) : 0);

/** Each team's games in kickoff order. */
function gamesByTeam(games: Game[]) {
  const map = new Map<string, Game[]>();
  for (const g of games) {
    for (const id of [g.homeTeamId, g.awayTeamId]) map.set(id, [...(map.get(id) ?? []), g]);
  }
  for (const list of map.values()) list.sort((a, b) => kickoff(a) - kickoff(b));
  return map;
}

/** Every ★ best bet in a schedule (finished games graded, upcoming ones pending). */
export function cfbBestBets(games: Game[]): CfbPick[] {
  const byTeam = gamesByTeam(games);
  const picks: CfbPick[] = [];
  for (const g of games) {
    if (g.fcs) continue;
    const final = g.status === "final";
    const s = final ? gameScore(g) : null;
    const academy = ACADEMY_IDS.has(g.homeTeamId) && ACADEMY_IDS.has(g.awayTeamId);

    // Totals: academy games first, so one game never gets two unders.
    if (g.total && g.total > 0 && (academy || g.week <= EARLY_LAST_WEEK)) {
      picks.push({
        game: g,
        rule: academy ? "academy" : "early",
        market: "total",
        side: "under",
        line: g.total,
        ...grade(s ? g.total - (s.home + s.away) : null),
      });
    }

    // Spread: the road team after a blowout loss in its previous game this season.
    const home = homeLine(g);
    if (home === null) continue;
    const list = byTeam.get(g.awayTeamId) ?? [];
    const before = list.filter((x) => x !== g && kickoff(x) < kickoff(g));
    const prev = before[before.length - 1];
    if (!prev || prev.status !== "final") continue;
    const ps = gameScore(prev);
    const margin = prev.homeTeamId === g.awayTeamId ? ps.home - ps.away : ps.away - ps.home;
    if (margin > -BOUNCE_LOSS_MARGIN) continue;
    const awayLine = -home;
    picks.push({
      game: g,
      rule: "bounce",
      market: "spread",
      side: "away",
      line: awayLine,
      lastLoss: { gameId: prev.id, margin },
      ...grade(s ? s.away - s.home + awayLine : null),
    });
  }
  return picks.sort((a, b) => kickoff(a.game) - kickoff(b.game));
}

export interface CfbRecord {
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  winPct: number | null;
}

export function cfbRecord(picks: { result: PickResult; units: number }[]): CfbRecord {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  for (const p of picks) {
    if (p.result === "win") wins++;
    else if (p.result === "loss") losses++;
    else if (p.result === "push") pushes++;
    units += p.units;
  }
  return {
    wins,
    losses,
    pushes,
    units: Math.round(units * 100) / 100,
    winPct: wins + losses ? (wins / (wins + losses)) * 100 : null,
  };
}

/** A record from [wins, losses, pushes] at -110. */
export function recordFromCounts([w, l, p]: [number, number, number]): CfbRecord {
  return {
    wins: w,
    losses: l,
    pushes: p,
    units: Math.round((w * WIN_UNITS - l) * 100) / 100,
    winPct: w + l ? (w / (w + l)) * 100 : null,
  };
}

export function addRecords(records: CfbRecord[]): CfbRecord {
  const w = records.reduce((s, r) => s + r.wins, 0);
  const l = records.reduce((s, r) => s + r.losses, 0);
  const p = records.reduce((s, r) => s + r.pushes, 0);
  return recordFromCounts([w, l, p]);
}

export const recordText = (r: CfbRecord) =>
  `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
