/**
 * Model lab (college): the every-game model run several ways on this season's finished games, so
 * each change shows its before and after. Lower "miss" is better; the market's own miss is the bar.
 */

import { useMemo } from "react";
import { Panel } from "@/components/shared/booth";
import { LAB_VARIANTS, runLab, type EdgeBucket, type LabRow } from "@/lib/cfb/cfb-lab";
import { unitsText, type MarketRecord, type PriorResult } from "@/lib/shared/game-model";
import type { Game } from "@/data/shared/games";

const rec = (r: MarketRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const one = (n: number) => n.toFixed(2);
const tone = (u: number) => (u > 0 ? "text-win" : u < 0 ? "text-loss" : "text-mute");

/** Colors a miss green when it beats the old settings, red when it's worse. */
function better(value: number, old: number, lowerIsBetter = true): string {
  const d = lowerIsBetter ? old - value : value - old;
  return d > 0.05 ? "text-win" : d < -0.05 ? "text-loss" : "";
}

export function CfbLab({ games, prior }: { games: Game[]; prior: PriorResult[] }) {
  const lab = useMemo(() => runLab(games, prior), [games, prior]);
  if (!lab) {
    return (
      <Panel>
        <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">Model lab</h2>
        <p className="mt-1 text-sm text-mute">
          Needs finished games with lines. It fills in as the season goes.
        </p>
      </Panel>
    );
  }
  const old = lab.rows[0];
  const bucketRows = (market: EdgeBucket["market"]) =>
    lab.edgeBuckets.filter((b) => b.market === market);
  return (
    <Panel>
      <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">Model lab</h2>
      <p className="mt-1 text-sm text-mute">
        The college model run on the same {lab.common} finished games with each change. &quot;Miss&quot;
        is how many points off the model&apos;s own margin was (lower is better); the market&apos;s
        miss is {one(lab.marketMarginMae)} points on margin and {one(lab.marketTotalMae)} on totals,
        the bar to beat. Green means better than the old settings, red worse. A change that
        isn&apos;t green here isn&apos;t earning its place: switch it off in CFB_CONFIG.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-2 py-2 font-normal">Version</th>
              <th className="px-2 py-2 text-right font-normal">Margin miss</th>
              <th className="px-2 py-2 text-right font-normal">Total miss</th>
              <th className="px-2 py-2 text-right font-normal">Win-prob score</th>
              <th className="px-2 py-2 text-right font-normal">ATS</th>
              <th className="px-2 py-2 text-right font-normal">O/U</th>
              <th className="px-2 py-2 text-right font-normal">Units</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5 font-mono tabular-nums">
            {lab.rows.map((r: LabRow) => (
              <tr key={r.variant.id} title={r.variant.note}>
                <td className="px-2 py-2 font-sans">
                  <div>{r.variant.label}</div>
                  <div className="text-[11px] text-faint">{r.variant.note}</div>
                </td>
                <td className={`px-2 py-2 text-right ${better(r.marginMae, old.marginMae)}`}>
                  {one(r.marginMae)}
                </td>
                <td className={`px-2 py-2 text-right ${better(r.totalMae, old.totalMae)}`}>
                  {one(r.totalMae)}
                </td>
                <td className={`px-2 py-2 text-right ${better(r.brier * 100, old.brier * 100)}`}>
                  {r.brier.toFixed(4)}
                </td>
                <td className="px-2 py-2 text-right">{rec(r.spread)}</td>
                <td className="px-2 py-2 text-right">{rec(r.total)}</td>
                <td className={`px-2 py-2 text-right ${tone(r.units)}`}>{unitsText(r.units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-faint">
        Records are noisy over a few hundred games; the miss columns are the steadier signal.{" "}
        {LAB_VARIANTS.length} versions, same games, each week predicted only from earlier weeks.
      </p>

      <h3 className="mt-5 font-disp text-base font-semibold uppercase tracking-tight">
        Does a bigger disagreement with the line win more?
      </h3>
      <p className="mt-1 text-sm text-mute">
        The model&apos;s own pick against the closing line, only when it disagrees by at least this
        many points. If the records climb as the gap grows, betting only the big gaps is worth
        switching on; if they stay flat, the model has no edge to be selective about.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {(["spread", "total"] as const).map((market) => (
          <div key={market}>
            <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
              {market === "spread" ? "Against the spread" : "Over / under"}
            </div>
            <table className="mt-1 w-full text-sm">
              <tbody className="divide-y divide-line/5 font-mono tabular-nums">
                {bucketRows(market).map((b) => (
                  <tr key={b.minEdge}>
                    <td className="py-1.5 font-sans text-mute">{b.minEdge === 0 ? "Any gap" : `${b.minEdge}+ pts`}</td>
                    <td className="py-1.5 text-right">
                      {b.wins}-{b.losses}
                      {b.pushes ? `-${b.pushes}` : ""}
                    </td>
                    <td className="py-1.5 text-right">{b.winPct === null ? "—" : `${b.winPct.toFixed(1)}%`}</td>
                    <td className={`py-1.5 text-right ${tone(b.units)}`}>{unitsText(b.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Panel>
  );
}
