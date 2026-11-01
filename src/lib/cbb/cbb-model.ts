/**
 * The men's college basketball model: team power ratings, game predictions and graded picks.
 *
 * Ratings: every team has an offense and a defense number (points above / below the Division I
 * average, adjusted for opponent and home court; no home court at neutral sites). They start from last
 * season's ratings (src/data/cbb/prior-ratings.ts), shrunk toward average because rosters turn over,
 * and are pulled toward this season's results as games are played. A finished game is predicted only
 * from games played BEFORE its day, so the record is an honest walk-forward test.
 *
 * Settings come from research/cbb/model.py (2023-24 through 2025-26 against closing lines). Tested
 * honestly, the model does NOT beat college basketball closing lines: about 50-51% against the spread
 * and under 50% on totals in each season, with no edge size or angle that held up every year. It is
 * shown so its record can be tracked; there are no ★ best bets.
 */
import { CBB_PRIOR, CBB_PRIOR_AVG } from "@/data/cbb/prior-ratings";
import { atsResult, etDayKey, hasScore, normCdf, ouResult, winnerOf, type CbbGame } from "./cbb";

export const HOME_COURT = 3.0;
/** Games' worth of weight given to last season before this season's results take over. */
const PRIOR_WEIGHT = 6;
/** How much of last season's rating carries over. */
const PRIOR_SHRINK = 0.6;
/** Teams with no rating last season (new to Division I, or non-D-I opponents) start this far below average. */
const NEW_TEAM = 6;
export const MARGIN_SD = 11.5;
const DEFAULT_AVG = 72;

export const SPREAD_PICK_MIN = 2;
export const TOTAL_PICK_MIN = 3;
const WIN_UNITS = 100 / 110;

export interface RatingTable {
  avg: number;
  off: Map<string, number>;
  def: Map<string, number>;
  games: Map<string, number>;
}

function priorFor(id: string): [number, number] {
  const p = CBB_PRIOR[id];
  return p ? [PRIOR_SHRINK * p[0], PRIOR_SHRINK * p[1]] : [-NEW_TEAM, NEW_TEAM];
}

export function buildRatings(finals: CbbGame[]): RatingTable {
  const scores = finals.length * 2;
  const seasonSum = finals.reduce((s, g) => s + (g.away.score ?? 0) + (g.home.score ?? 0), 0);
  const base = CBB_PRIOR_AVG || DEFAULT_AVG;
  // early on the average is mostly last season's
  const avg = (base * 300 + seasonSum) / (300 + scores);

  const ids = new Set<string>();
  for (const g of finals) {
    ids.add(g.home.team.id);
    ids.add(g.away.team.id);
  }
  for (const id of Object.keys(CBB_PRIOR)) ids.add(id);
  const idList = [...ids];
  const slot = new Map(idList.map((id, i) => [id, i]));
  const T = idList.length;
  const pOff = new Float64Array(T);
  const pDef = new Float64Array(T);
  idList.forEach((id, i) => {
    const [o, d] = priorFor(id);
    pOff[i] = o;
    pDef[i] = d;
  });
  const off = Float64Array.from(pOff);
  const def = Float64Array.from(pDef);
  const n = new Float64Array(T);
  const G = finals.length;
  const hi = new Int32Array(G);
  const ai = new Int32Array(G);
  const hs = new Float64Array(G);
  const as = new Float64Array(G);
  const hh = new Float64Array(G);
  finals.forEach((g, k) => {
    hi[k] = slot.get(g.home.team.id) as number;
    ai[k] = slot.get(g.away.team.id) as number;
    hs[k] = g.home.score as number;
    as[k] = g.away.score as number;
    hh[k] = g.neutral ? 0 : HOME_COURT / 2;
    n[hi[k]] += 1;
    n[ai[k]] += 1;
  });
  if (G) {
    const offSum = new Float64Array(T);
    const defSum = new Float64Array(T);
    for (let iter = 0; iter < 30; iter++) {
      offSum.fill(0);
      defSum.fill(0);
      for (let k = 0; k < G; k++) {
        const H = hi[k];
        const A = ai[k];
        offSum[H] += hs[k] - avg - hh[k] - def[A];
        offSum[A] += as[k] - avg + hh[k] - def[H];
        defSum[A] += hs[k] - avg - hh[k] - off[H];
        defSum[H] += as[k] - avg + hh[k] - off[A];
      }
      for (let i = 0; i < T; i++) {
        off[i] = (offSum[i] + PRIOR_WEIGHT * pOff[i]) / (n[i] + PRIOR_WEIGHT);
        def[i] = (defSum[i] + PRIOR_WEIGHT * pDef[i]) / (n[i] + PRIOR_WEIGHT);
      }
    }
  }
  const out: RatingTable = { avg, off: new Map(), def: new Map(), games: new Map() };
  idList.forEach((id, i) => {
    out.off.set(id, off[i]);
    out.def.set(id, def[i]);
    out.games.set(id, n[i]);
  });
  return out;
}

export interface Prediction {
  home: number;
  away: number;
  /** Home margin (positive = home wins). */
  margin: number;
  total: number;
  homeWinProb: number;
}

export function predictGame(r: RatingTable, homeId: string, awayId: string, neutral: boolean): Prediction {
  const h = neutral ? 0 : HOME_COURT / 2;
  const [ho, hd] = r.off.has(homeId) ? [r.off.get(homeId) as number, r.def.get(homeId) as number] : priorFor(homeId);
  const [ao, ad] = r.off.has(awayId) ? [r.off.get(awayId) as number, r.def.get(awayId) as number] : priorFor(awayId);
  const home = r.avg + ho + ad + h;
  const away = r.avg + ao + hd - h;
  const margin = home - away;
  return { home, away, margin, total: home + away, homeWinProb: normCdf(margin / MARGIN_SD) };
}

/** Ratings as table rows: offense / defense in points per game, net = off − def (per game vs an average team). */
export function ratingRows(r: RatingTable, only?: Set<string>) {
  return [...r.off.keys()]
    .filter((id) => !only || only.has(id))
    .map((id) => {
      const offense = r.avg + (r.off.get(id) ?? 0);
      const defense = r.avg + (r.def.get(id) ?? 0);
      return { teamId: id, offense, defense, net: offense - defense, games: r.games.get(id) ?? 0 };
    })
    .sort((a, b) => b.net - a.net)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/* ---------- graded picks ---------- */

export type PickResult = "win" | "loss" | "push";

export interface CbbModelRow {
  game: CbbGame;
  pred: Prediction;
  moneyline: { pick: "home" | "away"; prob: number; result: PickResult | null; units: number | null };
  spread: { pick: "home" | "away"; line: number; edge: number; result: PickResult | null } | null;
  total: { pick: "over" | "under"; line: number; edge: number; result: PickResult | null } | null;
}

const toResult = (won: boolean, push = false): PickResult => (push ? "push" : won ? "win" : "loss");

function mlUnits(pickHome: boolean, game: CbbGame, result: PickResult | null): number | null {
  if (!result) return null;
  const price = pickHome ? game.odds?.mlHome : game.odds?.mlAway;
  if (price === null || price === undefined) return null;
  if (result === "push") return 0;
  if (result === "loss") return -1;
  return price > 0 ? price / 100 : 100 / -price;
}

export function rowFor(game: CbbGame, pred: Prediction): CbbModelRow {
  const pickHome = pred.margin >= 0;
  const winner = winnerOf(game);
  const mlResult = winner ? toResult(winner === (pickHome ? "home" : "away")) : null;
  let spread: CbbModelRow["spread"] = null;
  const line = game.odds?.spread;
  if (line !== null && line !== undefined) {
    const edge = pred.margin + line; // > 0: the model likes home against the number
    if (Math.abs(edge) >= SPREAD_PICK_MIN) {
      const pick = edge > 0 ? "home" : "away";
      const res = atsResult(game, line);
      spread = { pick, line, edge: Math.abs(edge), result: res ? toResult(res === pick, res === "push") : null };
    }
  }
  let total: CbbModelRow["total"] = null;
  const tl = game.odds?.total;
  if (tl !== null && tl !== undefined) {
    const edge = pred.total - tl;
    if (Math.abs(edge) >= TOTAL_PICK_MIN) {
      const pick = edge > 0 ? "over" : "under";
      const res = ouResult(game, tl);
      total = { pick, line: tl, edge: Math.abs(edge), result: res ? toResult(res === pick, res === "push") : null };
    }
  }
  return {
    game,
    pred,
    moneyline: {
      pick: pickHome ? "home" : "away",
      prob: pickHome ? pred.homeWinProb : 1 - pred.homeWinProb,
      result: mlResult,
      units: mlUnits(pickHome, game, mlResult),
    },
    spread,
    total,
  };
}

/**
 * Model rows for every game. Finished games are predicted from the games before their day only;
 * unfinished games use everything played so far.
 */
export function runCbbModel(games: CbbGame[]): CbbModelRow[] {
  const usable = games.filter((g) => g.status !== "postponed");
  const finals = usable
    .filter((g) => g.status === "final" && hasScore(g))
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows: CbbModelRow[] = [];
  const byDay = new Map<string, CbbGame[]>();
  for (const g of finals) {
    const day = etDayKey(g.date);
    const list = byDay.get(day);
    if (list) list.push(g);
    else byDay.set(day, [g]);
  }
  let cursor = 0;
  for (const [day, dayGames] of byDay) {
    while (cursor < finals.length && etDayKey(finals[cursor].date) < day) cursor++;
    const table = buildRatings(finals.slice(0, cursor));
    for (const g of dayGames) rows.push(rowFor(g, predictGame(table, g.home.team.id, g.away.team.id, g.neutral)));
  }
  const now = buildRatings(finals);
  for (const g of usable.filter((x) => x.status !== "final" || !hasScore(x)))
    rows.push(rowFor(g, predictGame(now, g.home.team.id, g.away.team.id, g.neutral)));
  return rows.sort((a, b) => a.game.date.localeCompare(b.game.date));
}

export interface CbbRecord {
  wins: number;
  losses: number;
  pushes: number;
  units: number;
}

export interface CbbSeasonGrade {
  moneyline: CbbRecord;
  spread: CbbRecord;
  total: CbbRecord;
  /** Finished games graded. */
  games: number;
  avgPoints: number | null;
  avgLine: number | null;
}

const empty = (): CbbRecord => ({ wins: 0, losses: 0, pushes: 0, units: 0 });
export const winPct = (r: CbbRecord) => (r.wins + r.losses ? (r.wins / (r.wins + r.losses)) * 100 : null);

/** The season's record: winners at the closing moneyline, spread and total picks at -110. */
export function gradeCbbSeason(rows: CbbModelRow[], before?: Date): CbbSeasonGrade {
  const out: CbbSeasonGrade = { moneyline: empty(), spread: empty(), total: empty(), games: 0, avgPoints: null, avgLine: null };
  let pts = 0;
  let line = 0;
  let nLine = 0;
  for (const r of rows) {
    const g = r.game;
    if (g.status !== "final" || !hasScore(g)) continue;
    if (before && Date.parse(g.date) > before.getTime()) continue;
    out.games++;
    pts += (g.home.score as number) + (g.away.score as number);
    if (g.odds?.total != null) {
      line += g.odds.total;
      nLine++;
    }
    const ml = r.moneyline;
    if (ml.result && ml.units !== null) {
      ml.result === "win" ? out.moneyline.wins++ : ml.result === "loss" ? out.moneyline.losses++ : out.moneyline.pushes++;
      out.moneyline.units += ml.units;
    }
    for (const [pick, rec] of [
      [r.spread, out.spread],
      [r.total, out.total],
    ] as const) {
      if (!pick?.result) continue;
      if (pick.result === "win") {
        rec.wins++;
        rec.units += WIN_UNITS;
      } else if (pick.result === "loss") {
        rec.losses++;
        rec.units -= 1;
      } else rec.pushes++;
    }
  }
  out.avgPoints = out.games ? pts / out.games : null;
  out.avgLine = nLine ? line / nLine : null;
  for (const rec of [out.moneyline, out.spread, out.total]) rec.units = Math.round(rec.units * 100) / 100;
  return out;
}

export const unitsText = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;
