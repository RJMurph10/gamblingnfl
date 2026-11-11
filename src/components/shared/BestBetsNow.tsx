/**
 * "Best bets now": a sport's upcoming ★ picks, listed right under its model cards. For each pick: the bet,
 * the opener vs the line now, how much edge is left at the current number, and when to bet it.
 * Status for bet-now picks backed by a model number: "Still good" while the edge at the current line is
 * still at the ★ size, "Partly gone" while it's at least the everyday pick size, "Gone" below that.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { bestLineFor, type ShopLeague, type ShopRequest } from "@/lib/shared/best-lines";
import { getBestLines } from "@/lib/shared/best-lines.functions";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { BetTiming, type BetTimingKind } from "@/components/shared/BetTiming";

export interface BestBetItem {
  id: string;
  matchup: ReactNode;
  /** Kickoff / tip ISO time. */
  when: string;
  /** "Under", "Over", or a team abbreviation (spread picks). */
  pick: string;
  /** Line the pick is graded at / current line, from the picked side's view. */
  open: number | null;
  now: number | null;
  /** The model's number, same units as the line; null for rule picks (no model number). */
  model: number | null;
  /** +1 when a higher line favors the pick (over), -1 when a lower one does (under, or a spread pick). */
  dir: 1 | -1;
  /** ★ edge size and the everyday pick size, for the status. */
  bestEdge?: number;
  minEdge?: number;
  timing: BetTimingKind | null;
  /** Short context: "14 mph wind", "Low-major", "home dog". */
  note?: string;
  /** Spread picks show a sign. */
  spread?: boolean;
  /** Line shopping: full team names and the side, to find the best number at every book. */
  shop?: ShopRequest;
}

const fmt = (n: number | null, spread?: boolean) =>
  n === null ? "—" : spread ? (n > 0 ? `+${n}` : n === 0 ? "PK" : String(n)) : String(n);
const whenText = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

function status(b: BestBetItem): { text: string; tone: string } {
  if (b.timing === "late") return { text: "Wait", tone: "text-mute" };
  if (b.model === null || b.now === null || b.bestEdge === undefined)
    return { text: b.timing === "now" ? "Still good" : "Any time", tone: "text-win" };
  // spread picks: the line is from the picked side, where a bigger number is better (dir -1 means lower is better)
  const left = (b.model - b.now) * b.dir;
  if (left >= b.bestEdge) return { text: "Still good", tone: "text-win" };
  if (left >= (b.minEdge ?? 0)) return { text: "Partly gone", tone: "text-acc" };
  return { text: "Gone", tone: "text-loss" };
}

export function BestBetsNow({
  items,
  loading,
  empty,
  footnote,
  league,
}: {
  items: BestBetItem[];
  loading?: boolean;
  empty: string;
  footnote?: ReactNode;
  /** Line shopping across books (NFL, NBA, college basketball). */
  league?: ShopLeague;
}) {
  const shop = useQuery({
    queryKey: ["best-lines", league],
    queryFn: () => getBestLines({ data: { league: league! } }),
    enabled: !!league,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const now = Date.now();
  const list = items
    .filter((b) => Date.parse(b.when) > now)
    .sort((a, b) => a.when.localeCompare(b.when));
  return (
    <Panel padded={false} className="mb-6">
      <PanelHeader
        title="★ Best bets now"
        aside={
          <span className="label-mono">{loading ? "Loading…" : `${list.length} upcoming`}</span>
        }
      />
      {list.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Game</th>
                <th className="px-2 py-2 font-normal">Bet</th>
                {league ? <th className="px-2 py-2 font-normal">Best number</th> : null}
                <th className="px-2 py-2 font-normal">Status</th>
                <th className="px-2 py-2 font-normal">When</th>
                <th className="px-2 py-2 text-right font-normal">Opened</th>
                <th className="px-2 py-2 text-right font-normal">Now</th>
                <th className="px-4 py-2 text-right font-normal">Model</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {list.map((b) => {
                const st = status(b);
                // the number you can bet right now
                const line = b.now ?? b.open;
                const best = league && b.shop ? bestLineFor(shop.data, b.shop, b.when) : null;
                // points better than the line shown (DraftKings), from the pick's side
                const gain =
                  best && line !== null
                    ? Math.round(
                        (b.shop!.side === "over" ? line - best.line : best.line - line) * 10,
                      ) / 10
                    : null;
                return (
                  <tr key={b.id} className="hover:bg-line/5">
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs">{b.matchup}</div>
                      <div className="font-mono text-[10px] text-faint" suppressHydrationWarning>
                        {whenText(b.when)}
                        {b.note ? ` · ${b.note}` : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-sm font-semibold text-foreground">
                      <span className="mr-1 text-acc">★</span>
                      {b.pick} {fmt(line, b.spread)}
                    </td>
                    {league ? (
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px]">
                        {best ? (
                          <span
                            title={`${best.books} books${best.at ? ` · as of ${new Date(best.at).toLocaleString()}` : ""}`}
                          >
                            <span
                              className={
                                gain && gain > 0 ? "font-semibold text-win" : "text-foreground"
                              }
                            >
                              {fmt(best.line, b.spread)}
                              {best.price !== null
                                ? ` (${best.price > 0 ? "+" : ""}${best.price})`
                                : ""}
                            </span>{" "}
                            <span className="text-mute">{best.book}</span>
                            {gain && gain > 0 ? <span className="text-win"> +{gain}</span> : null}
                          </span>
                        ) : (
                          <span className="text-faint">{shop.isLoading ? "…" : "—"}</span>
                        )}
                      </td>
                    ) : null}
                    <td
                      className={`whitespace-nowrap px-2 py-2 font-mono text-[11px] uppercase tracking-wider ${st.tone}`}
                    >
                      {st.text}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {b.timing ? <BetTiming kind={b.timing} /> : null}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-mute">
                      {fmt(b.open, b.spread)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-mute">
                      {fmt(b.now, b.spread)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-faint">
                      {b.model === null ? "—" : b.model.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-3 font-mono text-[11px] text-mute">{loading ? "Loading…" : empty}</p>
      )}
      {footnote ? (
        <p className="border-t border-line/10 px-4 py-2 font-mono text-[10px] text-faint">
          {footnote}
        </p>
      ) : null}
    </Panel>
  );
}
