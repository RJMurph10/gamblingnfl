import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { NhlSlate } from "@/components/nhl/NhlSlate";
import { NHL_MODEL_PARAMS } from "@/data/nhl-model-params";
import { projectGame, unitsText, type NhlRecord } from "@/lib/nhl-model";
import { compareNhlModels, TRACK_EDGE, type NhlModelGrade } from "@/lib/nhl-model-v2";
import { useNhlModelInputs, useNhlSchedule } from "@/lib/use-nhl";

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
          "The NHL game model: how the new model compares with the old one and the closing line, its tracked edges against opening prices, and game-by-game probabilities.",
      },
    ],
  }),
  component: NhlModelPage,
});

const rec = (r: NhlRecord) => `${r.wins}-${r.losses}`;
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const num = (v: number | null) => (v === null ? "—" : v.toFixed(3));

function NhlModelPage() {
  const search = Route.useSearch();
  const { games, isLoading, isError } = useNhlSchedule(30_000);
  const { inputs } = useNhlModelInputs();
  const cmp = useMemo(
    () => compareNhlModels(games, (g) => projectGame(g, games), inputs),
    [games, inputs],
  );
  const t = cmp.tracked;
  const moved = t.movedToward + t.movedAgainst;

  const rows: { label: string; g: NhlModelGrade; note: string }[] = [
    { label: "New model (v2)", g: cmp.v2, note: "Goals + last season, shots, starting goalie, rest; calibrated" },
    { label: "Old model (v1)", g: cmp.v1, note: "Goals this season only" },
    { label: "Closing line", g: cmp.book, note: "Sportsbook moneyline with the margin removed (games with a price)" },
  ];

  return (
    <>
      <PageTitle eyebrow="NHL" title="Model" />
      <div className="space-y-6">
        <Panel padded={false}>
          <PanelHeader
            title="New model vs old model"
            aside={<span className="label-mono">{cmp.games} games · each projected from earlier games only</span>}
          />
          {cmp.games ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">Model</th>
                      <th className="px-2 py-2 text-right font-normal">Log loss</th>
                      <th className="px-2 py-2 text-right font-normal">Brier</th>
                      <th className="px-2 py-2 text-right font-normal">Winners</th>
                      <th className="px-2 py-2 text-right font-normal">Rate</th>
                      <th className="px-4 py-2 font-normal">What it is</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {rows.map((r) => (
                      <tr key={r.label}>
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium">{r.label}</td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{num(r.g.logLoss)}</td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{num(r.g.brier)}</td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{rec(r.g.picks)}</td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{pct(r.g.picks.winPct)}</td>
                        <td className="px-4 py-2.5 text-xs text-mute">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-3 text-xs text-mute">
                Log loss and Brier score measure the win probabilities; lower is better (0.693 and 0.250 = always saying
                50%). Graded games use goals to date, last season&apos;s shots and the starter&apos;s earlier seasons; this
                season&apos;s shot and save totals are not kept game by game, so they only enter for upcoming games. Puck-line and
                total records aren&apos;t shown: a win rate without the price says nothing about profit.
              </p>
            </>
          ) : (
            <p className="px-4 py-6 text-center font-mono text-xs text-mute">
              {isLoading ? "Loading games from ESPN…" : "No finished games yet this season."}
            </p>
          )}
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title={`Tracked · ${Math.round(TRACK_EDGE * 100)}+ point edges vs the opening line`}
            aside={<span className="label-mono">1u at the opening moneyline</span>}
          />
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-4">
            <div>
              <p className="label-mono">Record</p>
              <p className="mt-1 font-mono text-xl tabular-nums">{t.bets ? `${t.wins}-${t.losses}` : "—"}</p>
            </div>
            <div>
              <p className="label-mono">Units</p>
              <p className={`mt-1 font-mono text-xl tabular-nums ${t.units > 0 ? "text-win" : t.units < 0 ? "text-loss" : ""}`}>
                {t.bets ? unitsText(t.units) : "—"}
              </p>
            </div>
            <div>
              <p className="label-mono">ROI</p>
              <p className="mt-1 font-mono text-xl tabular-nums">
                {t.roi === null ? "—" : `${t.roi > 0 ? "+" : ""}${t.roi.toFixed(1)}%`}
              </p>
            </div>
            <div>
              <p className="label-mono">Line moved our way</p>
              <p className="mt-1 font-mono text-xl tabular-nums">
                {moved ? `${((t.movedToward / moved) * 100).toFixed(0)}%` : "—"}
              </p>
            </div>
          </div>
          <p className="px-4 pb-3 text-xs text-mute">
            The test from the model audit: bet the side where the model&apos;s win probability beats the no-vig opening price
            by {Math.round(TRACK_EDGE * 100)}+ points. It made +121 units on 2,499 bets in 2009–2022 and the line moved toward
            the pick 75% of the time, but it lost against DraftKings&apos; 2025-26 openers (−12.8 units on 159 bets). Treat
            it as unproven until this season&apos;s sample is large (80–100 bets). Only games where ESPN reports an opening
            moneyline are counted.
          </p>
        </Panel>

        <Panel>
          <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">How the new model works</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">
            <li>
              Expected goals come from each team&apos;s goals for and against, carrying in last season so it works from opening
              night, plus shots on goal for and against.
            </li>
            <li>
              The opponent&apos;s expected starter (most starts this season) counts through his save % over several seasons,
              pulled toward league average. Back-to-backs and 3+ days&apos; rest are included.
            </li>
            <li>
              Each market&apos;s probability is then recalibrated from past seasons, and the overtime chance accounts for how
              often NHL games really are tied after 60 minutes.
            </li>
            <li>
              Tested walk-forward on 19,504 games (2009–2026): more accurate than the old model in all 17 seasons. Parameters
              fitted through {NHL_MODEL_PARAMS.fittedThrough}; refit each summer.
            </li>
            <li>Not modeled: injuries and confirmed starting goalies. Treat the numbers as research, not advice.</li>
          </ul>
        </Panel>

        <NhlSlate games={games} isLoading={isLoading} isError={isError} initialGame={search.game} />
      </div>
    </>
  );
}
