/**
 * The model page body (record cards, what it has learned, track record, units by week, this
 * week's calls, graded picks), shared by the NFL and college model pages.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { MatchupLink, PageTitle, Panel, PanelHeader, StatCard, TeamLogo } from "@/components/shared/booth";
import { gameScore, type Game } from "@/data/shared/games";
import { teamById } from "@/data/shared/teams";
import {
  summarizeModel,
  unitsText,
  type GameModelRow,
  type Market,
  type MarketRecord,
  type ModelPick,
} from "@/lib/shared/game-model";
import { gameRoute } from "@/lib/shared/league-links";
import { notesForRow, type PickNote } from "@/lib/shared/pick-notes";

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
      to={gameRoute(game.id)}
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
            : pick.reason && REASON_TEXT[pick.reason]
              ? `Best bet (${REASON_TEXT[pick.reason]}) · `
              : "Best bet · "
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

/** Why a pick is a ★ best bet, for its tooltip. */
const REASON_TEXT: Record<NonNullable<ModelPick["reason"]>, string> = {
  underdog: "7+ point home underdog",
  wind: "wind",
  "qb-style": "scrambler vs pocket passer",
  bounce: "road bounce-back",
  travel: "cross-country trip",
  early: "early-season under",
  academy: "service academies",
};

const NOTE_ICON: Record<PickNote["kind"], string> = {
  qb: "QB",
  key: "KEY",
  move: "LINE",
  wind: "WIND",
  style: "QB STYLE",
  rule: "★",
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
/**
 * One season of the track record: graded rows (replayed or live), or fixed records for seasons
 * kept only as totals (college best bets before this season).
 */
export interface TrackSeason {
  label: string;
  rows?: GameModelRow[];
  fixed?: { bets: MarketRecord };
}

function TrackRecord({ seasons }: { seasons: TrackSeason[] }) {
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
          {seasons.map(({ label, rows, fixed }) => {
            if (!rows && fixed)
              return (
                <tr key={label} className="border-b border-line/10 last:border-0">
                  <td className="px-3 py-2 font-mono">{label}</td>
                  <td className="px-3 py-2 text-right font-mono text-faint">—</td>
                  <td className="px-3 py-2 text-right font-mono text-faint">—</td>
                  <td className="px-3 py-2 text-right font-mono text-faint">—</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    <span>{recordText(fixed.bets)}</span>
                    <span className="ml-2 text-mute">
                      {fixed.bets.winPct === null ? "—" : `${one(fixed.bets.winPct)}%`}
                    </span>
                    <span
                      className={`ml-2 ${fixed.bets.units > 0 ? "text-win" : fixed.bets.units < 0 ? "text-loss" : "text-mute"}`}
                    >
                      {unitsText(fixed.bets.units)}
                    </span>
                  </td>
                </tr>
              );
            const p = summarizeModel(rows ?? [], "predictions");
            const b = summarizeModel(rows ?? [], "bets");
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

export function ModelBoard({
  rows,
  loading,
  eyebrow,
  trackRecord,
  trackRecordAside,
  trackRecordNote,
  calibrationSource,
  extraTop,
  watchList,
  howItWorks,
}: {
  rows: GameModelRow[];
  loading: boolean;
  eyebrow: string;
  trackRecord: TrackSeason[];
  trackRecordAside: ReactNode;
  trackRecordNote: ReactNode;
  /** Which games the learned trust comes from, e.g. "past seasons plus this one before the next slate". */
  calibrationSource: string;
  /** Panels after "What the model has learned" (e.g. the college best-bet rules). */
  extraTop?: ReactNode;
  watchList?: ReactNode;
  howItWorks: ReactNode;
}) {
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
      <PageTitle eyebrow={eyebrow} title="Model" />

      {loading ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            Loading the schedule and lines…
          </p>
        </Panel>
      ) : rows.length === 0 ? (
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
                From {latestCalibration.samples} graded games ({calibrationSource}). It starts from
                the betting line and only moves off it as far as its own track record says it
                should.
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

          {extraTop}

          <Panel padded={false}>
            <PanelHeader
              title="Track record by season"
              aside={
                <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                  {trackRecordAside}
                </span>
              }
            />
            <TrackRecord seasons={trackRecord} />
            <p className="px-4 pb-3 pt-2 text-[11px] text-faint">{trackRecordNote}</p>
          </Panel>

          {watchList}

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

          {howItWorks}
        </div>
      )}
    </>
  );
}
