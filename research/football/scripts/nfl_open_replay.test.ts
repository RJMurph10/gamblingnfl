// Research harness (move into src/test to run with vitest): replays the site NFL model on 2023-26 with
// ESPN openers swapped in (props-history/nfl-lines) and writes every spread/total pick with its open/close.
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { fetchNflHistory } from "@/lib/nfl/nfl-history.server";
import { pastSeasonRuns, type HistoryGame } from "@/lib/nfl/model-history";
it("nfl opener replay", async () => {
  const h = await fetchNflHistory();
  const list: HistoryGame[] = (h as any).games ?? (h as any).history ?? (h as any);
  const lines = new Map<string, { open: number[]; close: number[] }>();
  for (const y of [2022, 2023, 2024, 2025, 2026])
    for (const g of JSON.parse(readFileSync(`/home/claude/nflo/lines-${y}.json`, "utf8"))) lines.set(String(g.id), g);
  const out: string[] = [`history games ${list.length}, keys ${Object.keys(h as any).join(",")}`];
  const opened = list.map((g) => {
    const l = lines.get(String(g.espnId));
    if (!l || l.open?.[0] == null || l.open?.[1] == null) return g;
    return { ...g, homeFavoredBy: -l.open[0], total: l.open[1] };
  });
  out.push(`with opener: ${list.filter((g) => lines.get(String(g.espnId))?.open?.[0] != null).length}`);
  const rows: string[] = ["season,id,market,side,line,edge,best,result,open,close,score_diff"];
  for (const [label, hist] of [["close", list], ["open", opened]] as const) {
    for (const run of pastSeasonRuns(hist, { qb: true, qbRows: (h as any).qbStarts })) {
      for (const r of run.rows) {
        const l = lines.get(String(r.game.id).split("-").pop()!);
        for (const p of r.predictions) {
          if (p.market === "moneyline") continue;
          const o = l?.open?.[p.market === "spread" ? 0 : 1];
          const c = l?.close?.[p.market === "spread" ? 0 : 1];
          rows.push([label + run.season, r.game.id, p.market, p.side, p.line, p.edge.toFixed(2), p.best, p.result, o ?? "", c ?? ""].join(","));
        }
      }
    }
  }
  writeFileSync("/home/claude/nflo/picks.csv", rows.join("\n"));
  writeFileSync("/home/claude/nflo/log.txt", out.join("\n"));
}, 900000);
