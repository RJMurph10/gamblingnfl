/**
 * Replays the site's NBA model (src/lib/nba/nba-model.ts, unchanged) on past seasons, walk-forward:
 * each game is predicted only from games before its day, with last season's scoring as the prior,
 * exactly like the live site. Writes one row per game for the analysis scripts.
 *
 *   node research/nba/scripts/run-ts.cjs research/nba/scripts/replay.ts <games.csv> <open|close> <out.csv>
 */
import fs from "node:fs";
import { runNbaModel } from "@/lib/nba/nba-model";
import type { NbaGame, NbaPriorTeam } from "@/lib/nba/nba";

const [, , inFile, which, outFile] = process.argv;
const lines = fs.readFileSync(inFile, "utf8").trim().split("\n");
const head = lines[0].split(",");
const rows = lines.slice(1).map((l) => {
  const v = l.split(",");
  return Object.fromEntries(head.map((h, i) => [h, v[i]]));
});
const num = (s: string | undefined) => (s === undefined || s === "" ? null : Number(s));

const team = (abbr: string) => ({ id: abbr, abbr, name: abbr, shortName: abbr, displayName: abbr, logo: "", color: "" }) as any;
function toGame(r: Record<string, string>, i: number): NbaGame {
  const spread = which === "open" ? num(r.spread_open) : num(r.spread_close);
  const total = which === "open" ? num(r.total_open) : num(r.total_close);
  return {
    id: `g${i}`,
    date: `${r.date}T23:30:00Z`,
    status: "final",
    statusDetail: "Final",
    period: 4,
    clock: "",
    part: "reg",
    home: { team: team(r.home), score: Number(r.home_pts), periods: [] },
    away: { team: team(r.away), score: Number(r.away_pts), periods: [] },
    odds: { spread, total, mlHome: num(r.ml_home), mlAway: num(r.ml_away) },
  } as NbaGame;
}

const seasons = [...new Set(rows.map((r) => Number(r.season)))].sort((a, b) => a - b);
const out: string[] = [
  "season,date,home,away,home_pts,away_pts,line_spread,line_total,ml_home,ml_away,pred_home,pred_away,pred_margin,pred_total,home_win_prob,ml_pick,ml_result,ml_units,sp_pick,sp_edge,sp_best,sp_result,to_pick,to_edge,to_best,to_result",
];
let prior: NbaPriorTeam[] = [];
for (const season of seasons) {
  const games = rows.map((r, i) => [r, i] as const).filter(([r]) => Number(r.season) === season).map(([r, i]) => toGame(r, i));
  const modelRows = runNbaModel(games, prior);
  for (const m of modelRows) {
    const g = m.game;
    const r = rows[Number(g.id.slice(1))];
    out.push(
      [
        season, r.date, r.home, r.away, r.home_pts, r.away_pts, g.odds?.spread ?? "", g.odds?.total ?? "", r.ml_home, r.ml_away,
        m.pred.home.toFixed(3), m.pred.away.toFixed(3), m.pred.margin.toFixed(3), m.pred.total.toFixed(3), m.pred.homeWinProb.toFixed(4),
        m.moneyline.pick, m.moneyline.result ?? "", m.moneyline.units ?? "",
        m.spread?.pick ?? "", m.spread?.edge.toFixed(3) ?? "", m.spread ? (m.spread.best ? 1 : 0) : "", m.spread?.result ?? "",
        m.total?.pick ?? "", m.total?.edge.toFixed(3) ?? "", m.total ? (m.total.best ? 1 : 0) : "", m.total?.result ?? "",
      ].join(","),
    );
  }
  // last season's scoring per team becomes next season's prior (what the site gets from ESPN)
  const agg = new Map<string, { pts: number; opp: number; n: number }>();
  for (const g of games) {
    for (const [t, p, o] of [
      [g.home.team.id, g.home.score!, g.away.score!],
      [g.away.team.id, g.away.score!, g.home.score!],
    ] as const) {
      const a = agg.get(t) ?? { pts: 0, opp: 0, n: 0 };
      a.pts += p;
      a.opp += o;
      a.n++;
      agg.set(t, a);
    }
  }
  prior = [...agg].map(([teamId, a]) => ({ teamId, ppg: a.pts / a.n, oppPpg: a.opp / a.n, games: a.n }));
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log(`wrote ${out.length - 1} rows to ${outFile}`);
