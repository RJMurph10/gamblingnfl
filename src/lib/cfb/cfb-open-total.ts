/**
 * College football ★ totals against the OPENING total (research/football/scripts/cfb_totals_open.py,
 * claude/cfb-totals-open.md). Each game's projected total is a 50/50 blend of
 *  - a points model: FBS offense / defense ratings from this season's earlier weeks (a game's weight
 *    falls e^(−weeks ago / 8)), last season's end-of-year ratings carried in at 60% as a 4-game prior;
 *  - a market model: the same ratings fit to earlier games' CLOSING lines (each game's total and spread
 *    turned into the two teams' implied points), weight e^(−weeks ago / 5).
 * From week 3, when the blend is 4+ points from the opener, bet that side at the opener. FBS vs FBS
 * regular season: 2018–25 571-437 (56.6%), every season positive; 2013–17 flat (51.2%). Pure functions.
 */
import { gameScore, type Game } from "@/data/shared/games";
import type { PriorResult } from "../shared/game-model";
import { homeLine } from "../shared/season-pulse";

export const OPEN_TOTAL = { minEdge: 4, fromWeek: 3 } as const;

interface Obs {
  home: string;
  away: string;
  hs: number;
  as: number;
  w: number;
}
interface Ratings {
  off: Map<string, number>;
  def: Map<string, number>;
}

const HOME = 1.0;

function fit(
  obs: Obs[],
  prior: Ratings | null,
  carry: number,
  pw: number,
  avg: number,
  iters = 25,
): Ratings {
  const teams = new Set<string>();
  for (const o of obs) teams.add(o.home).add(o.away);
  if (prior) for (const t of prior.off.keys()) teams.add(t);
  const po = new Map([...teams].map((t) => [t, carry * (prior?.off.get(t) ?? 0)]));
  const pd = new Map([...teams].map((t) => [t, carry * (prior?.def.get(t) ?? 0)]));
  let off = new Map(po);
  let def = new Map(pd);
  const ws = new Map<string, number>();
  for (const o of obs) {
    ws.set(o.home, (ws.get(o.home) ?? 0) + o.w);
    ws.set(o.away, (ws.get(o.away) ?? 0) + o.w);
  }
  for (let i = 0; i < iters; i++) {
    const os = new Map<string, number>();
    const ds = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    for (const o of obs) {
      add(os, o.home, o.w * (o.hs - avg - HOME - (def.get(o.away) ?? 0)));
      add(os, o.away, o.w * (o.as - avg + HOME - (def.get(o.home) ?? 0)));
      add(ds, o.away, o.w * (o.hs - avg - HOME - (off.get(o.home) ?? 0)));
      add(ds, o.home, o.w * (o.as - avg + HOME - (off.get(o.away) ?? 0)));
    }
    const no = new Map<string, number>();
    const nd = new Map<string, number>();
    for (const t of teams) {
      const k = ws.get(t) ?? 0;
      no.set(t, ((os.get(t) ?? 0) + pw * (po.get(t) ?? 0)) / (k + pw));
      nd.set(t, ((ds.get(t) ?? 0) + pw * (pd.get(t) ?? 0)) / (k + pw));
    }
    off = no;
    def = nd;
  }
  return { off, def };
}

const wMean = (obs: Obs[]) => {
  let s = 0;
  let w = 0;
  for (const o of obs) {
    s += o.w * (o.hs + o.as);
    w += 2 * o.w;
  }
  return w ? s / w : null;
};

const project = (r: Ratings, avg: number, g: Game) =>
  2 * avg +
  (r.off.get(g.homeTeamId) ?? 0) +
  (r.def.get(g.awayTeamId) ?? 0) +
  (r.off.get(g.awayTeamId) ?? 0) +
  (r.def.get(g.homeTeamId) ?? 0);

const fbsRegular = (g: Game) => !g.fcs && !g.postseason;

/** Blended projected total for each FBS regular-season game from week 3 on. */
export function openTotalProjections(
  games: Game[],
  priorSeason: PriorResult[],
): Map<string, number> {
  const last: Obs[] = priorSeason.map((p) => ({
    home: p.homeTeamId,
    away: p.awayTeamId,
    hs: p.homeScore,
    as: p.awayScore,
    w: 1,
  }));
  const lastAvg = wMean(last) ?? 28;
  const prior = last.length ? fit(last, null, 0, 1, lastAvg) : null;
  const season = games.filter(fbsRegular);
  const out = new Map<string, number>();
  const weeks = [...new Set(season.map((g) => g.week))].sort((a, b) => a - b);
  for (const wk of weeks) {
    if (wk < OPEN_TOTAL.fromWeek) continue;
    const before = season.filter((g) => g.week < wk && g.status === "final");
    // points model
    const pts: Obs[] = before.map((g) => {
      const s = gameScore(g);
      return {
        home: g.homeTeamId,
        away: g.awayTeamId,
        hs: s.home,
        as: s.away,
        w: Math.exp(-(wk - g.week) / 8),
      };
    });
    const n = Math.min(2 * pts.length, 200);
    const avg = (lastAvg * 16 + (wMean(pts) ?? lastAvg) * n) / (16 + n);
    const rp = fit(pts, prior, 0.6, 4, avg);
    // market model: earlier games' closing total and spread → implied points
    const mkt: Obs[] = [];
    for (const g of before) {
      const line = homeLine(g);
      if (!g.total || g.total <= 0 || line === null) continue;
      mkt.push({
        home: g.homeTeamId,
        away: g.awayTeamId,
        hs: g.total / 2 - line / 2,
        as: g.total / 2 + line / 2,
        w: Math.exp(-(wk - g.week) / 5),
      });
    }
    const mAvg = wMean(mkt) ?? lastAvg;
    const rm = fit(mkt, null, 0, 3, mAvg);
    for (const g of season.filter((x) => x.week === wk))
      out.set(g.id, Math.round((0.5 * project(rp, avg, g) + 0.5 * project(rm, mAvg, g)) * 10) / 10);
  }
  return out;
}
