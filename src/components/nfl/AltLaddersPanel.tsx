/** Tracked: DraftKings alt-line ladders ("X+ yards") graded by price, to check the −175 to −250 hint. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { HINT_BUCKET, HINT_MARKETS, type AltBucket } from "@/lib/nfl/alt-ladders";
import { getAltLadders } from "@/lib/nfl/alt-ladders.functions";

const price = (p: number) => (p > 0 ? `+${p}` : String(p));
const MARKETS = ["All", "Rec yds", "Pass yds", "Rush yds", "Receptions"];

function sum(rows: AltBucket[]): AltBucket {
  const out = rows.reduce(
    (a, r) => ({
      ...a,
      bets: a.bets + r.bets,
      wins: a.wins + r.wins,
      units: a.units + r.units,
      needed: (a.needed ?? 0) + (r.needed ?? 0) * r.bets,
    }),
    { label: "", bets: 0, wins: 0, units: 0, needed: 0 } as AltBucket,
  );
  return { ...out, needed: out.bets ? (out.needed as number) / out.bets : null };
}

export function AltLaddersPanel() {
  const q = useQuery({
    queryKey: ["nfl-alt-ladders"],
    queryFn: () => getAltLadders({ data: {} }),
    staleTime: 15 * 60_000,
    retry: 1,
  });
  const [market, setMarket] = useState("All");
  const f = q.data;
  const rows = f ? (market === "All" ? f.buckets : (f.byMarket[market] ?? [])) : [];
  const hint = f
    ? sum(
        HINT_MARKETS.map((m) => f.byMarket[m]?.find((b) => b.label === HINT_BUCKET)).filter(
          (b): b is AltBucket => !!b,
        ),
      )
    : null;
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Tracked · DraftKings alt lines by price"
        aside={
          <span className="label-mono">
            {q.isLoading
              ? "Loading…"
              : f
                ? `${f.games} games graded`
                : "Starts with this week's games"}
          </span>
        }
      />
      <div className="space-y-2 px-4 py-3 text-sm text-mute">
        <p>
          <span className="font-semibold text-foreground">
            Every DraftKings &quot;X+ yards&quot; line we save, graded against what the player did.
          </span>{" "}
          The question: do heavy-favorite alt overs win more often than their price says? In 2024,
          receiving- and passing-yard alt overs at −175 to −250 won 71% when they needed 66%, but
          there were no DraftKings ladder prices to confirm it. This builds that record.
        </p>
        {hint && hint.bets ? (
          <p className="font-mono text-[11px]">
            <span className="text-acc">The hint (rec + pass yds, −175 to −250):</span> {hint.wins}-
            {hint.bets - hint.wins} · won {((hint.wins / hint.bets) * 100).toFixed(1)}% vs{" "}
            {hint.needed?.toFixed(1)}% needed · {hint.units > 0 ? "+" : ""}
            {hint.units.toFixed(2)}u
          </p>
        ) : null}
        <p className="font-mono text-[10px] text-faint">
          Each line counts as a 1u bet at the last price saved before kickoff. Lines on the same
          player move together, so a few big games swing the record: wait for a few hundred bets.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-line/10 px-4 py-2.5">
        {MARKETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarket(m)}
            className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ${market === m ? "bg-acc/10 text-acc ring-acc/30" : "text-mute ring-line/10 hover:text-acc"}`}
          >
            {m}
          </button>
        ))}
      </div>
      {rows.some((r) => r.bets) ? (
        <div className="overflow-x-auto border-t border-line/10">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Price</th>
                <th className="px-2 py-2 text-right font-normal">Bets</th>
                <th className="px-2 py-2 text-right font-normal">Won</th>
                <th className="px-2 py-2 text-right font-normal">Needed</th>
                <th className="px-4 py-2 text-right font-normal">Units</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {rows.map((r) => {
                const won = r.bets ? (r.wins / r.bets) * 100 : null;
                return (
                  <tr key={r.label} className={r.label === HINT_BUCKET ? "bg-acc/5" : ""}>
                    <td className="px-4 py-2 font-mono text-[12px]">{r.label}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-mute">
                      {r.bets}
                    </td>
                    <td
                      className={`px-2 py-2 text-right font-mono tabular-nums ${won !== null && r.needed !== null ? (won > r.needed ? "text-win" : "text-loss") : "text-mute"}`}
                    >
                      {won === null ? "—" : `${won.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-mute">
                      {r.needed === null ? "—" : `${r.needed.toFixed(1)}%`}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono tabular-nums ${r.units > 0 ? "text-win" : r.units < 0 ? "text-loss" : "text-mute"}`}
                    >
                      {r.bets ? `${r.units > 0 ? "+" : ""}${r.units.toFixed(2)}u` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border-t border-line/10 px-4 py-4 font-mono text-[11px] text-mute">
          {q.isLoading
            ? "Loading…"
            : "No graded alt lines yet. Ladders are saved from Nov 9; the first games grade after Monday night."}
        </p>
      )}
      {f?.recent.length ? (
        <div className="border-t border-line/10 px-4 py-3">
          <p className="label-mono pb-1.5">Latest −175 to −250 rec / pass yds lines</p>
          <div className="space-y-1 font-mono text-[11px]">
            {f.recent.slice(0, 8).map((r) => (
              <div key={`${r[0]}-${r[1]}-${r[4]}-${r[5]}`} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {r[1]} <span className="text-faint">{r[3]}</span>
                </span>
                <span className="text-mute">
                  {Math.ceil(r[5])}+ {r[4].toLowerCase()} {price(r[6])}
                </span>
                <span className={r[8] === "win" ? "text-win" : "text-loss"}>{r[7]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
