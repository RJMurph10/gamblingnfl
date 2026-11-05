/**
 * The men's college basketball model (v2): tempo-free team ratings, game predictions and graded picks.
 *
 * Ratings, per possession like KenPom: every team has an offense and a defense rating (points per 100
 * possessions above / below the Division I average, adjusted for opponent, home court and neutral
 * sites) and a tempo rating (possessions per game above / below average). A game's possessions come
 * from its box score (FGA − OREB + TO + 0.475 × FTA, the two teams averaged). Ratings start from last
 * season's (src/data/cbb/prior-ratings.ts, 75% kept since rosters turn over; 70% of tempo), count recent
 * games more (a game's weight halves every 30 days), and count games against non-Division I schools a
 * quarter as much. A finished game is predicted only from games before its day.
 *
 * Research (research/cbb/model_v2.py, every D-I game 2019-20 to 2025-26): on spreads and moneylines the
 * model doesn't beat the market. On totals it does, against the OPENING total: when the model is 6+
 * points off the opener the pick hit 55.8% (2023-24), 55.7% (2024-25) and 53.0% (2025-26), break-even
 * being 52.4%. Against the closing total the same picks hit only 50–52%: the model sees where the total
 * will move, so the bet has to be made early.
 *
 * v3 (research/cbb/v3_market.py): projections are blended 50/50 with the market's own view of each team
 * (ratings fit to earlier games' closing lines). Once both teams have 3+ games, totals 6+ points off the
 * opener hit 58.1%, 57.2% and 59.0% (265 / 276 / 459 bets), at the close 50–51%. Those are the ★ best
 * bets, graded at the opener. Spreads with the blend: 51%, 55%, 57% at 6+ pts, not every season, so not ★.
 */
import { CBB_PRIOR, CBB_PRIOR_EFF, CBB_PRIOR_TEMPO } from "@/data/cbb/prior-ratings";
import { atsResult, etDayKey, hasScore, normCdf, ouResult, winnerOf, type CbbGame } from "./cbb";

/** Home court, in points per 100 possessions (about 2.8 points a game at average tempo). */
export const HOME_COURT_EFF = 4.0;
/** Games' worth of weight last season's rating counts as. */
const PRIOR_WEIGHT = 5;
const PRIOR_SHRINK = 0.75;
const TEMPO_SHRINK = 0.7;
/** Teams with no rating last season start this far below average (per 100 possessions, net). */
const NEW_TEAM = 15;
/** A game's weight halves every this many days. */
const HALF_LIFE_DAYS = 30;
/** Games against non-Division I schools count this much. */
const NON_D1_WEIGHT = 0.25;
export const MARGIN_SD = 11;

export const SPREAD_PICK_MIN = 2;
export const TOTAL_PICK_MIN = 3;
/** ★ best bet: the model total this far from the opening total. */
export const BEST_TOTAL_EDGE = 6;
/**
 * Share of the projection taken from the market's own view of each team (ratings fit to earlier
 * games' closing lines); the rest is the efficiency model. 50/50 made the totals edge sharper in every
 * season tested and projections closer to the final score than either alone.
 */
export const MARKET_WEIGHT = 0.5;
/** Market ratings need this many earlier games for both teams (until then: no ★). */
const MARKET_MIN_GAMES = 3;
const MARKET_HOME = 2.8;
const WIN_UNITS = 100 / 110;
const DAY_MS = 86_400_000;

export interface RatingTable {
  /** Average points per 100 possessions and possessions per game. */
  avg: number;
  tempo: number;
  off: Map<string, number>;
  def: Map<string, number>;
  pace: Map<string, number>;
  games: Map<string, number>;
}

function priorFor(id: string): [number, number, number] {
  const p = CBB_PRIOR[id];
  return p ? [PRIOR_SHRINK * p[0], PRIOR_SHRINK * p[1], TEMPO_SHRINK * p[2]] : [-NEW_TEAM / 2, NEW_TEAM / 2, 0];
}

/** Possessions in a game: from the box score when known, else estimated from the score. */
function possessionsOf(g: CbbGame, avgEff: number): number {
  const p = g.possessions;
  if (p && p >= 45 && p <= 110) return p;
  return ((g.home.score as number) + (g.away.score as number)) / 2 / (avgEff / 100);
}

/** Ratings from finished games, as of `asOf` (for the recency weights; default: the newest game). */
export function buildRatings(finals: CbbGame[], asOf?: number): RatingTable {
  const baseEff = CBB_PRIOR_EFF || 105;
  const baseTempo = CBB_PRIOR_TEMPO || 68;
  const ids = new Set<string>(Object.keys(CBB_PRIOR));
  for (const g of finals) {
    ids.add(g.home.team.id);
    ids.add(g.away.team.id);
  }
  const idList = [...ids];
  const slot = new Map(idList.map((id, i) => [id, i]));
  const T = idList.length;
  const pOff = new Float64Array(T);
  const pDef = new Float64Array(T);
  const pPace = new Float64Array(T);
  idList.forEach((id, i) => {
    [pOff[i], pDef[i], pPace[i]] = priorFor(id);
  });
  const off = Float64Array.from(pOff);
  const def = Float64Array.from(pDef);
  const pace = Float64Array.from(pPace);
  const n = new Float64Array(T);
  const played = new Float64Array(T);
  const G = finals.length;
  const out: RatingTable = { avg: baseEff, tempo: baseTempo, off: new Map(), def: new Map(), pace: new Map(), games: new Map() };
  if (G) {
    const now = asOf ?? Math.max(...finals.map((g) => Date.parse(g.date)));
    const hi = new Int32Array(G);
    const ai = new Int32Array(G);
    const eh = new Float64Array(G);
    const ea = new Float64Array(G);
    const ps = new Float64Array(G);
    const hh = new Float64Array(G);
    const w = new Float64Array(G);
    let wSum = 0;
    let effSum = 0;
    let possSum = 0;
    finals.forEach((g, k) => {
      hi[k] = slot.get(g.home.team.id) as number;
      ai[k] = slot.get(g.away.team.id) as number;
      ps[k] = possessionsOf(g, baseEff);
      eh[k] = ((g.home.score as number) / ps[k]) * 100;
      ea[k] = ((g.away.score as number) / ps[k]) * 100;
      hh[k] = g.neutral ? 0 : HOME_COURT_EFF / 2;
      const age = Math.max(0, (now - Date.parse(g.date)) / DAY_MS);
      w[k] = Math.pow(0.5, age / HALF_LIFE_DAYS) * (g.nonDivisionI ? NON_D1_WEIGHT : 1);
      n[hi[k]] += w[k];
      n[ai[k]] += w[k];
      played[hi[k]] += 1;
      played[ai[k]] += 1;
      wSum += w[k];
      effSum += w[k] * (eh[k] + ea[k]);
      possSum += w[k] * ps[k];
    });
    // early on the averages are mostly last season's
    const avg = (effSum / 2 + baseEff * 200) / (wSum + 200);
    const tempo = (possSum + baseTempo * 100) / (wSum + 100);
    out.avg = avg;
    out.tempo = tempo;
    const oS = new Float64Array(T);
    const dS = new Float64Array(T);
    const tS = new Float64Array(T);
    for (let iter = 0; iter < 30; iter++) {
      oS.fill(0);
      dS.fill(0);
      tS.fill(0);
      for (let k = 0; k < G; k++) {
        const H = hi[k];
        const A = ai[k];
        const wk = w[k];
        oS[H] += wk * (eh[k] - avg - hh[k] - def[A]);
        oS[A] += wk * (ea[k] - avg + hh[k] - def[H]);
        dS[A] += wk * (eh[k] - avg - hh[k] - off[H]);
        dS[H] += wk * (ea[k] - avg + hh[k] - off[A]);
        tS[H] += wk * (ps[k] - tempo - pace[A]);
        tS[A] += wk * (ps[k] - tempo - pace[H]);
      }
      for (let i = 0; i < T; i++) {
        off[i] = (oS[i] + PRIOR_WEIGHT * pOff[i]) / (n[i] + PRIOR_WEIGHT);
        def[i] = (dS[i] + PRIOR_WEIGHT * pDef[i]) / (n[i] + PRIOR_WEIGHT);
        pace[i] = (tS[i] + PRIOR_WEIGHT * pPace[i]) / (n[i] + PRIOR_WEIGHT);
      }
    }
  }
  idList.forEach((id, i) => {
    out.off.set(id, off[i]);
    out.def.set(id, def[i]);
    out.pace.set(id, pace[i]);
    out.games.set(id, played[i]);
  });
  return out;
}

export interface Prediction {
  home: number;
  away: number;
  /** Home margin (positive = home wins). */
  margin: number;
  total: number;
  /** Expected possessions. */
  possessions: number;
  homeWinProb: number;
}

export function predictGame(r: RatingTable, homeId: string, awayId: string, neutral: boolean): Prediction {
  const h = neutral ? 0 : HOME_COURT_EFF / 2;
  const get = (id: string): [number, number, number] =>
    r.off.has(id) ? [r.off.get(id) as number, r.def.get(id) as number, r.pace.get(id) as number] : priorFor(id);
  const [ho, hd, ht] = get(homeId);
  const [ao, ad, at] = get(awayId);
  const possessions = r.tempo + ht + at;
  const home = ((r.avg + ho + ad + h) * possessions) / 100;
  const away = ((r.avg + ao + hd - h) * possessions) / 100;
  const margin = home - away;
  return { home, away, margin, total: home + away, possessions, homeWinProb: normCdf(margin / MARGIN_SD) };
}

/**
 * Ratings as table rows: offense / defense in points per 100 possessions, net = off − def (per 100
 * possessions against an average Division I team on a neutral court), tempo in possessions per game.
 */
export function ratingRows(r: RatingTable, only?: Set<string>) {
  return [...r.off.keys()]
    .filter((id) => !only || only.has(id))
    .map((id) => {
      const offense = r.avg + (r.off.get(id) ?? 0);
      const defense = r.avg + (r.def.get(id) ?? 0);
      return {
        teamId: id,
        offense,
        defense,
        net: offense - defense,
        tempo: r.tempo + (r.pace.get(id) ?? 0),
        games: r.games.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.net - a.net)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/* ---------- the market's view: ratings fit to earlier closing lines ---------- */

export interface MarketTable {
  /** Average closing total. */
  mu: number;
  margin: Map<string, number>;
  total: Map<string, number>;
  /** Earlier games played (any, for the MARKET_MIN_GAMES check). */
  games: Map<string, number>;
  /** False until there are enough closing lines to fit. */
  ready: boolean;
}

/**
 * Each team's rating as the market sees it, from earlier games' closing lines (recent ones count more):
 * closing home spread ≈ −(margin_home − margin_away + home court), closing total ≈ mu + total_home + total_away.
 */
export function buildMarketRatings(finals: CbbGame[], asOf: number): MarketTable {
  const out: MarketTable = { mu: 145, margin: new Map(), total: new Map(), games: new Map(), ready: false };
  for (const g of finals) {
    out.games.set(g.home.team.id, (out.games.get(g.home.team.id) ?? 0) + 1);
    out.games.set(g.away.team.id, (out.games.get(g.away.team.id) ?? 0) + 1);
  }
  const ids = [...out.games.keys()];
  const slot = new Map(ids.map((id, i) => [id, i]));
  const T = ids.length;
  const fitOne = (kind: "margin" | "total") => {
    const lined = finals.filter((g) => (kind === "margin" ? g.odds?.spread : g.odds?.total) != null);
    if (lined.length <= 50) return null;
    const G = lined.length;
    const H = new Int32Array(G);
    const A = new Int32Array(G);
    const y = new Float64Array(G);
    const hc = new Float64Array(G);
    const w = new Float64Array(G);
    const n = new Float64Array(T);
    let mu = 0;
    lined.forEach((g, k) => {
      H[k] = slot.get(g.home.team.id) as number;
      A[k] = slot.get(g.away.team.id) as number;
      y[k] = kind === "margin" ? -(g.odds!.spread as number) : (g.odds!.total as number);
      hc[k] = g.neutral ? 0 : MARKET_HOME;
      w[k] = Math.pow(0.5, Math.max(0, (asOf - Date.parse(g.date)) / DAY_MS) / HALF_LIFE_DAYS);
      n[H[k]] += w[k];
      n[A[k]] += w[k];
      mu += y[k];
    });
    mu /= G;
    const r = new Float64Array(T);
    const sum = new Float64Array(T);
    for (let iter = 0; iter < 30; iter++) {
      sum.fill(0);
      for (let k = 0; k < G; k++) {
        if (kind === "margin") {
          sum[H[k]] += w[k] * (y[k] - hc[k] + r[A[k]]);
          sum[A[k]] += w[k] * (-(y[k] - hc[k]) + r[H[k]]);
        } else {
          sum[H[k]] += w[k] * (y[k] - mu - r[A[k]]);
          sum[A[k]] += w[k] * (y[k] - mu - r[H[k]]);
        }
      }
      for (let i = 0; i < T; i++) r[i] = sum[i] / (n[i] + 2);
    }
    return { r, mu };
  };
  const m = fitOne("margin");
  const t = fitOne("total");
  if (m) ids.forEach((id, i) => out.margin.set(id, m.r[i]));
  if (t) {
    out.mu = t.mu;
    ids.forEach((id, i) => out.total.set(id, t.r[i]));
  }
  out.ready = Boolean(m && t);
  return out;
}

/** The efficiency projection blended with the market's view, when both teams have enough games. */
export function blendWithMarket(pred: Prediction, mk: MarketTable, homeId: string, awayId: string, neutral: boolean): Prediction & { market: boolean } {
  const enough = mk.ready && (mk.games.get(homeId) ?? 0) >= MARKET_MIN_GAMES && (mk.games.get(awayId) ?? 0) >= MARKET_MIN_GAMES;
  if (!enough) return { ...pred, market: false };
  const mMargin = (mk.margin.get(homeId) ?? 0) - (mk.margin.get(awayId) ?? 0) + (neutral ? 0 : MARKET_HOME);
  const mTotal = mk.mu + (mk.total.get(homeId) ?? 0) + (mk.total.get(awayId) ?? 0);
  const margin = MARKET_WEIGHT * mMargin + (1 - MARKET_WEIGHT) * pred.margin;
  const total = MARKET_WEIGHT * mTotal + (1 - MARKET_WEIGHT) * pred.total;
  return {
    ...pred,
    margin,
    total,
    home: (total + margin) / 2,
    away: (total - margin) / 2,
    homeWinProb: normCdf(margin / MARGIN_SD),
    market: true,
  };
}

/* ---------- graded picks ---------- */

export type PickResult = "win" | "loss" | "push";

export interface CbbModelRow {
  game: CbbGame;
  pred: Prediction;
  moneyline: { pick: "home" | "away"; prob: number; result: PickResult | null; units: number | null };
  spread: { pick: "home" | "away"; line: number; edge: number; result: PickResult | null } | null;
  total: { pick: "over" | "under"; line: number; edge: number; result: PickResult | null } | null;
  /**
   * ★ best bet: the total, when the model is BEST_TOTAL_EDGE+ points from the opening total (graded at
   * the opener, which is when it has to be bet).
   */
  best: { pick: "over" | "under"; line: number; edge: number; result: PickResult | null } | null;
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
  let best: CbbModelRow["best"] = null;
  const opener = game.open?.total ?? null;
  // ★ only once the market's view is in the projection (both teams have a few games)
  const blended = (pred as Prediction & { market?: boolean }).market !== false;
  if (opener !== null && !game.nonDivisionI && blended) {
    const edge = pred.total - opener;
    if (Math.abs(edge) >= BEST_TOTAL_EDGE) {
      const pick = edge > 0 ? "over" : "under";
      const res = ouResult(game, opener);
      best = { pick, line: opener, edge: Math.abs(edge), result: res ? toResult(res === pick, res === "push") : null };
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
    best,
  };
}

const project = (table: RatingTable, market: MarketTable, g: CbbGame) =>
  blendWithMarket(predictGame(table, g.home.team.id, g.away.team.id, g.neutral), market, g.home.team.id, g.away.team.id, g.neutral);

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
    const at = Date.parse(dayGames[0].date);
    const before = finals.slice(0, cursor);
    const table = buildRatings(before, at);
    const market = buildMarketRatings(before, at);
    for (const g of dayGames) rows.push(rowFor(g, project(table, market, g)));
  }
  const now = buildRatings(finals, Date.now());
  const marketNow = buildMarketRatings(finals, Date.now());
  for (const g of usable.filter((x) => x.status !== "final" || !hasScore(x))) rows.push(rowFor(g, project(now, marketNow, g)));
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
  /** ★ best bets (totals 6+ points off the opener), graded at the opening total. */
  best: CbbRecord;
  /** Finished games graded. */
  games: number;
  avgPoints: number | null;
  avgLine: number | null;
}

const empty = (): CbbRecord => ({ wins: 0, losses: 0, pushes: 0, units: 0 });
export const winPct = (r: CbbRecord) => (r.wins + r.losses ? (r.wins / (r.wins + r.losses)) * 100 : null);

/** The season's record: winners at the closing moneyline, spread and total picks at -110. */
export function gradeCbbSeason(rows: CbbModelRow[], before?: Date): CbbSeasonGrade {
  const out: CbbSeasonGrade = { moneyline: empty(), spread: empty(), total: empty(), best: empty(), games: 0, avgPoints: null, avgLine: null };
  let pts = 0;
  let line = 0;
  let nLine = 0;
  for (const r of rows) {
    const g = r.game;
    if (g.status !== "final" || !hasScore(g)) continue;
    // games against non-Division I schools are left out of the record (no lines, near-exhibitions)
    if (g.nonDivisionI) continue;
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
      [r.best, out.best],
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
  for (const rec of [out.moneyline, out.spread, out.total, out.best]) rec.units = Math.round(rec.units * 100) / 100;
  return out;
}

export const unitsText = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;
