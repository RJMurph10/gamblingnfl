/**
 * Walk-forward test of the NFL futures simulator: for every season 2002-2025, stop the season after
 * week K-1, fit the ratings on the games so far (+ last season at reduced weight), simulate the rest,
 * and score the odds against what actually happened (division winners, playoff teams, 1 seeds,
 * conference and Super Bowl winners). Run:
 *   node /root/fbdata/sitecheck/run.cjs $PWD research/football/scripts/futures_backtest.ts
 * env: CSV (nflverse games), WEEKS (e.g. "6,10,14"), SDS (strengthSd values), SIMS
 */
import { readFileSync } from "node:fs";
import { fitRatings, NFL_CONFIG, type PriorResult } from "@/lib/shared/game-model";
import { simulateSeason, type SimGame, type SimTeam } from "@/lib/nfl/futures-sim";
import type { Game } from "@/data/shared/games";

const CSV = process.env.CSV ?? "/root/fbdata/src/nfl_games.csv";
const WEEKS = (process.env.WEEKS ?? "10").split(",").map(Number);
const SDS = (process.env.SDS ?? "0,1.5,2.5,3.5").split(",").map(Number);
const SIMS = Number(process.env.SIMS ?? 4000);

const DIV: Record<string, string> = {};
const put = (d: string, list: string) => list.split(" ").forEach((t) => (DIV[t] = d));
put("AFC East", "BUF MIA NE NYJ");
put("AFC North", "BAL CIN CLE PIT");
put("AFC South", "HOU IND JAX TEN");
put("AFC West", "DEN KC LV OAK LAC SD");
put("NFC East", "DAL NYG PHI WAS");
put("NFC North", "CHI DET GB MIN");
put("NFC South", "ATL CAR NO TB");
put("NFC West", "ARI LA STL SEA SF");

const lines = readFileSync(CSV, "utf8").trim().split("\n");
const head = lines[0].split(",");
const rows = lines.slice(1).map((l) => {
  const v = l.split(",");
  return Object.fromEntries(head.map((h, i) => [h, v[i]])) as Record<string, string>;
});
const fake = (r: Record<string, string>): Game =>
  ({
    homeTeamId: r.home_team,
    awayTeamId: r.away_team,
    quarters: { home: [Number(r.home_score)], away: [Number(r.away_score)] },
    total: 0,
    spread: "",
    neutralSite: r.location === "Neutral",
  }) as unknown as Game;

interface Pred { season: number; week: number; sd: number; market: string; team: string; p: number; hit: number }
const preds: Pred[] = [];

for (let season = 2002; season <= 2025; season++) {
  const reg = rows.filter((r) => Number(r.season) === season && r.game_type === "REG");
  const prior: PriorResult[] = rows
    .filter((r) => Number(r.season) === season - 1 && r.game_type === "REG")
    .map((r) => ({ homeTeamId: r.home_team, awayTeamId: r.away_team, homeScore: Number(r.home_score), awayScore: Number(r.away_score) }));
  const ids = [...new Set(reg.map((r) => r.home_team))];
  const teams: SimTeam[] = ids.map((id) => ({ id, conf: DIV[id].slice(0, 3), div: DIV[id] }));
  const seeds = season >= 2020 ? 7 : 6;
  // what happened: seeding from the full season (a 1-sim run with every game final), champions from the playoffs
  const full: SimGame[] = reg.map((r) => ({ home: r.home_team, away: r.away_team, homeScore: Number(r.home_score), awayScore: Number(r.away_score) }));
  const truth = simulateSeason(teams, full, { power: {}, homeField: 0, sims: 1, seeds, strengthSd: 0 });
  const post = rows.filter((r) => Number(r.season) === season);
  const winnerOf = (r: Record<string, string>) => (Number(r.home_score) > Number(r.away_score) ? r.home_team : r.away_team);
  const confChamps = new Set(post.filter((r) => r.game_type === "CON").map(winnerOf));
  const sbChamp = new Set(post.filter((r) => r.game_type === "SB").map(winnerOf));
  // sanity: actual playoff teams vs our seeding
  const actualPO = new Set(post.filter((r) => r.game_type === "WC" || r.game_type === "DIV").flatMap((r) => [r.home_team, r.away_team]));
  const ourPO = truth.filter((t) => t.playoffs > 0).map((t) => t.id);
  const miss = ourPO.filter((t) => !actualPO.has(t));
  if (miss.length) console.error(`${season}: seeding mismatch ${miss.join(" ")}`);

  for (const K of WEEKS) {
    const before = reg.filter((r) => Number(r.week) < K);
    const ratings = fitRatings(before.map(fake), prior, NFL_CONFIG);
    const power: Record<string, number> = {};
    for (const id of ids) power[id] = process.env.NOPOWER ? 0 : (ratings.offense[id] ?? 0) - (ratings.defense[id] ?? 0);
    const games: SimGame[] = reg.map((r) =>
      Number(r.week) < K
        ? { home: r.home_team, away: r.away_team, homeScore: Number(r.home_score), awayScore: Number(r.away_score) }
        : {
            home: r.home_team,
            away: r.away_team,
            neutral: r.location === "Neutral",
            // only next week's lines are known at the time
            homeLine: Number(r.week) === K && r.spread_line !== "" ? -Number(r.spread_line) : null,
          },
    );
    for (const sd of SDS) {
      const out = simulateSeason(teams, games, { power, homeField: ratings.homeField, sims: SIMS, seeds, strengthSd: sd, rngSeed: season * 100 + K });
      const t = new Map(truth.map((x) => [x.id, x]));
      for (const f of out) {
        const a = t.get(f.id)!;
        const add = (market: string, p: number, hit: boolean) => preds.push({ season, week: K, sd, market, team: f.id, p, hit: hit ? 1 : 0 });
        add("division", f.division, a.division > 0);
        add("playoffs", f.playoffs, a.playoffs > 0);
        add("topSeed", f.topSeed, a.topSeed > 0);
        add("conference", f.conference, confChamps.has(f.id));
        add("superBowl", f.superBowl, sbChamp.has(f.id));
      }
    }
  }
}

const ll = (p: number, y: number) => {
  const q = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const markets = ["division", "playoffs", "topSeed", "conference", "superBowl"];
for (const K of WEEKS) {
  console.log(`\n== stop after week ${K - 1} ==  log loss (lower is better); early = 2002-2013, late = 2014-2025`);
  console.log("sd    " + markets.map((m) => m.padStart(22)).join(""));
  for (const sd of SDS) {
    const cells = markets.map((m) => {
      const f = (lo: number, hi: number) => {
        const s = preds.filter((p) => p.week === K && p.sd === sd && p.market === m && p.season >= lo && p.season <= hi);
        return s.reduce((a, p) => a + ll(p.p, p.hit), 0) / s.length;
      };
      return `${f(2002, 2013).toFixed(4)} / ${f(2014, 2025).toFixed(4)}`.padStart(22);
    });
    console.log(String(sd).padEnd(6) + cells.join(""));
  }
}
// calibration at the chosen sd
const SD = Number(process.env.CAL_SD ?? 2.5);
for (const K of WEEKS) {
  console.log(`\n== calibration, week ${K - 1} stop, sd ${SD}: predicted vs actual by bucket ==`);
  for (const m of ["division", "playoffs"]) {
    const s = preds.filter((p) => p.week === K && p.sd === SD && p.market === m);
    const buckets = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0001];
    const parts: string[] = [];
    for (let b = 0; b < buckets.length - 1; b++) {
      const g = s.filter((p) => p.p >= buckets[b] && p.p < buckets[b + 1]);
      if (!g.length) continue;
      const pr = g.reduce((a, p) => a + p.p, 0) / g.length;
      const ac = g.reduce((a, p) => a + p.hit, 0) / g.length;
      parts.push(`${(pr * 100).toFixed(0)}%→${(ac * 100).toFixed(0)}% (${g.length})`);
    }
    console.log(`${m.padEnd(10)} ${parts.join("  ")}`);
  }
}
