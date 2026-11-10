/**
 * Watch-list angle "big total gap": a points-only team model 6+ points away from the OPENING total.
 * Research (claude/nfl-totals-open.md; SBR openers 2011-21, ESPN 2023-26, week 3 on): 105-78 (57.4%,
 * +17.5u), about 13 bets a season, 12 of 15 seasons profitable; the line moved toward the pick 75% of
 * the time, and the same picks at the closing total won only 53%, so it's a bet-early angle. The NFL
 * opener is sharp (the model is less accurate overall), so only the big disagreements are tracked.
 *
 * Model (same as the research, research/football/scripts/nfl_totals_open.py): offense / defense points
 * ratings fit on this season's finished games before the week (all games weighted equally), each team's
 * end-of-last-season rating carried in at 60% as a prior worth 6 games; league scoring = last season's
 * average blended with this season's. Pure functions.
 */
import { gameScore, type Game } from "@/data/shared/games";

export const TOTAL_GAP = { minEdge: 6, fromWeek: 3, carry: 0.6, priorGames: 6, home: 1.0 } as const;

interface Pts {
  home: string;
  away: string;
  hs: number;
  as: number;
}

interface Ratings {
  off: Map<string, number>;
  def: Map<string, number>;
  avg: number;
}

function fit(
  games: Pts[],
  prior: Ratings | null,
  carry: number,
  pw: number,
  avg: number,
  iters = 25,
): Ratings {
  const teams = new Set<string>();
  for (const g of games) teams.add(g.home).add(g.away);
  if (prior) for (const t of prior.off.keys()) teams.add(t);
  const po = new Map([...teams].map((t) => [t, carry * (prior?.off.get(t) ?? 0)]));
  const pd = new Map([...teams].map((t) => [t, carry * (prior?.def.get(t) ?? 0)]));
  let off = new Map(po);
  let def = new Map(pd);
  const h = TOTAL_GAP.home;
  for (let i = 0; i < iters; i++) {
    const os = new Map<string, number>();
    const ds = new Map<string, number>();
    const n = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    for (const g of games) {
      add(os, g.home, g.hs - avg - h - (def.get(g.away) ?? 0));
      add(os, g.away, g.as - avg + h - (def.get(g.home) ?? 0));
      add(ds, g.away, g.hs - avg - h - (off.get(g.home) ?? 0));
      add(ds, g.home, g.as - avg + h - (off.get(g.away) ?? 0));
      add(n, g.home, 1);
      add(n, g.away, 1);
    }
    const no = new Map<string, number>();
    const nd = new Map<string, number>();
    for (const t of teams) {
      const k = n.get(t) ?? 0;
      no.set(t, ((os.get(t) ?? 0) + pw * (po.get(t) ?? 0)) / (k + pw));
      nd.set(t, ((ds.get(t) ?? 0) + pw * (pd.get(t) ?? 0)) / (k + pw));
    }
    off = no;
    def = nd;
  }
  return { off, def, avg };
}

const finished = (g: Game): Pts | null => {
  if (g.status !== "final") return null;
  const s = gameScore(g);
  return Number.isFinite(s.home) && Number.isFinite(s.away)
    ? { home: g.homeTeamId, away: g.awayTeamId, hs: s.home, as: s.away }
    : null;
};

/** Each game's points-only projected total (this season's schedule), from week `fromWeek` on. */
export function gapProjections(schedule: Game[], lastSeason: Game[]): Map<string, number> {
  const last = lastSeason.map(finished).filter((x): x is Pts => !!x);
  const lastAvg = last.length ? last.reduce((s, g) => s + g.hs + g.as, 0) / (2 * last.length) : 22;
  const prior = last.length ? fit(last, null, 0, 1, lastAvg) : null;
  const out = new Map<string, number>();
  const weeks = [...new Set(schedule.map((g) => g.week))].sort((a, b) => a - b);
  for (const wk of weeks) {
    if (wk < TOTAL_GAP.fromWeek) continue;
    const past = schedule
      .filter((g) => g.week < wk)
      .map(finished)
      .filter((x): x is Pts => !!x);
    const n = 2 * past.length;
    const mean = n ? past.reduce((s, g) => s + g.hs + g.as, 0) / n : lastAvg;
    const k = Math.min(n, 200);
    const avg = (lastAvg * 16 + mean * k) / (16 + k);
    const r = fit(past, prior, TOTAL_GAP.carry, TOTAL_GAP.priorGames, avg);
    for (const g of schedule.filter((x) => x.week === wk)) {
      const t =
        2 * r.avg +
        (r.off.get(g.homeTeamId) ?? 0) +
        (r.def.get(g.awayTeamId) ?? 0) +
        (r.off.get(g.awayTeamId) ?? 0) +
        (r.def.get(g.homeTeamId) ?? 0);
      out.set(g.id, Math.round(t * 10) / 10);
    }
  }
  return out;
}
