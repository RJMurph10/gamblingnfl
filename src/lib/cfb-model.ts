/**
 * College football ★ best bets: four rules that made money on past seasons they were not built
 * on (looked for on 2009–2017, confirmed on 2018–2025, closing lines, 1 unit at -110).
 *
 * - Road bounce-back: the road team against the spread after losing its last game by 21+.
 *   (Markets overreact to a blowout; home teams in the same spot don't bounce back.)
 * - Cross-country trips: the home team against the spread when the visitor flew 2,000+ miles.
 *   (When both spread rules fire they point at opposite teams, so neither is bet.)
 * - Early-season unders: the under in weeks 1–2, when totals are set on last season's offenses.
 *   (Flat on 2009–2017, strong since 2018: kept as the newest, least proven rule.)
 * - Service academies: the under when Army, Navy and Air Force play each other (option offenses
 *   that know each other and keep the clock running).
 *
 * FBS vs FBS regular-season games only. Pure functions (browser- and server-safe).
 */

import { gameScore, type Game } from "@/data/games";
import { CFB_STADIUMS } from "@/data/cfb-stadiums";
import { homeLine } from "./season-pulse";

export type CfbRuleId = "bounce" | "travel" | "early" | "academy";

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
    found: "431-379 · 53.2% · +12.8u (2009–17)",
    tested: "395-337 · 54.0% · +22.1u (2018–25)",
  },
  {
    id: "travel",
    title: "Cross-country trips",
    bet: "Home team against the spread when the visitor traveled 2,000+ miles",
    why: "Lines don't fully price a cross-country flight and a body clock 3+ hours off. Big Ten and ACC expansion made these trips common.",
    found: "32-23 · 58.2% · +6.1u (2009–17)",
    tested: "70-45 · 60.9% · +18.6u (2018–25)",
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
export const TRAVEL_MILES = 2000;

const stadiumOf = (teamId: string) => CFB_STADIUMS[Number(teamId.replace(/^cfb-/, ""))];

/** Miles between two teams' home stadiums (null when either isn't an FBS team on file). */
export function tripMiles(fromTeamId: string, toTeamId: string): number | null {
  const a = stadiumOf(fromTeamId);
  const b = stadiumOf(toTeamId);
  if (!a || !b) return null;
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export type PickResult = "win" | "loss" | "push" | "pending";

export interface CfbPick {
  game: Game;
  rule: CfbRuleId;
  market: "spread" | "total";
  side: "home" | "away" | "under";
  /** The picked team's spread (+7.5 = getting 7.5), or the total. */
  line: number;
  result: PickResult;
  /** Units at -110 (0 while pending). */
  units: number;
  /** Bounce-back: the loss behind the pick. */
  lastLoss?: { gameId: string; margin: number };
  /** Cross-country: how far the visitor traveled. */
  miles?: number;
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

    // Spreads: the road team after a blowout loss, or the home team against a cross-country
    // visitor. When both fire they point at opposite teams, so neither is bet.
    const home = homeLine(g);
    if (home === null) continue;
    const list = byTeam.get(g.awayTeamId) ?? [];
    const before = list.filter((x) => x !== g && kickoff(x) < kickoff(g));
    const prev = before[before.length - 1];
    let margin: number | null = null;
    if (prev && prev.status === "final") {
      const ps = gameScore(prev);
      margin = prev.homeTeamId === g.awayTeamId ? ps.home - ps.away : ps.away - ps.home;
    }
    const bounce = margin !== null && margin <= -BOUNCE_LOSS_MARGIN;
    const miles = g.neutralSite ? null : tripMiles(g.awayTeamId, g.homeTeamId);
    const travel = miles !== null && miles >= TRAVEL_MILES;
    if (bounce === travel) continue;
    if (bounce) {
      picks.push({
        game: g,
        rule: "bounce",
        market: "spread",
        side: "away",
        line: -home,
        lastLoss: { gameId: prev!.id, margin: margin! },
        ...grade(s ? s.away - s.home - home : null),
      });
    } else {
      picks.push({
        game: g,
        rule: "travel",
        market: "spread",
        side: "home",
        line: home,
        miles: Math.round(miles!),
        ...grade(s ? s.home - s.away + home : null),
      });
    }
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

/* ---------------- watch list (tracked, not bet) ---------------- */

export type CfbWatchId = "late" | "eastlate" | "wind";

export interface CfbWatchAngle {
  id: CfbWatchId;
  title: string;
  bet: string;
  why: string;
  found?: string;
  tested?: string;
}

export const CFB_WATCH: CfbWatchAngle[] = [
  {
    id: "late",
    title: "Late-night unders",
    bet: "Under when kickoff is 10 pm ET or later",
    why: "Flat before 2018, strong since. Needs to keep winning on new games before it's bet.",
    found: "191-175 · 52.2% · −1.4u (2009–17)",
    tested: "199-149 · 57.2% · +31.9u (2018–25)",
  },
  {
    id: "eastlate",
    title: "East team out west, late",
    bet: "Home team when the visitor is 2+ time zones east and kicks off at 9 pm or later on its own clock",
    why: "Flat before 2018, strong since, and only about 10–20 games a year.",
    found: "24-22 · 52.2% · −0.2u (2009–17)",
    tested: "44-26 · 62.9% · +14.0u (2018–25)",
  },
  {
    id: "wind",
    title: "Wind 10+ mph unders",
    bet: "Under at outdoor stadiums with a 10+ mph wind forecast at kickoff",
    why: "Works in the NFL. College history has no weather to test it on, so it's tracked from the forecast.",
  },
];

/** Hour of the day (0–23) at a time zone. */
function hourIn(iso: string, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(new Date(iso))
    .find((p) => p.type === "hour")?.value;
  return Number(h ?? 0);
}

/** UTC offset in hours of a time zone at an instant. */
function offsetIn(iso: string, timeZone: string): number {
  const d = new Date(iso);
  const local = new Date(d.toLocaleString("en-US", { timeZone }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local.getTime() - utc.getTime()) / 3_600_000);
}

export interface CfbWatchHit {
  game: Game;
  angle: CfbWatchId;
  market: "spread" | "total";
  side: "home" | "under";
  line: number;
  result: PickResult;
  units: number;
  /** Wind: the kickoff forecast in mph. */
  wind?: number;
}

/**
 * Watch-list games in a schedule. Wind needs kickoff forecasts (game id → mph), so only games
 * with a forecast appear; it isn't graded from history.
 */
export function cfbWatchHits(games: Game[], windByGame: Record<string, number | null> = {}) {
  const hits: CfbWatchHit[] = [];
  for (const g of games) {
    if (g.fcs || !g.kickoffIso) continue;
    const s = g.status === "final" ? gameScore(g) : null;
    if (g.total && g.total > 0) {
      const under = grade(s ? g.total - (s.home + s.away) : null);
      const et = hourIn(g.kickoffIso, "America/New_York");
      if (et >= 22 || et < 4)
        hits.push({
          game: g,
          angle: "late",
          market: "total",
          side: "under",
          line: g.total,
          ...under,
        });
      const wind = windByGame[g.id];
      if (typeof wind === "number" && wind >= 10)
        hits.push({
          game: g,
          angle: "wind",
          market: "total",
          side: "under",
          line: g.total,
          wind,
          ...under,
        });
    }
    const home = homeLine(g);
    const away = stadiumOf(g.awayTeamId);
    const venue = stadiumOf(g.homeTeamId);
    if (home === null || !away || !venue || g.neutralSite) continue;
    const zones = offsetIn(g.kickoffIso, away[2]) - offsetIn(g.kickoffIso, venue[2]);
    const clock = hourIn(g.kickoffIso, away[2]);
    if (zones >= 2 && (clock >= 21 || clock < 4))
      hits.push({
        game: g,
        angle: "eastlate",
        market: "spread",
        side: "home",
        line: home,
        ...grade(s ? s.home - s.away + home : null),
      });
  }
  return hits.sort((a, b) => kickoff(a.game) - kickoff(b.game));
}

/** Outdoor FBS home stadium location for a weather forecast (null for domes / unknown). */
export function outdoorStadium(teamId: string): { lat: number; lon: number } | null {
  const st = stadiumOf(teamId);
  return st && !st[3] ? { lat: st[0], lon: st[1] } : null;
}
