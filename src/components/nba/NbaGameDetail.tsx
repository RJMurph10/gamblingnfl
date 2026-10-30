/**
 * One NBA game, laid out like the NFL game page: header, then Gamecast / Stats / Markets / Props /
 * Information tabs.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { BASKETBALL_CLOCK, ProbabilityGraph } from "@/components/shared/ProbabilityGraph";
import { NbaLogo, oddsLine, statusText } from "@/components/nba/NbaBits";
import { NbaLiveScoreboard } from "@/components/nba/NbaLiveCourt";
import {
  atsResult,
  hasScore,
  nbaHeadshot,
  ouResult,
  pct,
  periodLabel,
  spreadText,
  type NbaBoxTeam,
  type NbaGame,
  type NbaGameDetail,
  type NbaPlay,
} from "@/lib/nba/nba";
import { predictGame, buildRatings, rowFor, type NbaModelRow } from "@/lib/nba/nba-model";
import { useNbaGameDetail, useNbaPrior, useNbaSchedule } from "@/lib/nba/use-nba";

type GameTab = "gamecast" | "stats" | "markets" | "props" | "information";

export function NbaGameDetailView({ gameId }: { gameId: string }) {
  const schedule = useNbaSchedule(false);
  const scheduled = schedule.games.find((g) => g.id === gameId);
  const detail = useNbaGameDetail(gameId, scheduled?.status === "live" || scheduled === undefined);
  const prior = useNbaPrior();
  const data = detail.data as NbaGameDetail | undefined;
  // The schedule refreshes more often than the summary, so it wins for the live score.
  const game: NbaGame | undefined = scheduled && data ? { ...data.game, ...scheduled, odds: scheduled.odds ?? data.game.odds } : (scheduled ?? data?.game);

  const started0 = game ? game.status !== "scheduled" : false;
  // Same tabs as the NFL game page. Before tip-off the Gamecast is empty, so open on Markets.
  const [tab, setTab] = useState<GameTab | null>(null);
  const activeTab: GameTab = tab ?? (started0 ? "gamecast" : "markets");
  // Like the NFL page, Information isn't offered during live games.
  useEffect(() => {
    if (game?.status === "live" && tab === "information") setTab("gamecast");
  }, [game?.status, tab]);

  const row: NbaModelRow | null = useMemo(() => {
    if (!game || game.part === "pre") return null;
    const before = schedule.games.filter(
      (g) => g.status === "final" && g.part !== "pre" && hasScore(g) && g.date < game.date && g.id !== game.id,
    );
    const table = buildRatings(before, prior);
    return rowFor(game, predictGame(table, game.home.team.id, game.away.team.id));
  }, [game, schedule.games, prior]);

  if (!game) {
    return (
      <>
        <PageTitle eyebrow="NBA" title={detail.isLoading || schedule.isLoading ? "Loading game…" : "Game not found"} />
        {!detail.isLoading && !schedule.isLoading ? (
          <Panel>
            <p className="py-6 text-center font-mono text-xs text-mute">
              ESPN has no game with this id.{" "}
              <Link to="/nba/games" className="text-acc">
                All games →
              </Link>
            </p>
          </Panel>
        ) : null}
      </>
    );
  }

  const started = game.status !== "scheduled";
  const tabs: [GameTab, string][] = [
    ["gamecast", "Gamecast"],
    ["stats", "Stats"],
    ["markets", "Markets"],
    ["props", "Props"],
    ...(game.status !== "live" ? ([["information", "Information"]] as [GameTab, string][]) : []),
  ];
  return (
    <>
      <Header game={game} plays={data?.plays ?? []} />
      <nav
        className={`grid border-b border-line/15 ${tabs.length === 4 ? "grid-cols-4" : "grid-cols-5"}`}
        aria-label="Game details tabs"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={activeTab === key}
            className={`border-b-2 px-3 py-3 font-disp text-sm font-semibold uppercase tracking-wider transition-colors ${activeTab === key ? "border-acc text-foreground" : "border-transparent text-mute hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "gamecast" ? (
        <div className="mt-6 space-y-6">
          {started ? (
            <Panel>
              <div className="flex items-center justify-between">
                <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Box score</h2>
                <span className="label-mono">scoring</span>
              </div>
              <div className="mt-3">
                <LineScore game={game} />
              </div>
            </Panel>
          ) : (
            <Panel>
              <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
                The gamecast starts at tip-off
              </p>
            </Panel>
          )}
          {data?.leaders.length ? <Leaders game={game} leaders={data.leaders} /> : null}
          {started ? (
            <div className="grid gap-6 lg:grid-cols-12">
              <Panel className="min-w-0 lg:col-span-7">
                <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Play-by-play</h2>
                <div className="mt-3">
                  <Plays game={game} plays={data?.plays ?? []} started={started} />
                </div>
              </Panel>
              <Panel className="min-w-0 lg:col-span-5">
                <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Win probability</h2>
                <div className="mt-3">
                  <WinProb game={game} detail={data} />
                </div>
              </Panel>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "stats" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <Panel padded={false} className="min-w-0 lg:col-span-8">
            <div className="border-b border-line/10 px-4 py-3">
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Box score</h2>
            </div>
            <div className="p-4">
              <BoxScore detail={data} started={started} loading={detail.isLoading} />
            </div>
          </Panel>
          <Panel className="min-w-0 lg:col-span-4">
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Team statistics</h2>
            <div className="mt-4">
              <TeamStats game={game} detail={data} started={started} />
            </div>
          </Panel>
        </div>
      ) : null}

      {activeTab === "markets" ? (
        <div className="mt-6 space-y-6">
          <Probabilities game={game} detail={data} />
          <div className="grid gap-6 lg:grid-cols-2">
            {row ? <ModelCard row={row} /> : null}
            <LinesCard game={game} />
          </div>
        </div>
      ) : null}

      {activeTab === "props" ? (
        <div className="mt-6">
          <Link
            to="/nba/props"
            search={{ game: game.id }}
            className="glass block p-4 text-center font-mono text-[11px] uppercase tracking-wider text-acc hover:glow"
          >
            Player prop projections for this game →
          </Link>
        </div>
      ) : null}

      {activeTab === "information" && game.status !== "live" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <GameInfo game={game} />
          {data?.injuries.length ? (
            <Injuries game={game} injuries={data.injuries} />
          ) : (
            <Panel>
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Injuries</h2>
              <p className="mt-3 font-mono text-xs text-mute">No injuries listed.</p>
            </Panel>
          )}
        </div>
      ) : null}
    </>
  );
}

/** The Markets tab's chart, the same as the NFL game page: moneyline, cover and total over the game. */
function Probabilities({ game, detail }: { game: NbaGame; detail?: NbaGameDetail }) {
  const [market, setMarket] = useState<"moneyline" | "cover" | "total">("moneyline");
  const points = detail?.probabilities ?? [];
  const spread = game.odds?.spread;
  const favorite = spread == null || spread === 0 ? null : spread < 0 ? game.home.team : game.away.team;
  const spreadLabel =
    spread == null ? "—" : spread === 0 ? "PK" : `-${Math.abs(spread).toFixed(1).replace(/\.0$/, "")}`;
  const away = game.away.team;
  const home = game.home.team;
  const logo = (t: typeof away) => <NbaLogo team={t} className="size-8" />;
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Probabilities</h2>
        <div className="text-right text-xs text-mute">
          <div className="flex items-center justify-end gap-1.5">
            Spread:{" "}
            <span className="inline-flex items-center gap-1 font-mono font-semibold text-foreground">
              {favorite ? <NbaLogo team={favorite} className="size-4" /> : null}
              {spreadLabel}
            </span>
          </div>
          <div className="mt-1">
            Total: <span className="font-mono font-semibold text-foreground">{game.odds?.total ?? "—"}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg border border-line/10 p-1" role="tablist" aria-label="Probability type">
        {([["moneyline", "Moneyline"], ["cover", "Cover"], ["total", "Total"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={market === key}
            onClick={() => setMarket(key)}
            className={`rounded-md px-2 py-2.5 font-disp text-xs font-semibold uppercase tracking-wider transition-colors sm:text-sm ${market === key ? "bg-acc text-black" : "text-mute hover:bg-line/5 hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {market === "total" ? (
        <ProbabilityGraph
          points={points}
          probabilityKey="overProbability"
          away={away}
          home={home}
          logo={logo}
          clock={BASKETBALL_CLOCK}
          totalLine={game.odds?.total ?? undefined}
          unavailableText="Total probability needs the game's pregame over/under and play-by-play scores, which aren't available for this game yet."
        />
      ) : market === "cover" ? (
        <ProbabilityGraph
          points={points}
          probabilityKey="homeCoverProbability"
          away={away}
          home={home}
          logo={logo}
          clock={BASKETBALL_CLOCK}
          unavailableText="Cover probability needs the game's pregame spread and ESPN's win probabilities, which aren't available for this game yet."
        />
      ) : (
        <ProbabilityGraph
          points={points}
          probabilityKey="homeWinProbability"
          away={away}
          home={home}
          logo={logo}
          clock={BASKETBALL_CLOCK}
          unavailableText="ESPN hasn't published win probabilities for this game yet."
        />
      )}
    </Panel>
  );
}

/** Where and when: the Information tab's facts. */
function GameInfo({ game }: { game: NbaGame }) {
  const when = game.date
    ? new Date(game.date).toLocaleString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const rows: [string, string | undefined][] = [
    ["Tip-off", when || undefined],
    ["Arena", game.venue],
    ["TV", game.broadcast],
    ["Game", [game.part === "pre" ? "Preseason" : game.part === "play-in" ? "Play-in" : game.part === "post" ? "Playoffs" : "Regular season", game.note].filter(Boolean).join(" · ")],
  ];
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Game information</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-mute">{k}</dt>
              <dd className="text-right font-mono" suppressHydrationWarning>
                {v}
              </dd>
            </div>
          ))}
      </dl>
    </Panel>
  );
}

function Header({ game, plays }: { game: NbaGame; plays: NbaPlay[] }) {
  const when = game.date
    ? new Date(game.date).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  const finalDate = game.date
    ? new Date(game.date).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" })
    : "";
  const isFinal = game.status === "final";
  const isOT = game.period > 4 || /\b\d?OT\b/i.test(game.statusDetail);
  const spread = game.odds?.spread;
  const favorite = spread == null || spread === 0 ? null : spread < 0 ? game.home.team : game.away.team;
  const spreadLabel = spread == null ? "—" : spread === 0 ? "PK" : `-${Math.abs(spread).toFixed(1).replace(/\.0$/, "")}`;

  if (isFinal) {
    const awayWon = hasScore(game) && (game.away.score as number) > (game.home.score as number);
    const homeWon = hasScore(game) && (game.home.score as number) > (game.away.score as number);
    return (
      <>
        <PageTitle
          eyebrow={[game.part === "pre" ? "Preseason" : game.part === "play-in" ? "Play-in" : game.part === "post" ? "Playoffs" : "NBA", game.note].filter(Boolean).join(" · ")}
          title={`${game.away.team.abbr} @ ${game.home.team.abbr}`}
        />
        <Panel className="mb-6">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <Link to="/nba/teams/$teamId" params={{ teamId: game.away.team.id }} className="group flex shrink-0 flex-col items-center gap-1 text-center">
                <NbaLogo team={game.away.team} className="size-10 transition-transform group-hover:scale-105 sm:size-14" />
                <span className="font-mono text-[10px] text-mute group-hover:text-acc sm:text-xs">{game.away.record ?? ""}</span>
              </Link>
              <span className={`font-mono text-3xl font-bold tabular-nums sm:text-5xl ${awayWon ? "text-acc" : ""}`}>{game.away.score ?? ""}</span>
            </div>
            <div className="flex shrink-0 flex-col items-center justify-center px-1 text-center">
              <span className="font-disp text-base font-bold tracking-wider text-acc sm:text-xl">{isOT ? "FINAL/OT" : "FINAL"}</span>
              <span className="font-mono text-[10px] text-mute sm:text-[11px]">{finalDate}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <span className={`font-mono text-3xl font-bold tabular-nums sm:text-5xl ${homeWon ? "text-acc" : ""}`}>{game.home.score ?? ""}</span>
              <Link to="/nba/teams/$teamId" params={{ teamId: game.home.team.id }} className="group flex shrink-0 flex-col items-center gap-1 text-center">
                <NbaLogo team={game.home.team} className="size-10 transition-transform group-hover:scale-105 sm:size-14" />
                <span className="font-mono text-[10px] text-mute group-hover:text-acc sm:text-xs">{game.home.record ?? ""}</span>
              </Link>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
            <span>Spread:</span>
            {favorite ? (
              <span className="inline-flex items-center gap-1">
                <NbaLogo team={favorite} className="size-4" />
                <span className="font-semibold text-foreground">{spreadLabel}</span>
              </span>
            ) : <span className="font-semibold text-foreground">{spreadLabel}</span>}
            <span>·</span>
            <span>O/U: <span className="font-semibold text-foreground">{game.odds?.total ?? "—"}</span></span>
          </div>
        </Panel>
      </>
    );
  }

  if (game.status === "live") {
    return (
      <>
        <PageTitle
          eyebrow={[game.part === "pre" ? "Preseason" : game.part === "play-in" ? "Play-in" : game.part === "post" ? "Playoffs" : "NBA", game.note].filter(Boolean).join(" · ")}
          title={`${game.away.team.abbr} @ ${game.home.team.abbr}`}
        />
        <NbaLiveScoreboard game={game} plays={plays} />
      </>
    );
  }

  return (
    <>
      <PageTitle
        eyebrow={[game.part === "pre" ? "Preseason" : game.part === "play-in" ? "Play-in" : game.part === "post" ? "Playoffs" : "NBA", game.note].filter(Boolean).join(" · ")}
        title={`${game.away.team.abbr} @ ${game.home.team.abbr}`}
      />
      <Panel className="mb-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {[game.away, game.home].map((s, i) => (
            <div key={s.team.id} className={i === 0 ? "order-1" : "order-3 text-right"}>
              <div className={`flex items-center gap-3 ${i === 1 ? "flex-row-reverse" : ""}`}>
                <Link to="/nba/teams/$teamId" params={{ teamId: s.team.id }}>
                  <NbaLogo team={s.team} className="size-14 sm:size-16" />
                </Link>
                <div className="min-w-0">
                  <Link to="/nba/teams/$teamId" params={{ teamId: s.team.id }} className="block truncate font-disp text-xl font-bold uppercase leading-none tracking-tight hover:text-acc sm:text-3xl">
                    {s.team.nickname}
                  </Link>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                    {i === 0 ? "Away" : "Home"}
                    {s.record ? ` · ${s.record}` : ""}
                  </span>
                </div>
                {hasScore(game) && game.status !== "scheduled" ? (
                  <span className="font-mono text-3xl font-semibold tabular-nums sm:text-5xl">{s.score}</span>
                ) : null}
              </div>
            </div>
          ))}
          <div className="order-2 text-center">
            <p className="font-mono text-xs uppercase tracking-wider text-mute" suppressHydrationWarning>
              {statusText(game)}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-faint" suppressHydrationWarning>
              {when}
            </p>
          </div>
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-faint">
          {[game.venue, game.broadcast, oddsLine(game)].filter(Boolean).join(" · ")}
        </p>
      </Panel>
    </>
  );
}

/** Line-score column headers, like the NFL page: 1st, 2nd, 3rd, 4th, then OT, 2OT… */
const quarterHeader = (i: number) => (i < 4 ? ["1st", "2nd", "3rd", "4th"][i] : periodLabel(i));

function LineScore({ game }: { game: NbaGame }) {
  const count = Math.max(4, game.away.periods.length, game.home.periods.length);
  const winner = game.status === "final" && hasScore(game) ? ((game.away.score as number) > (game.home.score as number) ? "away" : "home") : null;
  return (
    <table className="w-full text-center font-mono text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-faint">
          <th className="text-left font-normal">Team</th>
          {Array.from({ length: count }, (_, i) => (
            <th key={i} className="font-normal">{quarterHeader(i)}</th>
          ))}
          <th className="text-right font-normal">{game.status === "final" ? "Final" : "T"}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5">
        {([["away", game.away], ["home", game.home]] as const).map(([key, s]) => (
          <tr key={key}>
            <td className="py-2 text-left font-medium">{s.team.nickname}</td>
            {Array.from({ length: count }, (_, i) => (
              <td key={i} className="py-2 tabular-nums text-mute">{s.periods[i] ?? (game.status === "final" || i < game.period ? 0 : "")}</td>
            ))}
            <td className={`py-2 text-right font-semibold tabular-nums ${winner === key ? "text-acc" : ""}`}>{s.score ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What the model thinks, and where it disagrees with the market. */
function ModelCard({ row }: { row: NbaModelRow }) {
  const { game, pred } = row;
  const fav = pred.margin >= 0 ? game.home.team : game.away.team;
  const result = (r: string | null | undefined) => (r === "win" ? "text-win" : r === "loss" ? "text-loss" : "text-mute");
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Model</h2>
      <p className="label-mono mb-3">Projected from earlier games only</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono tabular-nums">
        <span className="text-2xl">{pred.away.toFixed(0)}</span>
        <span className="text-[10px] uppercase tracking-wider text-faint">proj. score</span>
        <span className="text-right text-2xl">{pred.home.toFixed(0)}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel2">
        <div className="h-2 bg-acc" style={{ width: `${(1 - pred.homeWinProb) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-mute">
        <span>{game.away.team.abbr} {pct(1 - pred.homeWinProb, 0)}</span>
        <span>{game.home.team.abbr} {pct(pred.homeWinProb, 0)}</span>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Winner</dt>
          <dd className={`font-mono ${result(row.moneyline.result)}`}>{fav.abbr} by {Math.abs(pred.margin).toFixed(1)}{row.moneyline.result ? ` · ${row.moneyline.result}` : ""}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Spread</dt>
          <dd className={`font-mono ${result(row.spread?.result)}`}>
            {row.spread
              ? `${row.spread.best ? "★ " : ""}${row.spread.pick === "home" ? game.home.team.abbr : game.away.team.abbr} ${spreadText(game, row.spread.line)} (${row.spread.edge.toFixed(1)} pt edge)${row.spread.result ? ` · ${row.spread.result}` : ""}`
              : game.odds?.spread != null ? "No edge" : "No line"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Total</dt>
          <dd className={`font-mono ${result(row.total?.result)}`}>
            {row.total
              ? `${row.total.best ? "★ " : ""}${row.total.pick} ${row.total.line} (proj ${pred.total.toFixed(1)})${row.total.result ? ` · ${row.total.result}` : ""}`
              : game.odds?.total ? `No edge (proj ${pred.total.toFixed(1)})` : `Proj ${pred.total.toFixed(1)}`}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function LinesCard({ game }: { game: NbaGame }) {
  const o = game.odds;
  const ats = atsResult(game);
  const ou = ouResult(game);
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Lines</h2>
      <p className="label-mono mb-3">{o?.provider ?? "ESPN odds"}</p>
      {o ? (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-mute">Spread</dt><dd className={`font-mono ${ats === "push" ? "text-mute" : ""}`}>{o.spread !== null ? spreadText(game, o.spread) : "—"}{ats && ats !== "push" ? ` · ${ats === "home" ? game.home.team.abbr : game.away.team.abbr} covered` : ats ? " · push" : ""}</dd></div>
          <div className="flex justify-between"><dt className="text-mute">Total</dt><dd className="font-mono">{o.total ?? "—"}{ou ? ` · ${ou}` : ""}</dd></div>
          <div className="flex justify-between"><dt className="text-mute">{game.away.team.abbr} moneyline</dt><dd className="font-mono">{o.mlAway ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-mute">{game.home.team.abbr} moneyline</dt><dd className="font-mono">{o.mlHome ?? "—"}</dd></div>
        </dl>
      ) : (
        <p className="font-mono text-xs text-mute">No lines posted yet.</p>
      )}
    </Panel>
  );
}

function BoxScore({ detail, started, loading }: { detail?: NbaGameDetail; started: boolean; loading: boolean }) {
  const [side, setSide] = useState(0);
  if (!started) return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">The box score appears once the game is under way</p>;
  const teams = detail?.box ?? [];
  if (!teams.length)
    return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">{loading ? "Loading box score…" : "ESPN has no box score yet."}</p>;
  const t = teams[Math.min(side, teams.length - 1)];
  return (
    <div>
      <div className="mb-3 flex gap-2">
        {teams.map((x, i) => (
          <button
            key={x.teamId}
            type="button"
            onClick={() => setSide(i)}
            aria-pressed={i === side}
            className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${i === side ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
          >
            {x.abbr}
          </button>
        ))}
      </div>
      <BoxTable team={t} />
    </div>
  );
}

function BoxTable({ team }: { team: NbaBoxTeam }) {
  const starters = team.players.filter((p) => p.starter);
  const bench = team.players.filter((p) => !p.starter);
  const group = (label: string, list: typeof team.players) => (
    <>
      <tr>
        <td colSpan={team.labels.length + 1} className="pt-3 font-mono text-[10px] uppercase tracking-wider text-faint">{label}</td>
      </tr>
      {list.map((p) => (
        <tr key={p.id || p.name} className="hover:bg-line/5">
          <td className="sticky left-0 bg-panel py-1.5 pr-3">
            {p.id ? (
              <Link to="/nba/players/$playerId" params={{ playerId: p.id }} className="font-medium hover:text-acc">{p.name}</Link>
            ) : p.name}
            <span className="ml-1.5 font-mono text-[10px] text-faint">{p.position}</span>
          </td>
          {p.dnp ? (
            <td colSpan={team.labels.length} className="py-1.5 font-mono text-[11px] text-faint">{p.dnp}</td>
          ) : (
            team.labels.map((_, i) => (
              <td key={i} className="px-1.5 py-1.5 text-right font-mono text-[12px] tabular-nums">{p.stats[i] ?? ""}</td>
            ))
          )}
        </tr>
      ))}
    </>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="sticky left-0 bg-panel py-2 pr-3 font-normal">Player</th>
            {team.labels.map((l) => (
              <th key={l} className="px-1.5 py-2 text-right font-normal">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {starters.length ? group("Starters", starters) : null}
          {bench.length ? group(starters.length ? "Bench" : "Players", bench) : null}
          {team.totals.length ? (
            <tr className="border-t border-line/20 font-semibold">
              <td className="sticky left-0 bg-panel py-2">Team</td>
              {team.labels.map((_, i) => (
                <td key={i} className="px-1.5 py-2 text-right font-mono text-[12px] tabular-nums">{team.totals[i] ?? ""}</td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

const asNumber = (s: string) => {
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function TeamStats({ game, detail, started }: { game: NbaGame; detail?: NbaGameDetail; started: boolean }) {
  const rows = detail?.teamStats ?? [];
  if (!started || !rows.length)
    return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Team stats appear once the game is under way</p>;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center font-mono text-[10px] uppercase tracking-wider text-mute">
        <span className="flex items-center gap-2"><NbaLogo team={game.away.team} className="size-6" />{game.away.team.abbr}</span>
        <span />
        <span className="flex items-center justify-end gap-2">{game.home.team.abbr}<NbaLogo team={game.home.team} className="size-6" /></span>
      </div>
      {rows.map((r) => {
        const a = asNumber(r.away);
        const h = asNumber(r.home);
        const isPct = /%/.test(r.label) || /pct/i.test(r.label);
        const max = isPct ? 100 : Math.max(a, h, 1);
        const w = (v: number) => `${Math.min(100, Math.max(v > 0 ? 3 : 0, (v / max) * 100))}%`;
        return (
          <div key={r.label}>
            <div className="mb-1 grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 font-mono text-[11px]">
              <span className="text-left tabular-nums">{r.away}</span>
              <span className="text-center text-faint">{r.label}</span>
              <span className="text-right tabular-nums">{r.home}</span>
            </div>
            <div className="flex gap-1">
              <div className="flex h-2 flex-1 justify-end overflow-hidden rounded-full bg-panel2">
                <div className="h-2 rounded-full" style={{ width: w(a), backgroundColor: game.away.team.color }} />
              </div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                <div className="h-2 rounded-full" style={{ width: w(h), backgroundColor: game.home.team.color }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Plays({ game, plays, started }: { game: NbaGame; plays: NbaPlay[]; started: boolean }) {
  const [scoringOnly, setScoringOnly] = useState(true);
  const [period, setPeriod] = useState<number | "all">("all");
  const periods = [...new Set(plays.map((p) => p.period))].sort((a, b) => a - b);
  const shown = useMemo(
    () => plays.filter((p) => (!scoringOnly || p.scoring) && (period === "all" || p.period === period)).slice().reverse(),
    [plays, scoringOnly, period],
  );
  if (!started) return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Play-by-play appears once the game is under way</p>;
  if (!plays.length) return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">ESPN has no play-by-play yet.</p>;
  const teamOf = (id?: string) => (id === game.home.team.id ? game.home.team : id === game.away.team.id ? game.away.team : null);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setScoringOnly((v) => !v)} aria-pressed={scoringOnly} className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${scoringOnly ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10"}`}>
          Scoring plays
        </button>
        {(["all", ...periods] as (number | "all")[]).map((p) => (
          <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p} className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${period === p ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}>
            {p === "all" ? "All" : periodLabel(p - 1)}
          </button>
        ))}
      </div>
      <ul className="max-h-[560px] divide-y divide-line/5 overflow-y-auto">
        {shown.map((p) => {
          const t = teamOf(p.teamId);
          return (
            <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">{periodLabel(p.period - 1)} {p.clock}</span>
              {t ? <NbaLogo team={t} className="size-5" /> : <span className="size-5" />}
              <span className={`min-w-0 flex-1 ${p.scoring ? "" : "text-mute"}`}>{p.text}</span>
              {p.awayScore !== null && p.homeScore !== null ? (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-mute">{p.awayScore}–{p.homeScore}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WinProb({ game, detail }: { game: NbaGame; detail?: NbaGameDetail }) {
  const probs = detail?.winProb ?? [];
  if (probs.length < 2)
    return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Win probability appears once the game is under way</p>;
  const W = 600;
  const H = 160;
  const step = W / (probs.length - 1);
  const points = probs.map((p, i) => `${(i * step).toFixed(1)},${((1 - p) * H).toFixed(1)}`).join(" ");
  const last = probs[probs.length - 1];
  return (
    <div>
      <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-mute">
        <span>{game.home.team.abbr} win probability</span>
        <span className="text-acc">{pct(last, 0)} now</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full rounded-lg bg-panel2" preserveAspectRatio="none" role="img" aria-label="Win probability chart">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" />
        <polyline points={points} fill="none" stroke="var(--acc)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
        <span>Tip-off</span>
        <span>{game.status === "final" ? "Final" : "Now"}</span>
      </div>
    </div>
  );
}

/** Game leaders, laid out like the NFL page: away player, category, home player. */
function Leaders({ game, leaders }: { game: NbaGame; leaders: NbaGameDetail["leaders"] }) {
  const cats = [...new Set(leaders.map((l) => l.category))].slice(0, 4);
  const cell = (l: NbaGameDetail["leaders"][number] | undefined, side: "away" | "home") => {
    const isHome = side === "home";
    if (!l) return <div className="py-4" aria-hidden="true" />;
    const content = (
      <div className={`flex min-w-0 items-center gap-2.5 ${isHome ? "flex-row-reverse" : ""}`}>
        <img
          src={nbaHeadshot(l.playerId ?? "")}
          alt=""
          loading="lazy"
          className="size-11 shrink-0 rounded-full bg-line/10 object-cover ring-1 ring-line/15 sm:size-12"
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
        <div className={`min-w-0 ${isHome ? "text-right" : "text-left"}`}>
          <div className="truncate text-sm font-semibold text-foreground group-hover:text-acc">{l.name}</div>
          <div className="mt-1 font-mono text-sm font-bold tabular-nums text-acc">{l.value}</div>
        </div>
      </div>
    );
    return (
      <div className={`flex min-w-0 items-center py-3 ${isHome ? "justify-end text-right" : "justify-start text-left"}`}>
        {l.playerId ? (
          <Link
            to="/nba/players/$playerId"
            params={{ playerId: l.playerId }}
            className="group block min-w-0 rounded-md p-1 transition-colors hover:bg-line/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            {content}
          </Link>
        ) : (
          <div className="min-w-0 p-1">{content}</div>
        )}
      </div>
    );
  };
  return (
    <Panel padded={false}>
      <div className="border-b border-line/10 px-4 py-3">
        <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Game leaders</h2>
        <p className="label-mono mt-1">Top individual performance for each team</p>
      </div>
      <div className="px-3 sm:px-5">
        <div className="grid grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-center gap-2 border-b border-line/10 py-3 font-mono text-[10px] uppercase tracking-wider text-faint sm:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
          <div className="flex items-center gap-2">
            <NbaLogo team={game.away.team} className="size-5" />
            <span>{game.away.team.nickname}</span>
          </div>
          <div className="text-center">Category</div>
          <div className="flex items-center justify-end gap-2 text-right">
            <span>{game.home.team.nickname}</span>
            <NbaLogo team={game.home.team} className="size-5" />
          </div>
        </div>
        <div className="divide-y divide-line/10">
          {cats.map((c) => {
            const away = leaders.find((x) => x.category === c && x.teamId === game.away.team.id);
            const home = leaders.find((x) => x.category === c && x.teamId === game.home.team.id);
            if (!away && !home) return null;
            return (
              <div
                key={c}
                className="grid grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]"
              >
                {cell(away, "away")}
                <div className="text-center font-mono text-[10px] uppercase tracking-wider text-mute">{c}</div>
                {cell(home, "home")}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function Injuries({ game, injuries }: { game: NbaGame; injuries: NbaGameDetail["injuries"] }) {
  return (
    <Panel padded={false}>
      <PanelHeader title="Injuries" />
      <div className="divide-y divide-line/5">
        {injuries.slice(0, 14).map((i, n) => {
          const t = i.teamId === game.home.team.id ? game.home.team : game.away.team;
          return (
            <div key={`${i.name}-${n}`} className="flex items-center gap-2 px-4 py-2 text-sm">
              <NbaLogo team={t} className="size-4" />
              <span className="flex-1 truncate">{i.name}</span>
              <span className={`font-mono text-[10px] uppercase tracking-wider ${/out/i.test(i.status) ? "text-loss" : "text-mute"}`}>{i.status}{i.detail ? ` · ${i.detail}` : ""}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
