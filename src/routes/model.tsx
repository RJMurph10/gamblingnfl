import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MatchupLink, PageTitle, Panel, PanelHeader, StatCard, TeamLogo } from "@/components/booth";
import { gameScore, type Game } from "@/data/games";
import { teamById } from "@/data/teams";
import { getLiveSchedule, getPriorSeasonResults } from "@/lib/espn.functions";
import {
  MODEL_SETTINGS,
  summarizeModel,
  unitsText,
  type GameModelRow,
  type Market,
  type MarketRecord,
  type ModelPick,
} from "@/lib/game-model";
import { getNflHistory } from "@/lib/history.functions";
import { useKickoffForecasts, WatchList } from "@/components/WatchList";
import { pastSeasonRuns, readHistory, runModelWithHistory } from "@/lib/model-history";
import { notesForRow, type PickNote } from "@/lib/pick-notes";

export const Route = createFileRoute("/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingNFL" },
      {
        name: "description",
        content:
          "GamblingNFL's game model: predicted spreads, totals and win probabilities, its picks against the line, and its record in units.",
      },
      { property: "og:title", content: "Model — GamblingNFL" },
      {
        property: "og:description",
        content: "Model picks, accuracy and units won at a flat stake.",
      },
    ],
  }),
  component: ModelPage,
});

const MARKET_LABEL: Record<Market, string> = {
  spread: "Spread",
  total: "Total",
  moneyline: "Moneyline",
};

const oddsText = (o?: number) => (o === undefined ? "—" : o > 0 ? `+${o}` : String(o));
const lineText = (n: number) => (n === 0 ? "PK" : n > 0 ? `+${n}` : String(n));
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Plain-text pick, e.g. "CHI -3.5", "Over 44.5", "CHI ML" (used for tooltips and screen readers). */
function pickLabel(pick: ModelPick, game: Game): string {
  const home = teamById(game.homeTeamId);
  const away = teamById(game.awayTeamId);
  const team = pick.side === "home" ? home : away;
  if (pick.market === "spread") return `${team?.abbr ?? ""} ${lineText(pick.line ?? 0)}`;
  if (pick.market === "total") return `${pick.side === "over" ? "Over" : "Under"} ${pick.line}`;
  return `${team?.abbr ?? ""} ML`;
}

/** Pick as shown: team logo + line for spreads ("[logo] +7.5"), logo + ML, or "Over 44.5". */
function PickLabel({ pick, game }: { pick: ModelPick; game: Game }) {
  if (pick.market === "total") return <span>{pickLabel(pick, game)}</span>;
  const team = teamById(pick.side === "home" ? game.homeTeamId : game.awayTeamId);
  if (!team) return <span>{pickLabel(pick, game)}</span>;
  return (
    <span className="inline-flex items-center gap-1" title={`${team.city} ${team.name}`}>
      <TeamLogo team={team} className="size-4" />
      <span className="sr-only">{team.abbr} </span>
      {pick.market === "spread" ? lineText(pick.line ?? 0) : "ML"}
    </span>
  );
}

const edgeText = (pick: ModelPick) =>
  pick.market === "moneyline" ? `+${(pick.edge * 100).toFixed(1)}%` : `${one(pick.edge)} pts`;

const resultClass = (r: ModelPick["result"]) =>
  r === "win" ? "text-win" : r === "loss" ? "text-loss" : "text-mute";

function recordText(r: MarketRecord) {
  return `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
}

function Matchup({ game }: { game: Game }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  if (!away || !home) return null;
  return (
    <Link
      to="/games/$gameId"
      params={{ gameId: game.id }}
      title={`${away.city} ${away.name} @ ${home.city} ${home.name}`}
      aria-label={`${away.city} ${away.name} at ${home.city} ${home.name}`}
      className="inline-flex items-center gap-2 whitespace-nowrap font-medium transition-opacity hover:opacity-80"
    >
      <TeamLogo team={away} className="size-6" />
      <span className="text-faint">@</span>
      <TeamLogo team={home} className="size-6" />
    </Link>
  );
}

function HomeLogo({ game }: { game: Game }) {
  const home = teamById(game.homeTeamId);
  return home ? <TeamLogo team={home} className="size-4" /> : null;
}

/** Finals exactly like the dashboard's Recent games: score [logo] @ [logo] score. */
function FinalMatchup({ game }: { game: Game }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  if (!away || !home) return null;
  const score = gameScore(game);
  return (
    <MatchupLink
      game={game}
      away={away}
      home={home}
      awayScore={score.away}
      homeScore={score.home}
      showOT={game.quarters.away.length > 4 || game.quarters.home.length > 4}
    />
  );
}

function PickChip({ pick, game }: { pick: ModelPick; game: Game }) {
  return (
    <span
      title={`${
        pick.best
          ? pick.reason === "wind" && pick.wind !== undefined
            ? `Best bet (wind ${Math.round(pick.wind)} mph) · `
            : pick.reason === "qb-style"
              ? "Best bet (scrambler vs pocket passer) · "
              : "Best bet (7+ point underdog) · "
          : "Lean · "
      }${MARKET_LABEL[pick.market]} · edge ${edgeText(pick)}${
        pick.modelProb !== undefined ? ` · model ${(pick.modelProb * 100).toFixed(0)}%` : ""
      }`}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] ring-1 ${
        pick.best ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10"
      }`}
    >
      {pick.best ? <span aria-label="Best bet">★</span> : null}
      <span
        className={`text-[9px] uppercase tracking-wider ${pick.best ? "text-acc/70" : "text-faint"}`}
      >
        {MARKET_LABEL[pick.market]}
      </span>
      <PickLabel pick={pick} game={game} />
      <span className="text-mute">{oddsText(pick.odds)}</span>
    </span>
  );
}

const NOTE_ICON: Record<PickNote["kind"], string> = {
  qb: "QB",
  key: "KEY",
  move: "LINE",
  wind: "WIND",
  style: "QB STYLE",
};

/** QB changes, key numbers and line movement under a game's picks. */
function RowNotes({ row }: { row: GameModelRow }) {
  const notes = notesForRow(row);
  if (!notes.length) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {notes.map((n) => (
        <li key={n.kind + n.text} className="flex items-baseline gap-1.5 text-[11px]">
          <span className="font-mono text-[9px] uppercase tracking-wider text-faint">
            {NOTE_ICON[n.kind]}
          </span>
          <span
            className={
              n.tone === "good" ? "text-win" : n.tone === "bad" ? "text-loss" : "text-mute"
            }
          >
            {n.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Cumulative units by week: bars for each week's result, running total above. */
function UnitsByWeek({ data }: { data: { week: number; units: number; weekUnits: number }[] }) {
  if (data.length === 0)
    return (
      <p className="px-4 py-6 text-center font-mono text-xs text-mute">No graded picks yet.</p>
    );
  const max = Math.max(1, ...data.map((d) => Math.abs(d.weekUnits)));
  return (
    <div
      className="flex items-stretch gap-2 overflow-x-auto px-4 py-4"
      role="img"
      aria-label="Units won by week"
    >
      {data.map((d) => {
        const h = Math.max(3, Math.round((Math.abs(d.weekUnits) / max) * 48));
        const up = d.weekUnits >= 0;
        return (
          <div key={d.week} className="flex w-14 shrink-0 flex-col items-center gap-1">
            <span
              className={`font-mono text-[10px] tabular-nums ${d.units >= 0 ? "text-win" : "text-loss"}`}
            >
              {unitsText(d.units)}
            </span>
            <div className="flex h-24 w-full flex-col justify-center">
              <div className="flex h-12 items-end">
                {up ? (
                  <div className="w-full rounded-t-sm bg-win/70" style={{ height: h }} />
                ) : null}
              </div>
              <div className="h-px w-full bg-line/20" />
              <div className="flex h-12 items-start">
                {!up ? (
                  <div className="w-full rounded-b-sm bg-loss/70" style={{ height: h }} />
                ) : null}
              </div>
            </div>
            <span className="font-mono text-[10px] tabular-nums text-mute">
              {unitsText(d.weekUnits)}
            </span>
            <span className="font-mono text-[9px] uppercase text-faint">Wk {d.week}</span>
          </div>
        );
      })}
    </div>
  );
}

/** One season's line in the track record: winner, spread, total, best bets. */
function TrackRecord({ seasons }: { seasons: { label: string; rows: GameModelRow[] }[] }) {
  const cell = (r: MarketRecord) => (
    <td className="px-3 py-2 text-right font-mono tabular-nums">
      <span>{recordText(r)}</span>
      <span className="ml-2 text-mute">{r.winPct === null ? "—" : `${one(r.winPct)}%`}</span>
    </td>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line/10 text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-3 py-2 font-normal">Season</th>
            <th className="px-3 py-2 text-right font-normal">Winner</th>
            <th className="px-3 py-2 text-right font-normal">Spread</th>
            <th className="px-3 py-2 text-right font-normal">Over / under</th>
            <th className="px-3 py-2 text-right font-normal">★ Best bets</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map(({ label, rows }) => {
            const p = summarizeModel(rows, "predictions");
            const b = summarizeModel(rows, "bets");
            return (
              <tr key={label} className="border-b border-line/10 last:border-0">
                <td className="px-3 py-2 font-mono">{label}</td>
                {cell(p.byMarket.moneyline)}
                {cell(p.byMarket.spread)}
                {cell(p.byMarket.total)}
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {b.overall.wins + b.overall.losses + b.overall.pushes === 0 ? (
                    <span className="text-mute">none</span>
                  ) : (
                    <>
                      <span>{recordText(b.overall)}</span>
                      <span className="ml-2 text-mute">
                        {b.overall.winPct === null ? "—" : `${one(b.overall.winPct)}%`}
                      </span>
                      <span
                        className={`ml-2 ${b.overall.units > 0 ? "text-win" : b.overall.units < 0 ? "text-loss" : "text-mute"}`}
                      >
                        {unitsText(b.overall.units)}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ModelPage() {
  const scheduleQuery = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    refetchInterval: 60_000,
    staleTime: 10_000,
    retry: 1,
  });
  const games: Game[] = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data]);
  // Last season's scores give the model a head start in the first weeks.
  const priorQuery = useQuery({
    queryKey: ["prior-season-results"],
    queryFn: () => getPriorSeasonResults(),
    staleTime: 12 * 60 * 60_000,
    retry: 1,
  });
  const priorSeason = useMemo(() => priorQuery.data ?? [], [priorQuery.data]);
  // Results since 2022 (nflverse): past seasons calibrate the model, so its trust in itself
  // rests on hundreds of graded games; this season's rows carry recorded kickoff weather.
  const historyQuery = useQuery({
    queryKey: ["nfl-history-v2"],
    queryFn: () => getNflHistory(),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  const {
    games: allHistory,
    currentSeason,
    upcoming,
    qbRows,
  } = useMemo(() => readHistory(historyQuery.data), [historyQuery.data]);
  // QB games since 2020 feed the QB styles (scrambler vs pocket passer best bets).
  const runOptions = useMemo(() => ({ qbRows }), [qbRows]);
  const history = useMemo(
    () => allHistory.filter((h) => h.season < currentSeason),
    [allHistory, currentSeason],
  );
  // Next week's kickoff forecasts: 10+ mph wind makes the under a ★ best bet.
  const slateWeek = useMemo(() => {
    const open = games.filter((g) => g.status !== "final").map((g) => g.week);
    return open.length ? Math.min(...open) : null;
  }, [games]);
  const { forecasts } = useKickoffForecasts(games, slateWeek);
  // This season's starters (finished + projected) feed the quarterback ratings; its recorded
  // weather and the forecasts feed the wind best bets.
  const current = useMemo(
    () => ({
      season: currentSeason,
      games: allHistory.filter((h) => h.season === currentSeason),
      upcoming,
      forecasts,
    }),
    [allHistory, currentSeason, upcoming, forecasts],
  );
  const rows = useMemo(
    () => runModelWithHistory(games, priorSeason, history, current, runOptions),
    [games, priorSeason, history, current, runOptions],
  );
  const trackRecord = useMemo(() => {
    const past = pastSeasonRuns(history, runOptions);
    const lastPast = past.at(-1)?.season;
    return [
      { label: lastPast ? `${lastPast + 1} so far` : "This season", rows },
      ...past.map((r) => ({ label: String(r.season), rows: r.rows })).reverse(),
    ];
  }, [rows, history, runOptions]);
  const qbRuns = useMemo(
    () => [
      ...pastSeasonRuns(history, runOptions),
      ...(currentSeason ? [{ season: currentSeason, rows }] : []),
    ],
    [history, currentSeason, rows, runOptions],
  );
  // Every game's call (winner, spread side, over/under), and the best bets on their own.
  const summary = useMemo(() => summarizeModel(rows, "predictions"), [rows]);
  const bets = useMemo(() => summarizeModel(rows, "bets"), [rows]);
  const latestCalibration = useMemo(
    () => [...rows].reverse().find((r) => r.calibration)?.calibration,
    [rows],
  );
  const [market, setMarket] = useState<Market | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const [scope, setScope] = useState<"predictions" | "bets">("predictions");
  const GRADED_PAGE = 40;

  // Upcoming slate: the next week that still has games to play.
  const nextWeek = useMemo(() => {
    const open = rows.filter((r) => r.game.status !== "final").map((r) => r.game.week);
    return open.length ? Math.min(...open) : null;
  }, [rows]);
  const slate = rows
    .filter((r) => r.game.week === nextWeek && r.game.status !== "final")
    .sort((a, b) => (a.game.kickoffIso ?? "").localeCompare(b.game.kickoffIso ?? ""));

  const graded: { pick: ModelPick; row: GameModelRow }[] = rows
    .flatMap((row) =>
      (scope === "bets" ? row.picks : row.predictions)
        .filter((p) => p.result !== "pending")
        .map((pick) => ({ pick, row })),
    )
    .filter(({ pick }) => market === "all" || pick.market === market)
    .sort(
      (a, b) =>
        b.pick.week - a.pick.week ||
        (b.row.game.kickoffIso ?? "").localeCompare(a.row.game.kickoffIso ?? ""),
    );

  const o = summary.overall;
  const CARD_LABEL: Record<Market, string> = {
    moneyline: "Winner · every game",
    spread: "Against the spread",
    total: "Over / under",
  };
  const card = (m: Market) => {
    const r = summary.byMarket[m];
    return (
      <StatCard
        key={m}
        label={CARD_LABEL[m]}
        value={recordText(r)}
        note={`${r.winPct === null ? "—" : `${one(r.winPct)}%`} · ${unitsText(r.units)}`}
        tone={r.units > 0 ? "win" : r.units < 0 ? "loss" : "mute"}
      />
    );
  };

  return (
    <>
      <PageTitle eyebrow={`${MODEL_SETTINGS.version} · flat 1 unit per pick`} title="Model" />

      {scheduleQuery.isLoading ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            Loading the schedule and lines…
          </p>
        </Panel>
      ) : games.length === 0 ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            The schedule couldn&apos;t be loaded right now.
          </p>
        </Panel>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="Units · every game"
              value={unitsText(o.units)}
              note={
                o.roi === null ? "No graded picks yet" : `ROI ${o.roi > 0 ? "+" : ""}${one(o.roi)}%`
              }
              tone={o.units > 0 ? "win" : o.units < 0 ? "loss" : "mute"}
            />
            {(["moneyline", "spread", "total"] as Market[]).map(card)}
            <StatCard
              label="★ Best bets"
              value={recordText(bets.overall)}
              note={`${bets.overall.winPct === null ? "—" : `${one(bets.overall.winPct)}% won`} · ${unitsText(bets.overall.units)}`}
              tone={bets.overall.units > 0 ? "win" : bets.overall.units < 0 ? "loss" : "mute"}
            />
          </div>

          {latestCalibration ? (
            <Panel>
              <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">
                What the model has learned
              </h2>
              <p className="mt-1 text-sm text-mute">
                From {latestCalibration.samples} graded games (past seasons plus this one before the
                next slate). It starts from the betting line and only moves off it as far as its own
                track record says it should.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <p className="label-mono">Trust vs market · spreads</p>
                  <p className="mt-1 font-mono text-xl tabular-nums">
                    {Math.round(latestCalibration.spreadWeight * 100)}%
                  </p>
                </div>
                <div>
                  <p className="label-mono">Trust vs market · totals</p>
                  <p className="mt-1 font-mono text-xl tabular-nums">
                    {Math.round(latestCalibration.totalWeight * 100)}%
                  </p>
                </div>
                <div>
                  <p className="label-mono">Scoring vs totals</p>
                  <p className="mt-1 font-mono text-xl tabular-nums">
                    {latestCalibration.totalBias > 0 ? "+" : ""}
                    {latestCalibration.totalBias.toFixed(1)} pts
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-faint">
                0% trust = the model&apos;s disagreements haven&apos;t predicted results yet, so it
                stays on the betting line. The number rises only if its disagreements keep beating
                the closing line.
              </p>
            </Panel>
          ) : null}

          <Panel padded={false}>
            <PanelHeader
              title="Track record by season"
              aside={
                <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                  Same model · walk-forward · closing lines
                </span>
              }
            />
            <TrackRecord seasons={trackRecord} />
            <p className="px-4 pb-3 pt-2 text-[11px] text-faint">
              Each past season is replayed week by week with only the games before each week, the
              way it would have run live. Winner = the team it expected to win; spread and over /
              under are its lean on every game against the closing line.
            </p>
          </Panel>

          {currentSeason ? (
            <WatchList
              history={allHistory}
              currentSeason={currentSeason}
              schedule={games}
              nextWeek={nextWeek}
              modelRuns={qbRuns}
            />
          ) : null}

          <Panel padded={false}>
            <PanelHeader
              title="Units by week"
              aside={
                <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                  Running total above
                </span>
              }
            />
            <UnitsByWeek data={summary.unitsByWeek} />
          </Panel>

          <Panel padded={false}>
            <PanelHeader
              title={nextWeek ? `Week ${nextWeek} picks` : "Upcoming picks"}
              aside={
                <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                  Lines update until kickoff
                </span>
              }
            />
            {slate.length === 0 ? (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                No upcoming games.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">Matchup</th>
                      <th className="px-2 py-2 font-normal">Kickoff</th>
                      <th
                        className="px-2 py-2 text-right font-normal"
                        title="Home line: model vs market"
                      >
                        Spread (home)
                      </th>
                      <th className="px-2 py-2 text-right font-normal">Total</th>
                      <th className="px-2 py-2 text-right font-normal">Home win</th>
                      <th className="px-4 py-2 font-normal">Picks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {slate.map((row) => (
                      <tr key={row.game.id} className="hover:bg-line/5">
                        <td className="px-4 py-2.5">
                          <Matchup game={row.game} />
                        </td>
                        <td
                          suppressHydrationWarning
                          className="px-2 py-2.5 font-mono text-[11px] text-mute"
                        >
                          {row.game.status === "live"
                            ? "Live"
                            : row.game.kickoffIso
                              ? new Date(row.game.kickoffIso).toLocaleString("en-US", {
                                  weekday: "short",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : "TBD"}
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                          <span className="inline-flex items-center gap-1 align-middle">
                            <HomeLogo game={row.game} />
                            {row.prediction
                              ? lineText(Math.round(row.prediction.homeLine * 2) / 2)
                              : "—"}
                          </span>
                          <span className="ml-1 text-[11px] text-faint">
                            mkt {row.marketHomeLine === null ? "—" : lineText(row.marketHomeLine)}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                          {row.prediction ? one(row.prediction.total) : "—"}
                          <span className="ml-1 text-[11px] text-faint">
                            mkt {row.marketTotal ?? "—"}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">
                          {row.prediction
                            ? `${Math.round(row.prediction.homeWinProb * 100)}%`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.skipped ? (
                            <span className="text-[11px] text-faint">{row.skipped}</span>
                          ) : (
                            <>
                              <div className="flex flex-wrap gap-1.5">
                                {row.predictions.map((p) => (
                                  <PickChip key={p.market} pick={p} game={row.game} />
                                ))}
                              </div>
                              <RowNotes row={row} />
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel padded={false}>
            <PanelHeader
              title="Graded picks"
              aside={
                <div className="flex flex-wrap gap-1" role="group" aria-label="Filter graded picks">
                  {(
                    [
                      ["predictions", "Every game"],
                      ["bets", "★ Best bets"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={scope === key}
                      onClick={() => setScope(key)}
                      className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ${
                        scope === key
                          ? "bg-acc/10 text-acc ring-acc/25"
                          : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="mx-1 w-px self-stretch bg-line/10" aria-hidden />
                  {(["all", "spread", "total", "moneyline"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={market === m}
                      onClick={() => setMarket(m)}
                      className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ${
                        market === m
                          ? "bg-acc/10 text-acc ring-acc/25"
                          : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                      }`}
                    >
                      {m === "all" ? "All" : MARKET_LABEL[m]}
                    </button>
                  ))}
                </div>
              }
            />
            {graded.length === 0 ? (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                No graded picks yet.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                        <th className="px-4 py-2 font-normal">Wk</th>
                        <th className="px-2 py-2 text-center font-normal">Final</th>
                        <th className="px-2 py-2 font-normal">Pick</th>
                        <th className="px-2 py-2 text-right font-normal">Odds</th>
                        <th className="px-2 py-2 text-right font-normal">Edge</th>
                        <th className="px-2 py-2 text-right font-normal">Result</th>
                        <th className="px-4 py-2 text-right font-normal">Units</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/5">
                      {(showAll ? graded : graded.slice(0, GRADED_PAGE)).map(({ pick, row }) => (
                        <tr key={`${row.game.id}-${pick.market}`} className="hover:bg-line/5">
                          <td className="px-4 py-2.5 font-mono text-mute">{pick.week}</td>
                          <td className="px-2 py-2.5 text-center">
                            <FinalMatchup game={row.game} />
                          </td>
                          <td className="px-2 py-2.5 font-mono">
                            <span className="mr-1.5 text-[9px] uppercase tracking-wider text-faint">
                              {MARKET_LABEL[pick.market]}
                            </span>
                            <PickLabel pick={pick} game={row.game} />
                            {pick.best ? (
                              <span
                                className="ml-1.5 text-acc"
                                title="Best bet"
                                aria-label="Best bet"
                              >
                                ★
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">
                            {oddsText(pick.odds)}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">
                            {edgeText(pick)}
                          </td>
                          <td
                            className={`px-2 py-2.5 text-right font-mono text-[11px] uppercase tracking-wider ${resultClass(pick.result)}`}
                          >
                            {pick.result}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums ${resultClass(pick.result)}`}
                          >
                            {unitsText(pick.units)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {graded.length > GRADED_PAGE ? (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="block w-full border-t border-line/10 px-4 py-2.5 text-center font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5"
                  >
                    {showAll ? "Show latest 40" : `Show all ${graded.length} graded picks`}
                  </button>
                ) : null}
              </>
            )}
          </Panel>

          <Panel>
            <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">
              How the model works
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">
              <li>
                Rates every team&apos;s offense and defense from this season&apos;s final scores,
                adjusted for opponents and home field, then predicts each game&apos;s score. That
                gives a model spread, total and win probability. Yards-per-play and EPA ratings were
                tested over three seasons and didn&apos;t beat final scores, so they aren&apos;t
                used.
              </li>
              <li>
                Only games from earlier weeks are used to predict a week, so the record above is
                what the model would have picked at the time. Teams need{" "}
                {MODEL_SETTINGS.minGamesPerTeam} games played before it bets them.
              </li>
              <li>
                Starts from the betting line. Each week it checks, on earlier games only (every past
                season since 2023 plus this one), how much its disagreements with the closing line
                actually predicted the result, and moves its line off the market only that far (the
                &quot;trust&quot; above). It also learns how much its own ratings squeeze games
                toward even, and whether games have been running over or under the totals. Win
                chances start from the moneyline&apos;s no-vig price, so the winner call is the
                market&apos;s favorite unless the model has earned the right to disagree.
              </li>
              <li>
                Every game gets a call on all three markets: the winner, a spread side and over /
                under. Those are leans, graded so the record is complete.
              </li>
              <li>
                ★ Best bets: every underdog getting {MODEL_SETTINGS.bigUnderdogPts}+ points, against
                the spread (big favorites have been overrated in every season since 2022), and the
                under in every outdoor game with {MODEL_SETTINGS.windUnderMph}+ mph of wind at
                kickoff (469-361 since 2012; picked on 2012–2021 and confirmed on 2022–2026 games it
                had never seen). Upcoming wind uses the National Weather Service forecast; finished
                games use the wind recorded at kickoff. Past results don&apos;t guarantee future
                ones; the track record above keeps score.
              </li>
              <li>
                Every pick risks {MODEL_SETTINGS.stake} unit. Spreads and totals are graded at the
                standard {MODEL_SETTINGS.defaultPrice}; moneylines at their closing ESPN price.
                Pushes return the stake. Picks for upcoming games can change until kickoff as the
                lines move.
              </li>
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
