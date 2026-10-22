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
import { pastSeasonRuns, runModelWithHistory, type HistoryGame } from "@/lib/model-history";

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
      title={`${pick.best ? "Best bet · " : "Lean · "}${MARKET_LABEL[pick.market]} · edge ${edgeText(pick)}${
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
  // Calibrated on every past season too, so its trust in itself rests on ~800 graded games.
  // Past seasons' scores and closing lines (nflverse), so the model's trust in itself rests on
  // hundreds of graded games and the track record covers every season since 2023.
  const historyQuery = useQuery({
    queryKey: ["nfl-history"],
    queryFn: () => getNflHistory(),
    staleTime: 12 * 60 * 60_000,
    retry: 1,
  });
  const history: HistoryGame[] = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);
  const rows = useMemo(
    () => runModelWithHistory(games, priorSeason, history),
    [games, priorSeason, history],
  );
  const trackRecord = useMemo(() => {
    const past = pastSeasonRuns(history);
    const lastPast = past.at(-1)?.season;
    return [
      { label: lastPast ? `${lastPast + 1} so far` : "This season", rows },
      ...past.map((r) => ({ label: String(r.season), rows: r.rows })).reverse(),
    ];
  }, [rows, history]);
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
                sits on the line and passes. The number rises only if its disagreements keep beating
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
                            <div className="flex flex-wrap gap-1.5">
                              {row.predictions.map((p) => (
                                <PickChip key={p.market} pick={p} game={row.game} />
                              ))}
                            </div>
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
                Picks: spread when its line is {MODEL_SETTINGS.spreadEdgePts}+ points off the
                market, total when it&apos;s {MODEL_SETTINGS.totalEdgePts}+ points off, and
                moneyline when its win probability beats the no-vig price by{" "}
                {MODEL_SETTINGS.moneylineEdgeProb * 100}+ percentage points (no moneylines longer
                than ±{MODEL_SETTINGS.moneylineMaxOdds}). Most games are a pass — that&apos;s by
                design.
              </li>
              <li>
                Guardrails: a moneyline pick is always the team the model expects to win — never an
                underdog it thinks will lose just because the price looks good. And when the model
                and the market disagree by more than {MODEL_SETTINGS.maxSpreadDisagreementPts}{" "}
                points on the spread, {MODEL_SETTINGS.maxTotalDisagreementPts} on the total, or{" "}
                {MODEL_SETTINGS.maxMoneylineDisagreementProb * 100} percentage points on win chance,
                it passes: a gap that big usually means news the model can&apos;t see, like an
                injury or a quarterback change.
              </li>
              <li>
                Every pick risks {MODEL_SETTINGS.stake} unit at the closing ESPN price (
                {MODEL_SETTINGS.defaultPrice} when no price is listed). Pushes return the stake.
                Picks for upcoming games can change until kickoff as the lines move.
              </li>
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
