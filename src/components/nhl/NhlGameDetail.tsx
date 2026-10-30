/**
 * The NHL game page, laid out like the NFL and NBA game pages: a scoreboard (with the live rink
 * during games), then Gamecast, Stats, Markets, Props and Information tabs.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { NhlEmpty, NhlLogo } from "@/components/nhl/NhlBits";
import { NhlGameBoard } from "@/components/nhl/NhlGameBoard";
import { NhlLiveScoreboard } from "@/components/nhl/NhlLiveRink";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { hasScore, type NhlGame, type NhlGameDetail, type NhlPlay } from "@/lib/nhl/nhl";
import { clockDisplay, isShootoutPeriod, shotsOnGoal } from "@/lib/nhl/nhl-live";
import { useNhlGameDetail, useNhlSchedule } from "@/lib/nhl/use-nhl";

type GameTab = "gamecast" | "stats" | "markets" | "props" | "information";

/** Period column label: 1st, 2nd, 3rd, then OT and SO (regular season) or 2OT, 3OT… (playoffs). */
function periodHeader(game: NhlGame, i: number): string {
  if (i < 3) return ["1st", "2nd", "3rd"][i];
  if (game.part === "post") return i === 3 ? "OT" : `${i - 2}OT`;
  return i === 3 ? "OT" : "SO";
}
const periodName = (game: NhlGame, p: number) => periodHeader(game, p - 1);

export function NhlGameDetailView({ gameId }: { gameId: string }) {
  const { games, isLoading } = useNhlSchedule(30_000);
  const scheduled = games.find((g) => g.id === gameId);
  const detail = useNhlGameDetail(gameId, scheduled?.status === "live" || scheduled === undefined);
  const data = (detail.data ?? undefined) as NhlGameDetail | undefined;
  // The schedule refreshes more often and carries the lines, so it wins for score and odds.
  const game: NhlGame | undefined =
    scheduled && data
      ? { ...data.game, ...scheduled, odds: scheduled.odds ?? data.game.odds }
      : (scheduled ?? data?.game);

  const started0 = game ? game.status === "live" || game.status === "final" : false;
  const [tab, setTab] = useState<GameTab | null>(null);
  const activeTab: GameTab = tab ?? (started0 ? "gamecast" : "markets");
  useEffect(() => {
    if (game?.status === "live" && tab === "information") setTab("gamecast");
  }, [game?.status, tab]);

  if (!game) {
    return (
      <NhlEmpty>
        {isLoading || detail.isLoading
          ? "Loading game…"
          : "That game wasn't found in the current schedule."}{" "}
        <Link to="/nhl/games" className="text-acc">
          All games →
        </Link>
      </NhlEmpty>
    );
  }

  const started = game.status === "live" || game.status === "final";
  const plays = data?.plays ?? [];
  const tabs: [GameTab, string][] = [
    ["gamecast", "Gamecast"],
    ["stats", "Stats"],
    ["markets", "Markets"],
    ["props", "Props"],
    ...(game.status !== "live" ? ([["information", "Information"]] as [GameTab, string][]) : []),
  ];

  return (
    <>
      {game.status === "live" ? (
        <NhlLiveScoreboard game={game} plays={plays} />
      ) : (
        <Header game={game} />
      )}
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
                <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                  Box score
                </h2>
                <span className="label-mono">goals · shots on goal</span>
              </div>
              <div className="mt-3 space-y-5">
                <LineScore game={game} />
                <ShotsTable game={game} plays={plays} />
              </div>
            </Panel>
          ) : (
            <Panel>
              <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
                The gamecast starts at puck drop
              </p>
            </Panel>
          )}
          {started ? <ScoringSummary game={game} plays={plays} /> : null}
          {started ? (
            <Panel>
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Play-by-play
              </h2>
              <div className="mt-3">
                <Plays game={game} plays={plays} loading={detail.isLoading} />
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {activeTab === "stats" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <Panel padded={false} className="min-w-0 lg:col-span-8">
            <div className="border-b border-line/10 px-4 py-3">
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Box score
              </h2>
            </div>
            <div className="p-4">
              <BoxScore game={game} detail={data} started={started} loading={detail.isLoading} />
            </div>
          </Panel>
          <Panel className="min-w-0 lg:col-span-4">
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              Team statistics
            </h2>
            <div className="mt-4">
              <TeamStats game={game} detail={data} started={started} />
            </div>
          </Panel>
        </div>
      ) : null}

      {activeTab === "markets" ? (
        <div className="mt-6">
          <NhlGameBoard game={game} games={games} />
        </div>
      ) : null}

      {activeTab === "props" ? (
        <div className="mt-6">
          <Link
            to="/nhl/props"
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

      <p className="mt-6 font-mono text-[11px]">
        <Link to="/nhl/games" className="text-acc">
          ← All games
        </Link>
      </p>
    </>
  );
}

/** Scoreboard for upcoming and finished games (same sizes as the NFL and NBA headers). */
function Header({ game }: { game: NhlGame }) {
  const isFinal = game.status === "final";
  const awayWon =
    isFinal && hasScore(game) && (game.away.score as number) > (game.home.score as number);
  const homeWon =
    isFinal && hasScore(game) && (game.home.score as number) > (game.away.score as number);
  const finalLabel = /so|shootout/i.test(game.statusDetail)
    ? "FINAL/SO"
    : /ot/i.test(game.statusDetail) || game.period > 3
      ? "FINAL/OT"
      : "FINAL";
  const dateText = game.date
    ? new Date(game.date).toLocaleDateString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";
  const timeText = game.date
    ? new Date(game.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  const spread = game.odds?.spread;
  const favorite =
    spread == null || spread === 0 ? null : spread < 0 ? game.home.team : game.away.team;
  const spreadLabel = spread == null ? "—" : `-${Math.abs(spread).toFixed(1).replace(/\.0$/, "")}`;

  const side = (s: NhlGame["away"], won: boolean, i: number) => (
    <div className={`flex items-center gap-3 sm:gap-6 ${i === 1 ? "flex-row-reverse" : ""}`}>
      <Link
        to="/nhl/teams/$teamId"
        params={{ teamId: s.team.id }}
        className="group flex flex-col items-center gap-1 text-center"
      >
        <NhlLogo
          team={s.team}
          className="size-10 transition-transform group-hover:scale-105 sm:size-14"
        />
        <span className="font-mono text-xs text-mute group-hover:text-acc">{s.record ?? ""}</span>
      </Link>
      <span
        className={`font-mono text-3xl font-bold tabular-nums sm:text-5xl ${won ? "text-acc" : ""}`}
      >
        {isFinal ? (s.score ?? "") : ""}
      </span>
    </div>
  );

  return (
    <Panel className="mb-6">
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        {side(game.away, awayWon, 0)}
        <div className="flex flex-col items-center px-2 text-center" suppressHydrationWarning>
          {isFinal ? (
            <span className="font-disp text-lg font-bold tracking-wider text-acc sm:text-xl">
              {finalLabel}
            </span>
          ) : (
            <span className="font-disp text-base font-bold tracking-wider text-mute sm:text-lg">
              {game.status === "postponed" ? "POSTPONED" : "VS"}
            </span>
          )}
          <span className="font-mono text-[11px] text-mute">
            {dateText}
            {!isFinal && timeText ? ` · ${timeText}` : ""}
          </span>
        </div>
        {side(game.home, homeWon, 1)}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
        <span>Puck line:</span>
        {favorite ? (
          <span className="inline-flex items-center gap-1">
            <NhlLogo team={favorite} className="size-4" />
            <span className="font-semibold text-foreground">{spreadLabel}</span>
          </span>
        ) : (
          <span className="font-semibold text-foreground">{spreadLabel}</span>
        )}
        <span>·</span>
        <span>
          O/U: <span className="font-semibold text-foreground">{game.odds?.total ?? "—"}</span>
        </span>
        {game.broadcast ? (
          <>
            <span>·</span>
            <span>{game.broadcast}</span>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function PeriodTable({
  game,
  title,
  away,
  home,
  awayTotal,
  homeTotal,
  highlight,
}: {
  game: NhlGame;
  title: string;
  away: (number | string)[];
  home: (number | string)[];
  awayTotal: number | string;
  homeTotal: number | string;
  highlight?: "away" | "home" | null;
}) {
  const count = Math.max(3, away.length, home.length);
  return (
    <table className="w-full table-fixed text-center font-mono text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-faint">
          <th className="w-2/5 text-left font-normal">{title}</th>
          {Array.from({ length: count }, (_, i) => (
            <th key={i} className="font-normal">
              {periodHeader(game, i)}
            </th>
          ))}
          <th className="text-right font-normal">T</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5">
        {(
          [
            ["away", game.away, away, awayTotal],
            ["home", game.home, home, homeTotal],
          ] as const
        ).map(([key, s, row, total]) => (
          <tr key={key}>
            <td className="py-2 text-left font-medium">
              <span className="inline-flex items-center gap-2">
                <NhlLogo team={s.team} className="size-5" />
                {s.team.nickname}
              </span>
            </td>
            {Array.from({ length: count }, (_, i) => (
              <td key={i} className="py-2 tabular-nums text-mute">
                {row[i] ?? ""}
              </td>
            ))}
            <td
              className={`py-2 text-right font-semibold tabular-nums ${highlight === key ? "text-acc" : ""}`}
            >
              {total}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LineScore({ game }: { game: NhlGame }) {
  const winner =
    game.status === "final" && hasScore(game)
      ? (game.away.score as number) > (game.home.score as number)
        ? "away"
        : "home"
      : null;
  const fill = (periods?: number[]) =>
    Array.from(
      { length: Math.max(3, periods?.length ?? 0) },
      (_, i) => periods?.[i] ?? (game.status === "final" || i < game.period ? 0 : ""),
    );
  return (
    <PeriodTable
      game={game}
      title="Goals"
      away={fill(game.away.periods)}
      home={fill(game.home.periods)}
      awayTotal={game.away.score ?? 0}
      homeTotal={game.home.score ?? 0}
      highlight={winner}
    />
  );
}

function ShotsTable({ game, plays }: { game: NhlGame; plays: NhlPlay[] }) {
  const sog = shotsOnGoal(plays, game);
  if (!sog) return null;
  const upTo = (row: number[]) =>
    row.map((n, i) => (game.status === "final" || i < game.period ? n : ""));
  return (
    <PeriodTable
      game={game}
      title="Shots on goal"
      away={upTo(sog.away)}
      home={upTo(sog.home)}
      awayTotal={sog.awayTotal}
      homeTotal={sog.homeTotal}
    />
  );
}

const isGoal = (p: NhlPlay) => p.scoring || /^goal$/i.test(p.type);

function ScoringSummary({ game, plays }: { game: NhlGame; plays: NhlPlay[] }) {
  const goals = plays.filter((p) => isGoal(p) && p.teamId && !isShootoutPeriod(game, p.period));
  const teamOf = (id?: string) => (id === game.home.team.id ? game.home.team : game.away.team);
  return (
    <Panel padded={false}>
      <PanelHeader title="Scoring summary" />
      {goals.length ? (
        <ul className="divide-y divide-line/5">
          {goals.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">
                {periodName(game, p.period)} {clockDisplay(p.clock)}
              </span>
              <NhlLogo team={teamOf(p.teamId)} className="size-5" />
              <span className="min-w-0 flex-1">{p.text}</span>
              {p.strength && !/even/i.test(p.strength) ? (
                <span className="shrink-0 rounded bg-acc/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-acc">
                  {/power/i.test(p.strength) ? "PP" : /short/i.test(p.strength) ? "SH" : p.strength}
                </span>
              ) : null}
              {p.awayScore !== null && p.homeScore !== null ? (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-mute">
                  {p.awayScore}–{p.homeScore}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
          No goals yet
        </p>
      )}
    </Panel>
  );
}

type PlayFilter = "goals" | "penalties" | "shots" | "all";

function Plays({ game, plays, loading }: { game: NhlGame; plays: NhlPlay[]; loading: boolean }) {
  const [filter, setFilter] = useState<PlayFilter>("all");
  const [period, setPeriod] = useState<number | "all">("all");
  const periods = [...new Set(plays.map((p) => p.period))].filter(Boolean).sort((a, b) => a - b);
  const shown = useMemo(
    () =>
      plays
        .filter((p) => {
          if (period !== "all" && p.period !== period) return false;
          if (filter === "goals") return isGoal(p);
          if (filter === "penalties") return /penalty/i.test(p.type);
          if (filter === "shots") return isGoal(p) || /shot/i.test(p.type);
          return true;
        })
        .slice()
        .reverse(),
    [plays, filter, period],
  );
  if (!plays.length)
    return (
      <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
        {loading ? "Loading play-by-play…" : "ESPN has no play-by-play yet."}
      </p>
    );
  const teamOf = (id?: string) =>
    id === game.home.team.id ? game.home.team : id === game.away.team.id ? game.away.team : null;
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${on ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ["all", "All plays"],
            ["goals", "Goals"],
            ["shots", "Shots"],
            ["penalties", "Penalties"],
          ] as [PlayFilter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={chip(filter === key)}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 w-px self-stretch bg-line/10" />
        {(["all", ...periods] as (number | "all")[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={chip(period === p)}
          >
            {p === "all" ? "All" : periodName(game, p)}
          </button>
        ))}
      </div>
      <ul className="max-h-[560px] divide-y divide-line/5 overflow-y-auto">
        {shown.map((p) => {
          const t = teamOf(p.teamId);
          const goal = isGoal(p);
          return (
            <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">
                {periodName(game, p.period)} {clockDisplay(p.clock)}
              </span>
              {t ? <NhlLogo team={t} className="size-5" /> : <span className="size-5" />}
              <span className={`min-w-0 flex-1 ${goal ? "font-medium" : "text-mute"}`}>
                {goal ? (
                  <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wider text-acc">
                    Goal
                  </span>
                ) : null}
                {p.text}
              </span>
              {p.awayScore !== null && p.homeScore !== null ? (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-mute">
                  {p.awayScore}–{p.homeScore}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const GROUP_TITLES: Record<string, string> = {
  forwards: "Forwards",
  defenses: "Defense",
  defense: "Defense",
  skaters: "Skaters",
  goalies: "Goalies",
};

function BoxScore({
  game,
  detail,
  started,
  loading,
}: {
  game: NhlGame;
  detail?: NhlGameDetail;
  started: boolean;
  loading: boolean;
}) {
  const [teamId, setTeamId] = useState(game.away.team.id);
  if (!started)
    return (
      <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
        The box score fills in once the game starts
      </p>
    );
  const team = detail?.box.find((b) => b.teamId === teamId);
  if (!detail?.box.length)
    return (
      <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
        {loading ? "Loading box score…" : "ESPN has no box score for this game yet."}
      </p>
    );
  return (
    <div>
      <div className="mb-3 flex gap-2">
        {[game.away.team, game.home.team].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTeamId(t.id)}
            aria-pressed={teamId === t.id}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${teamId === t.id ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
          >
            <NhlLogo team={t} className="size-4" />
            {t.abbr}
          </button>
        ))}
      </div>
      <div className="space-y-5">
        {(team?.groups ?? [])
          .filter((g) => g.athletes.length)
          .map((g) => (
            <div key={g.name} className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="py-1.5 pr-2 font-normal">
                      {GROUP_TITLES[g.name.toLowerCase()] ?? g.name}
                    </th>
                    {g.labels.map((l) => (
                      <th key={l} className="px-1.5 py-1.5 text-right font-normal">
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {g.athletes.map((a) => (
                    <tr key={a.id || a.name}>
                      <td className="whitespace-nowrap py-1.5 pr-2">
                        {a.id ? (
                          <Link
                            to="/nhl/players/$playerId"
                            params={{ playerId: a.id }}
                            className="hover:text-acc"
                          >
                            {a.name}
                          </Link>
                        ) : (
                          a.name
                        )}
                        {a.position ? (
                          <span className="ml-1.5 font-mono text-[10px] text-faint">
                            {a.position}
                          </span>
                        ) : null}
                      </td>
                      {a.stats.map((v, i) => (
                        <td
                          key={i}
                          className="px-1.5 py-1.5 text-right font-mono tabular-nums text-mute"
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  );
}

function TeamStats({
  game,
  detail,
  started,
}: {
  game: NhlGame;
  detail?: NhlGameDetail;
  started: boolean;
}) {
  if (!started || !detail?.teamStats.length)
    return (
      <p className="font-mono text-xs text-mute">Team statistics appear once the game starts.</p>
    );
  const away = detail.teamStats.find((t) => t.teamId === game.away.team.id);
  const home = detail.teamStats.find((t) => t.teamId === game.home.team.id);
  const rows = (away?.stats ?? home?.stats ?? []).map((s) => ({
    label: s.label || s.name,
    away: away?.stats.find((x) => x.name === s.name)?.value ?? "—",
    home: home?.stats.find((x) => x.name === s.name)?.value ?? "—",
  }));
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="font-mono text-[10px] uppercase tracking-wider text-faint">
          <th className="pb-2 text-left font-normal">
            <span className="inline-flex items-center gap-2">
              <NhlLogo team={game.away.team} className="size-5" />
              {game.away.team.abbr}
            </span>
          </th>
          <th className="pb-2 font-normal" />
          <th className="pb-2 text-right font-normal">
            <span className="inline-flex items-center gap-2">
              {game.home.team.abbr}
              <NhlLogo team={game.home.team} className="size-5" />
            </span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5">
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="py-1.5 font-mono tabular-nums">{r.away}</td>
            <td className="py-1.5 text-center text-[11px] text-mute">{r.label}</td>
            <td className="py-1.5 text-right font-mono tabular-nums">{r.home}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GameInfo({ game }: { game: NhlGame }) {
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
    ["Puck drop", when || undefined],
    ["Arena", game.venue],
    ["TV", game.broadcast],
    [
      "Game",
      game.part === "pre" ? "Preseason" : game.part === "post" ? "Playoffs" : "Regular season",
    ],
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

function Injuries({ game, injuries }: { game: NhlGame; injuries: NhlGameDetail["injuries"] }) {
  return (
    <Panel padded={false}>
      <PanelHeader title="Injuries" />
      <div className="divide-y divide-line/5">
        {injuries.slice(0, 14).map((i, n) => {
          const t = i.teamId === game.home.team.id ? game.home.team : game.away.team;
          return (
            <div key={`${i.name}-${n}`} className="flex items-center gap-2 px-4 py-2 text-sm">
              <NhlLogo team={t} className="size-4" />
              <span className="flex-1 truncate">{i.name}</span>
              <span
                className={`font-mono text-[10px] uppercase tracking-wider ${/out|ir/i.test(i.status) ? "text-loss" : "text-mute"}`}
              >
                {i.status}
                {i.detail ? ` · ${i.detail}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
