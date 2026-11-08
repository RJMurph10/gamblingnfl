/**
 * Does adding non-QB injuries to the site's NFL model improve its spread calls at the OPENING line?
 * The model's own ratings-only prediction (team ratings + QB ratings, before anchoring to the market,
 * which in the replay is the closing line) vs ESPN's opener, with and without the injury adjustment
 * (research/football/injuries/game_injury_adj.py). Graded at the opener and at the close.
 *   node /root/fbdata/sitecheck/run.cjs $PWD research/football/injuries/injury_opener.ts /tmp/claude-0/injury_adj.csv <nfl-lines dir>
 */
import { readFileSync } from "node:fs";
import { fetchNflHistory } from "@/lib/nfl/nfl-history.server";
import { pastSeasonRuns, readHistory } from "@/lib/nfl/model-history";

const [ADJ, LINES] = process.argv.slice(-2);
const adj = new Map<number, number>();
for (const l of readFileSync(ADJ, "utf8").trim().split("\n").slice(1)) {
  const v = l.split(",");
  adj.set(Number(v[0]), Number(v[v.length - 1]));
}
const lines = new Map<number, { open: number | null; close: number | null; hs: number; as: number }>();
for (const y of [2024, 2025, 2026]) {
  for (const g of JSON.parse(readFileSync(`${LINES}/nfl-lines-${y}.json`, "utf8"))) {
    if (g.hs == null) continue;
    lines.set(Number(g.id), { open: g.open?.[0] ?? null, close: g.close?.[0] ?? null, hs: g.hs, as: g.as });
  }
}
const W = 100 / 110;
(async () => {
  const h = readHistory(await fetchNflHistory());
  type R = { season: number; id: number; raw: number; open: number | null; close: number | null; margin: number; adj: number };
  const collect = (extra?: (id: number) => number) => {
    const out: R[] = [];
    for (const run of pastSeasonRuns(h.games, { qbRows: h.qbRows, extraMargin: extra })) {
      if (run.season < 2024) continue;
      for (const row of run.rows) {
        const id = Number(row.game.id.match(/(\d+)$/)?.[1]);
        const L = lines.get(id);
        if (!row.modelPrediction || !L) continue;
        out.push({ season: run.season, id, raw: row.modelPrediction.homeLine, open: L.open, close: L.close, margin: L.hs - L.as, adj: adj.get(id) ?? 0 });
      }
    }
    return out;
  };
  const base = collect();
  const withInj = collect((id) => adj.get(id) ?? 0);
  console.log(`games with a model line and an opener: ${base.length} (seasons ${[...new Set(base.map((r) => r.season))].join(", ")})`);
  const grade = (rs: R[], at: "open" | "close", T: number, onlyInj = false) => {
    let w = 0, l = 0;
    const by: Record<number, [number, number]> = {};
    for (const r of rs) {
      const line = r[at];
      if (line == null) continue;
      if (onlyInj && Math.abs(r.adj) < 1) continue;
      const edge = line - r.raw; // >0: model likes home more than the line does
      if (Math.abs(edge) < T) continue;
      const cover = r.margin + line; // home cover margin
      if (cover === 0) continue;
      const win = edge > 0 ? cover > 0 : cover < 0;
      by[r.season] ??= [0, 0];
      if (win) { w++; by[r.season][0]++; } else { l++; by[r.season][1]++; }
    }
    const s = Object.entries(by).map(([y, [a, b]]) => `${y}:${a}-${b}`).join(" ");
    return `${w}-${l} ${((100 * w) / Math.max(1, w + l)).toFixed(1)}% ${(w * W - l >= 0 ? "+" : "")}${(w * W - l).toFixed(1)}u  [${s}]`;
  };
  const mae = (rs: R[]) => (rs.reduce((a, r) => a + Math.abs(-r.raw - r.margin), 0) / rs.length).toFixed(3);
  console.log(`model margin miss: without injuries ${mae(base)}, with ${mae(withInj)}; opener ${(base.filter((r) => r.open != null).reduce((a, r) => a + Math.abs(-r.open! - r.margin), 0) / base.filter((r) => r.open != null).length).toFixed(3)}`);
  for (const at of ["open", "close"] as const) {
    console.log(`\nGraded at the ${at === "open" ? "OPENER" : "CLOSE"}`);
    for (const T of [1, 2, 3, 4]) {
      console.log(`  model ${T}+ pts off: without ${grade(base, at, T).padEnd(44)} with injuries ${grade(withInj, at, T)}`);
    }
    console.log(`  games with a 1+ pt injury gap only, model 2+ off: without ${grade(base, at, 2, true)} | with ${grade(withInj, at, 2, true)}`);
  }
})();
