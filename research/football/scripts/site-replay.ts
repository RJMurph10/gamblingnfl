/** Runs the site's own NFL model-page replay (pastSeasonRuns) on real nflverse history and prints ★ records. */
import { fetchNflHistory } from "@/lib/nfl/nfl-history.server";
import { pastSeasonRuns, readHistory } from "@/lib/nfl/model-history";

const W = 100 / 110;
(async () => {
  const raw = await fetchNflHistory();
  const h = readHistory(raw);
  const all = h.games.filter((g) => g.season < h.currentSeason || h.currentSeason === 0);
  const runs = pastSeasonRuns(all, { qbRows: h.qbRows });
  const tally = (picks: { result: string }[]) => {
    const w = picks.filter((p) => p.result === "win").length;
    const l = picks.filter((p) => p.result === "loss").length;
    const p = picks.filter((p) => p.result === "push").length;
    return `${w}-${l}-${p} ${((100 * w) / Math.max(1, w + l)).toFixed(1)}% ${(w * W - l >= 0 ? "+" : "")}${(w * W - l).toFixed(1)}u`;
  };
  const totalAll: any[] = [];
  for (const r of runs) {
    const best = r.rows.flatMap((row) => row.picks);
    totalAll.push(...best);
    const by = (reason: string) => best.filter((p) => p.reason === reason);
    console.log(
      r.season,
      "| all ★", tally(best),
      "| underdog", tally(by("underdog")),
      "| bounce", tally(by("bounce")),
      "| qb-style", tally(by("qb-style")),
      "| wind", tally(by("wind")),
    );
  }
  console.log("ALL   | all ★", tally(totalAll));
})();
