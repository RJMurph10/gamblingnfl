/**
 * "Live results": this season's picks as they were recorded when they first appeared (the line you could
 * bet then), graded at that line. The replay cards show how the model would have done; this shows how
 * the picks actually did, and whether the line kept moving their way.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { getLivePicks } from "@/lib/shared/live-results.functions";
import { liveRecord, type LivePick, type LiveRecord } from "@/lib/shared/live-results";

const pct = (r: LiveRecord) =>
  r.wins + r.losses ? ((100 * r.wins) / (r.wins + r.losses)).toFixed(1) : "—";
const units = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;
const tone = (u: number) => (u > 0 ? "text-win" : u < 0 ? "text-loss" : "text-mute");

export function LiveResults({
  league,
  groups,
  footnote,
}: {
  league: "nba" | "cbb" | "nfl" | "cfb";
  /** Rows of the summary table: a label and which recorded picks belong to it. */
  groups: { label: string; test: (p: LivePick) => boolean }[];
  footnote?: string;
}) {
  const q = useQuery({
    queryKey: ["live-picks", league],
    queryFn: () => getLivePicks({ data: { league } }),
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: 1,
  });
  const picks = useMemo(() => q.data ?? [], [q.data]);
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(
    () => groups.map((g) => ({ label: g.label, rec: liveRecord(picks.filter(g.test)) })),
    [groups, picks],
  );
  const recent = useMemo(
    () =>
      picks
        .filter((p) => p.result && groups.some((g) => g.test(p)))
        .sort((a, b) => b.tip.localeCompare(a.tip))
        .slice(0, showAll ? 200 : 8),
    [picks, groups, showAll],
  );
  const pending = picks.filter((p) => !p.result && groups.some((g) => g.test(p))).length;

  return (
    <Panel padded={false} className="mb-6">
      <PanelHeader
        title="Live results · this season"
        aside={
          <span className="label-mono">
            {q.isLoading
              ? "Loading…"
              : `${pending ? `${pending} pending · ` : ""}graded at the line when posted`}
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">Picks</th>
              <th className="px-2 py-2 text-right font-normal">W-L-P</th>
              <th className="px-2 py-2 text-right font-normal">Win %</th>
              <th className="px-2 py-2 text-right font-normal">Units</th>
              <th
                className="px-4 py-2 text-right font-normal"
                title="Share of picks posted at a better number than the closing line, and the average points"
              >
                Beat the close
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {rows.map(({ label, rec }) => (
              <tr key={label}>
                <td className="px-4 py-2 font-mono text-xs">{label}</td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                  {rec.wins}-{rec.losses}-{rec.pushes}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{pct(rec)}</td>
                <td
                  className={`px-2 py-2 text-right font-mono text-xs tabular-nums ${tone(rec.units)}`}
                >
                  {units(rec.units)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-mute">
                  {rec.beat === null
                    ? "—"
                    : `${rec.beat.toFixed(0)}% · ${rec.avgClv! > 0 ? "+" : ""}${rec.avgClv!.toFixed(1)} pts`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recent.length ? (
        <div className="border-t border-line/10">
          <p className="px-4 pt-3 font-mono text-[10px] uppercase tracking-wider text-faint">
            Latest graded
          </p>
          <div className="divide-y divide-line/5">
            {recent.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-1.5 font-mono text-[11px]">
                <span
                  className={`w-4 font-semibold ${p.result === "win" ? "text-win" : p.result === "loss" ? "text-loss" : "text-mute"}`}
                >
                  {p.result === "win" ? "W" : p.result === "loss" ? "L" : "P"}
                </span>
                <span className="w-24 shrink-0 text-faint">{p.day.slice(5)}</span>
                <span className="min-w-0 flex-1 truncate">{p.game}</span>
                <span className="text-foreground">
                  {p.best ? (
                    <span className="mr-1 text-acc">★</span>
                  ) : p.tag ? (
                    <span className="mr-1 text-faint">◦</span>
                  ) : null}
                  {p.pick}
                </span>
                <span className="w-16 text-right text-mute">
                  {p.score
                    ? p.market === "total"
                      ? p.score[0] + p.score[1]
                      : `${p.score[0]}-${p.score[1]}`
                    : ""}
                </span>
                <span
                  className={`w-12 text-right ${p.clv && p.clv > 0 ? "text-win" : p.clv && p.clv < 0 ? "text-loss" : "text-faint"}`}
                >
                  {p.clv === null
                    ? ""
                    : `${p.clv > 0 ? "▲" : p.clv < 0 ? "▼" : "·"}${Math.abs(p.clv)}`}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-acc"
          >
            {showAll ? "Show fewer" : "Show all"}
          </button>
        </div>
      ) : (
        <p className="border-t border-line/10 px-4 py-3 font-mono text-[11px] text-mute">
          {q.isLoading
            ? "Loading…"
            : "No graded picks yet this season. They're graded a few hours after each game ends."}
        </p>
      )}
      {footnote ? (
        <p className="border-t border-line/10 px-4 py-2 font-mono text-[10px] text-faint">
          {footnote}
        </p>
      ) : null}
    </Panel>
  );
}
