/**
 * Quarterback-aware NFL futures, tested on past seasons (same setup as futures_tune.ts).
 *   qb off      - spreads as posted (the site before this change)
 *   qb fit      - spreads from games a fill-in QB started are adjusted back to the regular starter
 *   qb fit+N    - also: a fill-in starting now costs his gap for N more games after the lined one
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
import { marketFit, marketFitQb, qbTools, simulateSeason, type SimGame, type SimTeam } from "@/lib/nfl/futures-sim";
import type { QbStart } from "@/lib/nfl/qb-ratings";
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

interface Cfg { name: string; src: "market"; w: number; sd: number; carry: number; lambda: number; halfLife: number; gameSd: number; qbFit: boolean; outWeeks: number; learn?: { lamQ: number; scale: number } }
const grid: Cfg[] = [];
const base = { src: "market" as const, w: 1, sd: 2, carry: 0.6, lambda: 1, halfLife: 6, gameSd: 13.5 };
grid.push({ ...base, name: "qb off", qbFit: false, outWeeks: 0 });
grid.push({ ...base, name: "qb fit", qbFit: true, outWeeks: 0 });
for (const n of [1, 2, 4, 8, 99]) grid.push({ ...base, name: `qb fit+${n}`, qbFit: true, outWeeks: n });
for (const n of [2, 4, 99]) grid.push({ ...base, name: `qb future-only+${n}`, qbFit: false, outWeeks: n });
for (const lamQ of [0.5, 2])
  for (const scale of [0.5, 1])
    for (const n of [2, 4, 99]) grid.push({ ...base, name: `qb learn lamQ${lamQ} scale${scale} +${n}`, qbFit: false, outWeeks: n, learn: { lamQ, scale } });
const only = process.env.ONLY;
const cfgs = only ? grid.filter((c) => c.name.includes(only)) : grid;

// QB starts: the listed starter of each game, scored by his team's passing EPA per dropback that game
const epa = new Map<string, { epa: number; db: number }>();
// team passing EPA and dropbacks per game, from nflverse weekly player stats (prepared as one csv)
for (const l of readFileSync("/root/fbdata/team_pass_epa.csv", "utf8").trim().split("\n").slice(1)) {
  const [g, t, e, d] = l.split(",");
  epa.set(`${g}|${t}`, { epa: Number(e), db: Number(d) });
}
const starts: QbStart[] = [];
for (const r of rows) {
  if (r.game_type !== "REG" || Number(r.season) < 2001 || r.home_score === "") continue;
  for (const [team, qb, name] of [[r.home_team, r.home_qb_id, r.home_qb_name], [r.away_team, r.away_qb_id, r.away_qb_name]]) {
    if (!qb) continue;
    const e = epa.get(`${r.game_id}|${team}`);
    starts.push({ season: Number(r.season), week: Number(r.week), teamId: fr(team), qb, name, epaPerDropback: e && e.db > 0 ? e.epa / e.db : undefined });
  }
}
const QB = qbTools(starts);
const qbAdj = (r: Record<string, string>) =>
  QB.value(fr(r.home_team), r.home_qb_id, Number(r.season), Number(r.week)) - QB.value(fr(r.away_team), r.away_qb_id, Number(r.season), Number(r.week));
console.error(`QB starts: ${starts.length}`);

// end-of-season market ratings for every season (used as next season's prior), computed with the same fit
const endMarket = new Map<number, Record<string, number>>();
const endMarketQb = new Map<number, Record<string, number>>();
for (let s = 2001; s <= 2025; s++) {
  const reg = rows.filter((r) => Number(r.season) === s && r.game_type === "REG" && r.spread_line !== "");
  const ids = [...new Set(reg.map((r) => fr(r.home_team)))];
  for (const norm of [false, true]) {
    const fit = marketFit(
      reg.map((r) => ({ h: fr(r.home_team), a: fr(r.away_team), spread: Number(r.spread_line) - (norm && s >= 2002 ? qbAdj(r) : 0), neutral: r.location === "Neutral", w: Number(r.week) >= 10 ? 1.5 : 1 })),
      ids,
      {},
      0.5,
    );
    (norm ? endMarketQb : endMarket).set(s, fit.power);
  }
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
  const lastEndRaw = endMarket.get(season - 1) ?? {};
  const lastEndQb = endMarketQb.get(season - 1) ?? {};

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
    // who starts the next (lined) game for each team: the "current" quarterback
    const cur = new Map<string, string>();
    for (const r of reg.filter((r) => Number(r.week) === K)) {
      cur.set(r.home_team, r.home_qb_id);
      cur.set(r.away_team, r.away_qb_id);
    }
    const learned = new Map<string, Record<string, number>>();
    for (const c of cfgs) {
      const key0 = `${c.carry}|${c.lambda}|${c.halfLife}|${c.qbFit}|${c.learn ? c.learn.lamQ + "/" + c.learn.scale : ""}`;
      const curVal = (team: string) => {
        const qb = cur.get(team);
        const v = QB.value(fr(team), qb, season, K);
        if (!c.learn || !v) return v;
        const got = learned.get(key0)?.[`${fr(team)}|${qb}`];
        return got ?? v * c.learn.scale;
      };
      const lastEnd = c.qbFit ? lastEndQb : lastEndRaw;
      let power: Record<string, number>;
      let hf = sr.homeField;
      {
        const key = `${c.carry}|${c.lambda}|${c.halfLife}|${c.qbFit}|${c.learn ? c.learn.lamQ + "/" + c.learn.scale : ""}`;
        if (!mcache.has(key)) {
          const pr: Record<string, number> = {};
          for (const id of ids) pr[id] = (lastEnd[fr(id)] ?? 0) * c.carry;
          const fit = marketFit(
            known.map((r) => ({
              h: r.home_team,
              a: r.away_team,
              spread: Number(r.spread_line) - (c.qbFit ? qbAdj(r) : 0),
              neutral: r.location === "Neutral",
              w: c.halfLife ? Math.pow(0.5, (K - Number(r.week)) / c.halfLife) : 1,
            })),
            ids,
            pr,
            c.lambda,
          );
          if (c.learn) {
            const L = c.learn;
            const fq = (team: string, qb: string, wk: number) => (qb && QB.regular(fr(team), season, wk) !== qb ? `${fr(team)}|${qb}` : undefined);
            const extraPrior: Record<string, number> = {};
            const kg = known.map((r) => {
              const wk = Number(r.week);
              const hq = fq(r.home_team, r.home_qb_id, wk);
              const aq = fq(r.away_team, r.away_qb_id, wk);
              if (hq) extraPrior[hq] = QB.value(fr(r.home_team), r.home_qb_id, season, wk) * L.scale;
              if (aq) extraPrior[aq] = QB.value(fr(r.away_team), r.away_qb_id, season, wk) * L.scale;
              return { h: r.home_team, a: r.away_team, spread: Number(r.spread_line), neutral: r.location === "Neutral", w: c.halfLife ? Math.pow(0.5, (K - wk) / c.halfLife) : 1, hq, aq };
            });
            const f2 = marketFitQb(kg, ids, pr, c.lambda, extraPrior, L.lamQ);
            learned.set(key, f2.fillIn);
            mcache.set(key, f2);
          } else mcache.set(key, fit);
        }
        const m = mcache.get(key)!;
        hf = m.hf;
        power = m.power;
      }
      const simGames: SimGame[] = c.outWeeks
        ? games.map((g, gi) => {
            const wk = Number(reg[gi].week);
            if (g.homeScore != null || g.homeLine != null || wk <= K || wk > K + c.outWeeks) return g;
            return { ...g, homeAdj: curVal(g.home) - curVal(g.away) };
          })
        : games;
      const out = simulateSeason(teams, simGames, { power, homeField: hf, sims: SIMS, seeds, strengthSd: c.sd, gameSd: c.gameSd, rngSeed: season * 100 + K });
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
