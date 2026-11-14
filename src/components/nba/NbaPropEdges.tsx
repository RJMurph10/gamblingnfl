import { useState } from "react";
import { Panel, PanelHeader } from "@/components/shared/booth";
import {
  EDGE_TIERS,
  fmtOdds,
  type EdgeFlag,
  type EdgesFile,
  type EdgeTier,
} from "@/lib/nba/nba-edges";
import { useNbaEdges } from "@/lib/nba/use-nba";

const MARKET: Record<EdgeFlag["market"], string> = {
  PTS: "Points",
  REB: "Rebounds",
  AST: "Assists",
  "3PT": "Threes",
};

function TierBadge({ tier }: { tier: EdgeTier }) {
  const cls =
    tier === "10"
      ? "bg-win/20 text-win font-semibold"
      : tier === "6"
        ? "bg-win/10 text-win"
        : "bg-line/10 text-faint";
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}>
      {tier === "4" ? "Track" : `${tier}%+`}
    </span>
  );
}

const units = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;

function tierRecord(f: EdgesFile | null | undefined, tier: EdgeTier) {
  const [w, l, p, u] = f?.record?.[tier] ?? [0, 0, 0, 0];
  return { w, l, p, u, roi: w + l ? (u / (w + l)) * 100 : null };
}

/** Today's flagged props (one book's line or price off the other books' consensus) and the record by tier. */
export function NbaPropEdges() {
  const q = useNbaEdges();
  const f = q.data;
  const [showTrack, setShowTrack] = useState(false);
  const now = Date.now();
  const open = (f?.flags ?? [])
    .filter((x) => !x.res && Date.parse(x.start) > now - 3 * 3_600_000)
    .filter((x) => showTrack || x.tier !== "4")
    .sort((a, b) => b.ev - a.ev);
  const recent = (f?.flags ?? [])
    .filter((x) => x.res && x.res !== "void" && x.tier !== "4")
    .slice(-10)
    .reverse();
  const bets = ["10", "6"].map((t) => tierRecord(f, t as EdgeTier));
  const bw = bets[0].w + bets[1].w;
  const bl = bets[0].l + bets[1].l;
  const bu = bets[0].u + bets[1].u;

  return (
    <Panel padded={false}>
      <PanelHeader
        title="Prop edge finder"
        aside={
          <span className="label-mono">
            {q.isLoading
              ? "Loading…"
              : bw + bl
                ? `Bets ${bw}-${bl} · ${units(bu)}`
                : "No graded bets yet"}
          </span>
        }
      />
      <div className="space-y-2 px-4 py-3 text-sm text-mute">
        <p>
          <span className="font-semibold text-foreground">
            A book whose line or price is off what the other books say.
          </span>{" "}
          Every book&apos;s points, rebounds, assists and threes line becomes an expected stat (line
          plus how far the no-vig price leans); the other books&apos; average is the consensus, and
          the edge is the expected value of betting that book&apos;s side at its own price. Bet 6%+
          at 1 unit; 4–6% is tracked only.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {EDGE_TIERS.map((t) => {
            const r = tierRecord(f, t.tier);
            return (
              <div key={t.tier} className="rounded border border-line/10 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                    {t.label}
                  </span>
                  <TierBadge tier={t.tier} />
                </div>
                <div className="mt-1 font-mono text-sm tabular-nums text-foreground">
                  {r.w + r.l ? `${r.w}-${r.l}${r.p ? `-${r.p}` : ""}` : "—"}
                </div>
                <div
                  className={`font-mono text-[11px] tabular-nums ${r.u > 0 ? "text-win" : r.u < 0 ? "text-loss" : "text-faint"}`}
                >
                  {r.w + r.l
                    ? `${units(r.u)} · ROI ${r.roi! > 0 ? "+" : ""}${r.roi!.toFixed(1)}%`
                    : `backtest ${t.backtest}`}
                </div>
              </div>
            );
          })}
        </div>
        <p className="font-mono text-[10px] text-faint">
          Backtest: 2023-24 closing lines at 6 books. Live lines move, so expect less; checked once
          a day (about 6pm Eastern), and each prop is graded at the line and price when first
          flagged.
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-line/10 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          Today · {open.length} {open.length === 1 ? "prop" : "props"}
        </span>
        <button
          type="button"
          onClick={() => setShowTrack((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-wider text-mute hover:text-foreground"
        >
          {showTrack ? "Hide 4–6%" : "Show 4–6%"}
        </button>
      </div>
      {open.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Player</th>
                <th className="px-2 py-2 font-normal">Bet</th>
                <th className="px-2 py-2 font-normal">Book</th>
                <th className="px-2 py-2 text-right font-normal">Price</th>
                <th className="px-2 py-2 text-right font-normal">Others</th>
                <th className="px-2 py-2 text-right font-normal">EV</th>
                <th className="px-4 py-2 text-right font-normal">Tier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {open.map((x) => (
                <tr key={x.id} className={x.tier === "10" ? "bg-win/5" : undefined}>
                  <td className="px-4 py-2">
                    {x.player}
                    <div className="font-mono text-[10px] text-faint">
                      {x.away} @ {x.home}
                    </div>
                  </td>
                  <td className="px-2 py-2 font-mono text-[12px]">
                    {x.side === "over" ? "o" : "u"}
                    {x.line} {MARKET[x.market]}
                  </td>
                  <td className="px-2 py-2 text-[12px] text-mute">{x.book}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">
                    {fmtOdds(x.price)}
                  </td>
                  <td
                    className="px-2 py-2 text-right font-mono text-[11px] tabular-nums text-mute"
                    title={`${x.books} books`}
                  >
                    {x.consLine}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-win">
                    +{(x.ev * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right">
                    <TierBadge tier={x.tier} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 pb-3 text-sm text-faint">
          {q.isLoading
            ? ""
            : "No flagged props right now. The board is checked once a day before the evening games."}
        </p>
      )}

      {recent.length ? (
        <div className="overflow-x-auto border-t border-line/10">
          <div className="px-4 pt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            Recent bets
          </div>
          <table className="w-full min-w-[560px] text-sm">
            <tbody className="divide-y divide-line/5">
              {recent.map((x) => (
                <tr key={x.id}>
                  <td
                    className="px-4 py-2 font-mono text-[11px] text-mute"
                    suppressHydrationWarning
                  >
                    {new Date(x.start).toLocaleDateString([], { month: "numeric", day: "numeric" })}
                  </td>
                  <td className="px-2 py-2">{x.player}</td>
                  <td className="px-2 py-2 font-mono text-[12px]">
                    {x.side === "over" ? "o" : "u"}
                    {x.line} {x.market}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums text-mute">
                    {x.book} {fmtOdds(x.price)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono tabular-nums ${x.res === "win" ? "text-win" : x.res === "loss" ? "text-loss" : "text-mute"}`}
                  >
                    {x.actual ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}
