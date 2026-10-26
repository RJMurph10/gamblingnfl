import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { NhlSlate } from "@/components/nhl/NhlSlate";
import { summarizeNhl, unitsText, type NhlRecord } from "@/lib/nhl-model";
import { useNhlSchedule } from "@/lib/use-nhl";

export const Route = createFileRoute("/nhl/model")({
  validateSearch: (search: Record<string, unknown>): { game?: string } => ({
    game: typeof search.game === "string" ? search.game : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Model — GamblingNHL" },
      {
        name: "description",
        content:
          "The NHL goals model: how it has graded against finished games, plus a game-by-game comparison of model probabilities and sportsbook odds.",
      },
    ],
  }),
  component: NhlModelPage,
});

const rec = (r: NhlRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

function NhlModelPage() {
  const search = Route.useSearch();
  const { games, isLoading, isError } = useNhlSchedule(30_000);
  const s = useMemo(() => summarizeNhl(games), [games]);

  const rows: { label: string; record: string; rate: string; note: string }[] = [
    { label: "Moneyline picks", record: rec(s.moneyline), rate: pct(s.moneyline.winPct), note: "Model's more likely winner" },
    {
      label: "Book favorite",
      record: rec(s.marketFavorite),
      rate: pct(s.marketFavorite.winPct),
      note: "Yardstick: sportsbook favorite on the moneyline",
    },
    { label: "Puck line", record: rec(s.puckLine), rate: pct(s.puckLine.winPct), note: "Model's side of the posted line" },
    { label: "Totals", record: rec(s.total), rate: pct(s.total.winPct), note: "Model's over/under of the posted total" },
    {
      label: "+EV moneylines",
      record: `${s.bets.wins}-${s.bets.losses}`,
      rate: s.bets.roi === null ? "—" : `${s.bets.roi > 0 ? "+" : ""}${s.bets.roi.toFixed(1)}% ROI`,
      note: s.bets.count ? `${unitsText(s.bets.units)} on ${s.bets.count} bets, flat 1u` : "No graded bets yet",
    },
  ];

  return (
    <>
      <PageTitle eyebrow="NHL" title="Model" />
      <div className="space-y-6">
        <Panel padded={false}>
          <PanelHeader
            title="How the model has graded"
            aside={<span className="label-mono">{s.games} games · each projected from earlier games only</span>}
          />
          {s.games ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">Market</th>
                      <th className="px-2 py-2 text-right font-normal">Record</th>
                      <th className="px-2 py-2 text-right font-normal">Rate</th>
                      <th className="px-4 py-2 font-normal">What it is</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {rows.map((r) => (
                      <tr key={r.label}>
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium">{r.label}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">{r.record}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">{r.rate}</td>
                        <td className="px-4 py-2.5 text-xs text-mute">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-3 text-xs text-mute">
                Probability quality: Brier {s.brier === null ? "—" : s.brier.toFixed(3)} (0.250 = always saying 50%) · log
                loss {s.logLoss === null ? "—" : s.logLoss.toFixed(3)} (0.693 = always saying 50%). Lower is better. Only
                posted lines are graded, and lines are ESPN&apos;s closing numbers where available. Early in the season the
                sample is small, so these records can swing a lot.
              </p>
            </>
          ) : (
            <p className="px-4 py-6 text-center font-mono text-xs text-mute">
              {isLoading ? "Loading games from ESPN…" : "Not enough finished games yet to grade the model."}
            </p>
          )}
        </Panel>

        <NhlSlate games={games} isLoading={isLoading} isError={isError} initialGame={search.game} />
      </div>
    </>
  );
}
