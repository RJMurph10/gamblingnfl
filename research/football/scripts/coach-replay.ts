/**
 * The site's NFL model replay (pastSeasonRuns) with and without a head-coach weight.
 * Coach rating = the coach's average cover margin (actual margin minus the closing line) in all his earlier
 * games as a head coach, shrunk toward 0 by K games of evidence. Home margin added = W × (home − away rating).
 * Walk-forward: only games before each game count. Prints ★ best bets and every-game spread calls per season.
 *   node /root/fbdata/sitecheck/run.cjs $PWD research/football/scripts/coach-replay.ts
 */
import { readFileSync } from "node:fs";
import { fetchNflHistory } from "@/lib/nfl/nfl-history.server";
import { pastSeasonRuns, readHistory } from "@/lib/nfl/model-history";

const W100 = 100 / 110;
function parseCsv(text: string) {
  const [head, ...lines] = text.trim().split("\n");
  const cols = head.split(",");
  return lines.map((l) => {
    const v = l.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
}
const games = parseCsv(readFileSync("/root/fbdata/src/nfl_games_now.csv", "utf8"))
  .filter((g) => g.game_type === "REG")
  .sort((a, b) => Number(a.season) - Number(b.season) || Number(a.week) - Number(b.week));

function coachRatings(K: number) {
  const hist = new Map<string, number[]>();
  const before = new Map<number, [number, number]>(); // espn id -> [home coach rating, away coach rating]
  const rating = (c: string) => {
    const h = hist.get(c) ?? [];
    return h.reduce((a, b) => a + b, 0) / (h.length + K);
  };
  let i = 0;
  while (i < games.length) {
    let j = i;
    while (j < games.length && games[j].season === games[i].season && games[j].week === games[i].week) j++;
    const wk = games.slice(i, j);
    for (const g of wk) if (g.espn) before.set(Number(g.espn), [rating(g.home_coach), rating(g.away_coach)]);
    for (const g of wk) {
      const r = Number(g.result), sp = Number(g.spread_line);
      if (g.result === "" || g.spread_line === "" || !Number.isFinite(r) || !Number.isFinite(sp)) continue;
      const cov = r - sp; // home cover margin
      hist.set(g.home_coach, [...(hist.get(g.home_coach) ?? []), cov]);
      hist.set(g.away_coach, [...(hist.get(g.away_coach) ?? []), -cov]);
    }
    i = j;
  }
  return before;
}

const mlTally = (ps: any[]) => {
  const g = ps.filter((p) => p.result === "win" || p.result === "loss");
  const w = g.filter((p) => p.result === "win").length;
  const u = g.reduce((a, p) => a + (p.units ?? 0), 0);
  return `${w}-${g.length - w} ${u >= 0 ? "+" : ""}${u.toFixed(1)}u (${g.length ? ((100 * u) / g.length).toFixed(1) : "0"}% ROI)`;
};
(async () => {
  const h = readHistory(await fetchNflHistory());
  const all = h.games.filter((g) => g.season < h.currentSeason || h.currentSeason === 0);
  const tally = (picks: { result: string }[]) => {
    const w = picks.filter((p) => p.result === "win").length;
    const l = picks.filter((p) => p.result === "loss").length;
    return `${w}-${l} ${((100 * w) / Math.max(1, w + l)).toFixed(1)}% ${w * W100 - l >= 0 ? "+" : ""}${(w * W100 - l).toFixed(1)}u`;
  };
  const variants: [string, ((id: number) => number) | undefined][] = [["no coach (site today)", undefined]];
  for (const [K, W] of [[40, 1], [40, 0.5], [80, 1]] as const) {
    const r = coachRatings(K);
    variants.push([`coach K=${K} W=${W}`, (id) => {
      const x = r.get(id);
      return x ? W * (x[0] - x[1]) : 0;
    }]);
  }
  for (const [name, extra] of variants) {
    const runs = pastSeasonRuns(all, { qbRows: h.qbRows, extraMargin: extra });
    const stars: any[] = [], spreads: any[] = [], totals: any[] = [], mls: any[] = [];
    const lines: string[] = [];
    let err = 0, n = 0;
    for (const r of runs) {
      const st = r.rows.flatMap((row) => row.picks);
      const sp = r.rows.flatMap((row) => row.predictions.filter((p: any) => p.market === "spread"));
      const ml = r.rows.flatMap((row) => row.predictions.filter((p: any) => p.market === "moneyline"));
      stars.push(...st); spreads.push(...sp); mls.push(...ml.map((p: any) => ({ ...p, season: r.season })));
      for (const row of r.rows) {
        const p = row.modelPrediction, g = row.game as any;
        if (p && g.status === "final" && g.homeScore != null) { err += Math.abs(-p.homeLine - (g.homeScore - g.awayScore)); n++; }
      }
      if (r.season >= 2015) lines.push(`  ${r.season}: ★ ${tally(st)} | every spread ${tally(sp)} | moneyline ${mlTally(ml)}`);
    }
    const dogs = mls.filter((p) => (p.odds ?? -1) > 0), edge = (e: number) => mls.filter((p) => p.edge >= e);
    console.log(`\n${name}: moneyline picks ${mlTally(mls)} | underdogs ${mlTally(dogs)} | edge 3%+ ${mlTally(edge(0.03))} | edge 6%+ ${mlTally(edge(0.06))}`);
    console.log(`  ${name}: ★ ${tally(stars)} | every-game spread calls ${tally(spreads)} | model margin miss ${(err / Math.max(1, n)).toFixed(2)} (${n} games)`);
    console.log(lines.join("\n"));
  }
})();
