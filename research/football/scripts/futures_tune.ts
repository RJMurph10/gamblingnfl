/**
 * Tunes the NFL futures simulator on past seasons. For each setting, every season 2002-2025 is stopped
 * before week K (1 = preseason, 5, 9, 13), team strengths are estimated from what was known then, the
 * rest is simulated, and the odds are scored (log loss) against what happened.
 * Pick settings on 2002-2013 ("train"), then check them on 2014-2025 ("test"), which the choice never saw.
 *
 * Strength sources:
 *   scores  - the site's ratings from this season's scores (+ last season at reduced weight)
 *   market  - ratings fit to the betting spreads posted so far (through week K), ridge toward last
 *             season's end-of-year market ratings shrunk by CARRY
 *   blend   - w * market + (1 - w) * scores
 *   node /root/fbdata/sitecheck/run.cjs $PWD research/football/scripts/futures_tune.ts
 */
import { readFileSync } from "node:fs";
import { fitRatings, NFL_CONFIG, type PriorResult } from "@/lib/shared/game-model";
import { marketFit, simulateSeason, type SimGame, type SimTeam } from "@/lib/nfl/futures-sim";
import type { Game } from "@/data/shared/games";

const SIMS = Number(process.env.SIMS ?? 2000);
const WEEKS = (process.env.WEEKS ?? "1,5,9,13").split(",").map(Number);
const MARKETS = ["division", "playoffs", "topSeed", "conference", "superBowl"] as const;

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
// franchise ids so last season's rating follows a move
const FR: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA" };
const fr = (t: string) => FR[t] ?? t;

const lines = readFileSync("/root/fbdata/src/nfl_games.csv", "utf8").trim().split("\n");
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

interface Cfg { name: string; src: "scores" | "market" | "blend"; w: number; sd: number; carry: number; lambda: number; halfLife: number; gameSd: number }
const grid: Cfg[] = [];
const add = (c: Omit<Cfg, "name">) =>
  grid.push({ ...c, name: `${c.src}${c.src === "blend" ? c.w : ""} sd${c.sd} carry${c.carry} lam${c.lambda} hl${c.halfLife} g${c.gameSd}` });
for (const sd of [1.5, 2.5, 3.5]) add({ src: "scores", w: 0, sd, carry: 0, lambda: 0, halfLife: 0, gameSd: 13.5 });
for (const sd of [1, 2, 3])
  for (const carry of [0.4, 0.6, 0.8])
    for (const lambda of [1, 3])
      for (const halfLife of [0, 6]) add({ src: "market", w: 1, sd, carry, lambda, halfLife, gameSd: 13.5 });
for (const w of [0.5, 0.75]) for (const sd of [1.5, 2.5]) add({ src: "blend", w, sd, carry: 0.6, lambda: 3, halfLife: 0, gameSd: 13.5 });
for (const g of [12.5, 14.5]) add({ src: "market", w: 1, sd: 2, carry: 0.6, lambda: 3, halfLife: 0, gameSd: g });
const only = process.env.ONLY;
const cfgs = only ? grid.filter((c) => c.name.includes(only)) : grid;

// end-of-season market ratings for every season (used as next season's prior), computed with the same fit
const endMarket = new Map<number, Record<string, number>>();
for (let s = 2001; s <= 2025; s++) {
  const reg = rows.filter((r) => Number(r.season) === s && r.game_type === "REG" && r.spread_line !== "");
  const ids = [...new Set(reg.map((r) => fr(r.home_team)))];
  const fit = marketFit(
    reg.map((r) => ({ h: fr(r.home_team), a: fr(r.away_team), spread: Number(r.spread_line), neutral: r.location === "Neutral", w: Number(r.week) >= 10 ? 1.5 : 1 })),
    ids,
    {},
    0.5,
  );
  endMarket.set(s, fit.power);
}

const ll = (p: number, y: number) => {
  const q = Math.min(1 - 1e-3, Math.max(1e-3, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const score = new Map<string, { train: number[]; test: number[]; byWeek: Map<number, { train: number[]; test: number[] }> }>();

for (let season = 2002; season <= 2025; season++) {
  const reg = rows.filter((r) => Number(r.season) === season && r.game_type === "REG");
  const prior: PriorResult[] = rows
    .filter((r) => Number(r.season) === season - 1 && r.game_type === "REG")
    .map((r) => ({ homeTeamId: r.home_team, awayTeamId: r.away_team, homeScore: Number(r.home_score), awayScore: Number(r.away_score) }));
  const ids = [...new Set(reg.map((r) => r.home_team))];
  const teams: SimTeam[] = ids.map((id) => ({ id, conf: DIV[id].slice(0, 3), div: DIV[id] }));
  const seeds = season >= 2020 ? 7 : 6;
  const full: SimGame[] = reg.map((r) => ({ home: r.home_team, away: r.away_team, homeScore: Number(r.home_score), awayScore: Number(r.away_score) }));
  const truth = new Map(simulateSeason(teams, full, { power: {}, homeField: 0, sims: 1, seeds, strengthSd: 0 }).map((x) => [x.id, x]));
  const post = rows.filter((r) => Number(r.season) === season);
  const winnerOf = (r: Record<string, string>) => (Number(r.home_score) > Number(r.away_score) ? r.home_team : r.away_team);
  const conf = new Set(post.filter((r) => r.game_type === "CON").map(winnerOf));
  const sb = new Set(post.filter((r) => r.game_type === "SB").map(winnerOf));
  const lastEnd = endMarket.get(season - 1) ?? {};

  for (const K of WEEKS) {
    const before = reg.filter((r) => Number(r.week) < K);
    const sr = fitRatings(before.map(fake), prior, NFL_CONFIG);
    const scores: Record<string, number> = {};
    for (const id of ids) scores[id] = (sr.offense[id] ?? 0) - (sr.defense[id] ?? 0);
    const known = reg.filter((r) => Number(r.week) <= K && r.spread_line !== "");
    const games: SimGame[] = reg.map((r) =>
      Number(r.week) < K
        ? { home: r.home_team, away: r.away_team, homeScore: Number(r.home_score), awayScore: Number(r.away_score) }
        : { home: r.home_team, away: r.away_team, neutral: r.location === "Neutral", homeLine: Number(r.week) === K && r.spread_line !== "" ? -Number(r.spread_line) : null },
    );
    const mcache = new Map<string, { power: Record<string, number>; hf: number }>();
    for (const c of cfgs) {
      let power: Record<string, number>;
      let hf = sr.homeField;
      if (c.src === "scores") power = scores;
      else {
        const key = `${c.carry}|${c.lambda}|${c.halfLife}`;
        if (!mcache.has(key)) {
          const pr: Record<string, number> = {};
          for (const id of ids) pr[id] = (lastEnd[fr(id)] ?? 0) * c.carry;
          const fit = marketFit(
            known.map((r) => ({
              h: r.home_team,
              a: r.away_team,
              spread: Number(r.spread_line),
              neutral: r.location === "Neutral",
              w: c.halfLife ? Math.pow(0.5, (K - Number(r.week)) / c.halfLife) : 1,
            })),
            ids,
            pr,
            c.lambda,
          );
          mcache.set(key, fit);
        }
        const m = mcache.get(key)!;
        hf = m.hf;
        power = c.src === "market" ? m.power : Object.fromEntries(ids.map((id) => [id, c.w * m.power[id] + (1 - c.w) * scores[id]]));
      }
      const out = simulateSeason(teams, games, { power, homeField: hf, sims: SIMS, seeds, strengthSd: c.sd, gameSd: c.gameSd, rngSeed: season * 100 + K });
      let tot = 0;
      for (const f of out) {
        const a = truth.get(f.id)!;
        tot += ll(f.division, a.division > 0 ? 1 : 0) + ll(f.playoffs, a.playoffs > 0 ? 1 : 0) + ll(f.topSeed, a.topSeed > 0 ? 1 : 0) + ll(f.conference, conf.has(f.id) ? 1 : 0) + ll(f.superBowl, sb.has(f.id) ? 1 : 0);
      }
      const v = tot / (out.length * MARKETS.length);
      const sc = score.get(c.name) ?? { train: [], test: [], byWeek: new Map() };
      const half = season <= 2013 ? "train" : "test";
      sc[half].push(v);
      const bw = sc.byWeek.get(K) ?? { train: [], test: [] };
      bw[half].push(v);
      sc.byWeek.set(K, bw);
      score.set(c.name, sc);
    }
  }
}
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const res = [...score.entries()].map(([name, s]) => ({ name, train: avg(s.train), test: avg(s.test), s }));
res.sort((a, b) => a.train - b.train);
console.log(`avg log loss over division/playoffs/1 seed/conference/SB, stops at weeks ${WEEKS.join(",")} (lower is better)`);
console.log("setting".padEnd(48) + "train 02-13  test 14-25   " + WEEKS.map((w) => `wk${w} tr/te`.padStart(16)).join(""));
for (const r of res) {
  const wk = WEEKS.map((w) => {
    const b = r.s.byWeek.get(w)!;
    return `${avg(b.train).toFixed(4)}/${avg(b.test).toFixed(4)}`.padStart(16);
  }).join("");
  console.log(`${r.name.padEnd(48)}${r.train.toFixed(4)}       ${r.test.toFixed(4)}      ${wk}`);
}
