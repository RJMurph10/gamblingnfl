/**
 * The MLB game page, laid out like the NFL, NBA and NHL game pages: a scoreboard (with the live
 * diamond during games), then Gamecast, Stats, Markets and Information tabs.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MlbEmpty, MlbLogo } from "@/components/mlb/MlbBits";
import { MlbLiveScoreboard } from "@/components/mlb/MlbLiveDiamond";
import { Panel, PanelHeader } from "@/components/shared/booth";
import {
  americanText,
  firstFive,
  hasScore,
  lineText,
  ordinal,
  type MlbGame,
  type MlbGameDetail,
  type MlbPitcher,
  type MlbPlay,
} from "@/lib/mlb/mlb";
import {
  mlbMarketRows,
  mlbRatings,
  projectMlbGame,
  type MlbMarketRow,
  type MlbProjection,
} from "@/lib/mlb/mlb-model";
import { useMlbGameDetail, useMlbSchedule } from "@/lib/mlb/use-mlb";

type GameTab = "gamecast" | "stats" | "markets" | "information";

const pct = (p: number | null | undefined, digits = 0) =>
  p == null ? "—" : `${(p * 100).toFixed(digits)}%`;

export function MlbGameDetailView({ gameId }: { gameId: string }) {
  const { games, isLoading } = useMlbSchedule(30_000);
  const scheduled = games.find((g) => g.id === gameId);
  const detail = useMlbGameDetail(gameId, scheduled?.status === "live" || scheduled === undefined);
  const data = (detail.data ?? undefined) as MlbGameDetail | undefined;
  const game: MlbGame | undefined =
    scheduled && data
      ? {
          ...data.game,
          ...scheduled,
          odds: scheduled.odds ?? data.game.odds,
          situation: scheduled.situation ?? data.game.situation,
        }
      : (scheduled ?? data?.game);

  const started0 = game ? game.status === "live" || game.status === "final" : false;
  const [tab, setTab] = useState<GameTab | null>(null);
  const activeTab: GameTab = tab ?? (started0 ? "gamecast" : "markets");
  useEffect(() => {
    if (game?.status === "live" && tab === "information") setTab("gamecast");
  }, [game?.status, tab]);

  if (!game) {
    return (
      <MlbEmpty>
        {isLoading || detail.isLoading
          ? "Loading game…"
          : "That game wasn't found in this season's schedule."}{" "}
        <Link to="/mlb/games" className="text-acc">
          All games →
        </Link>
      </MlbEmpty>
    );
  }

  const started = game.status === "live" || game.status === "final";
  const plays = data?.plays ?? [];
  const tabs: [GameTab, string][] = [
    ["gamecast", "Gamecast"],
    ["stats", "Stats"],
    ["markets", "Markets"],
    ...(game.status !== "live" ? ([["information", "Information"]] as [GameTab, string][]) : []),
  ];

  return (
    <>
      {game.status === "live" ? <MlbLiveScoreboard game={game} /> : <Header game={game} />}
      <nav
        className={`grid border-b border-line/15 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}
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
                  Line score
                </h2>
                <span className="label-mono">runs by inning</span>
              </div>
              <div className="mt-3">
                <LineScore game={game} />
              </div>
            </Panel>
          ) : (
            <Panel>
              <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
                The gamecast starts at first pitch
              </p>
            </Panel>
          )}
          {started ? <ScoringPlays game={game} plays={plays} /> : null}
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

      {activeTab === "markets" ? <Markets game={game} games={games} /> : null}

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
        <Link to="/mlb/games" className="text-acc">
          ← All games
        </Link>
      </p>
    </>
  );
}

const pitcherLine = (p?: MlbPitcher) =>
  p
    ? `${p.name}${p.record ? ` (${p.record}` : ""}${p.era != null ? `${p.record ? ", " : " ("}${p.era.toFixed(2)} ERA)` : p.record ? ")" : ""}`
    : "TBD";

/** Scoreboard for upcoming and finished games (same sizes as the NFL, NBA and NHL headers). */
function Header({ game }: { game: MlbGame }) {
  const isFinal = game.status === "final";
  const awayWon =
    isFinal && hasScore(game) && (game.away.score as number) > (game.home.score as number);
  const homeWon =
    isFinal && hasScore(game) && (game.home.score as number) > (game.away.score as number);
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
  const fav =
    game.odds?.mlHome != null && game.odds?.mlAway != null
      ? game.odds.mlHome < game.odds.mlAway
        ? "home"
        : "away"
      : null;
  const side = (s: MlbGame["away"], won: boolean, i: number) => (
    <div className={`flex items-center gap-3 sm:gap-6 ${i === 1 ? "flex-row-reverse" : ""}`}>
      <Link
        to="/mlb/teams/$teamId"
        params={{ teamId: s.team.id }}
        className="group flex flex-col items-center gap-1 text-center"
      >
        <MlbLogo
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
              {game.inning > 9 ? `FINAL/${game.inning}` : "FINAL"}
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
          {game.note ? (
            <span className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              {game.note}
            </span>
          ) : null}
        </div>
        {side(game.home, homeWon, 1)}
      </div>
      {!isFinal ? (
        <div className="mx-auto mt-3 grid max-w-2xl grid-cols-2 gap-3 font-mono text-[11px] text-mute">
          <span>{pitcherLine(game.away.probable)}</span>
          <span className="text-right">{pitcherLine(game.home.probable)}</span>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
        <span>Moneyline:</span>
        {fav ? (
          <span className="inline-flex items-center gap-1">
            <MlbLogo team={game[fav].team} className="size-4" />
            <span className="font-semibold text-foreground">
              {americanText(fav === "home" ? game.odds?.mlHome : game.odds?.mlAway)}
            </span>
          </span>
        ) : (
          <span className="font-semibold text-foreground">—</span>
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

function LineScore({ game }: { game: MlbGame }) {
  const n = Math.max(9, game.away.innings?.length ?? 0, game.home.innings?.length ?? 0);
  const winner =
    game.status === "final" && hasScore(game)
      ? (game.away.score as number) > (game.home.score as number)
        ? "away"
        : "home"
      : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-center font-mono text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className="text-left font-normal">Team</th>
            {Array.from({ length: n }, (_, i) => (
              <th key={i} className="font-normal">
                {i + 1}
              </th>
            ))}
            <th className="border-l border-line/10 font-normal">R</th>
            <th className="font-normal">H</th>
            <th className="font-normal">E</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {(
            [
              ["away", game.away],
              ["home", game.home],
            ] as const
          ).map(([key, s]) => (
            <tr key={key}>
              <td className="py-2 text-left font-medium">
                <span className="inline-flex items-center gap-2">
                  <MlbLogo team={s.team} className="size-5" />
                  {s.team.abbr}
                </span>
              </td>
              {Array.from({ length: n }, (_, i) => (
                <td key={i} className="py-2 tabular-nums text-mute">
                  {s.innings?.[i] ??
                    (game.status === "final" && i < (s.innings?.length ?? 0) ? 0 : "")}
                </td>
              ))}
              <td
                className={`border-l border-line/10 py-2 font-semibold tabular-nums ${winner === key ? "text-acc" : ""}`}
              >
                {s.score ?? 0}
              </td>
              <td className="py-2 tabular-nums">{s.hits ?? "—"}</td>
              <td className="py-2 tabular-nums">{s.errors ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {firstFive(game.away) !== null && firstFive(game.home) !== null ? (
        <p className="mt-2 font-mono text-[11px] text-mute">
          First 5 innings: {game.away.team.abbr} {firstFive(game.away)} – {firstFive(game.home)}{" "}
          {game.home.team.abbr}
        </p>
      ) : null}
    </div>
  );
}

const halfLabel = (p: Pick<MlbPlay, "inning" | "half">) =>
  `${p.half === "top" ? "Top" : "Bot"} ${ordinal(p.inning)}`;

function ScoringPlays({ game, plays }: { game: MlbGame; plays: MlbPlay[] }) {
  const scoring = plays.filter((p) => p.scoring);
  const teamOf = (p: MlbPlay) =>
    p.teamId === game.home.team.id
      ? game.home.team
      : p.teamId === game.away.team.id
        ? game.away.team
        : p.half === "top"
          ? game.away.team
          : game.home.team;
  return (
    <Panel padded={false}>
      <PanelHeader title="Scoring plays" />
      {scoring.length ? (
        <ul className="divide-y divide-line/5">
          {scoring.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">
                {halfLabel(p)}
              </span>
              <MlbLogo team={teamOf(p)} className="size-5" />
              <span className="min-w-0 flex-1">{p.text}</span>
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
          No runs yet
        </p>
      )}
    </Panel>
  );
}

function Plays({ game, plays, loading }: { game: MlbGame; plays: MlbPlay[]; loading: boolean }) {
  const [scoringOnly, setScoringOnly] = useState(false);
  const [inning, setInning] = useState<number | "all">("all");
  const innings = [...new Set(plays.map((p) => p.inning))].filter(Boolean).sort((a, b) => a - b);
  const shown = useMemo(
    () =>
      plays
        .filter((p) => (!scoringOnly || p.scoring) && (inning === "all" || p.inning === inning))
        .slice()
        .reverse(),
    [plays, scoringOnly, inning],
  );
  if (!plays.length)
    return (
      <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
        {loading ? "Loading play-by-play…" : "ESPN has no play-by-play yet."}
      </p>
    );
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${on ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`;
  const teamOf = (p: MlbPlay) => (p.half === "top" ? game.away.team : game.home.team);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setScoringOnly((v) => !v)}
          aria-pressed={scoringOnly}
          className={chip(scoringOnly)}
        >
          Scoring plays
        </button>
        <span className="mx-1 w-px self-stretch bg-line/10" />
        {(["all", ...innings] as (number | "all")[]).map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => setInning(i)}
            aria-pressed={inning === i}
            className={chip(inning === i)}
          >
            {i === "all" ? "All" : ordinal(i)}
          </button>
        ))}
      </div>
      <ul className="max-h-[560px] divide-y divide-line/5 overflow-y-auto">
        {shown.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">
              {halfLabel(p)}
            </span>
            <MlbLogo team={teamOf(p)} className="size-5" />
            <span className={`min-w-0 flex-1 ${p.scoring ? "font-medium" : "text-mute"}`}>
              {p.text}
            </span>
            {p.awayScore !== null && p.homeScore !== null ? (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-mute">
                {p.awayScore}–{p.homeScore}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BoxScore({
  game,
  detail,
  started,
  loading,
}: {
  game: MlbGame;
  detail?: MlbGameDetail;
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
  if (!detail?.box.length)
    return (
      <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
        {loading ? "Loading box score…" : "ESPN has no box score for this game yet."}
      </p>
    );
  const team = detail.box.find((b) => b.teamId === teamId);
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
            <MlbLogo team={t} className="size-4" />
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
                      {/pitch/i.test(g.name)
                        ? "Pitching"
                        : /bat/i.test(g.name)
                          ? "Batting"
                          : g.name}
                    </th>
                    {g.labels.map((l) => (
                      <th key={l} className="px-1.5 py-1.5 text-right font-normal">
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {g.athletes.map((a, i) => (
                    <tr key={`${a.id}-${i}`}>
                      <td className="whitespace-nowrap py-1.5 pr-2">
                        {a.name}
                        {a.position ? (
                          <span className="ml-1.5 font-mono text-[10px] text-faint">
                            {a.position}
                          </span>
                        ) : null}
                      </td>
                      {a.stats.map((v, j) => (
                        <td
                          key={j}
                          className="px-1.5 py-1.5 text-right font-mono tabular-nums text-mute"
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {g.totals ? (
                    <tr className="font-semibold">
                      <td className="py-1.5 pr-2">Team</td>
                      {g.totals.map((v, j) => (
                        <td key={j} className="px-1.5 py-1.5 text-right font-mono tabular-nums">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ) : null}
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
  game: MlbGame;
  detail?: MlbGameDetail;
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
          <th className="pb-2 text-left font-normal">{game.away.team.abbr}</th>
          <th className="pb-2 font-normal" />
          <th className="pb-2 text-right font-normal">{game.home.team.abbr}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5">
        {rows.map((r, i) => (
          <tr key={`${r.label}-${i}`}>
            <td className="py-1.5 font-mono tabular-nums">{r.away}</td>
            <td className="py-1.5 text-center text-[11px] text-mute">{r.label}</td>
            <td className="py-1.5 text-right font-mono tabular-nums">{r.home}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- Markets ---------- */

function Markets({ game, games }: { game: MlbGame; games: MlbGame[] }) {
  const ratings = useMemo(() => mlbRatings(games, game.date), [games, game.date]);
  const p = useMemo(() => projectMlbGame(game, ratings), [game, ratings]);
  const rows = useMemo(() => mlbMarketRows(game, p), [game, p]);
  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <ModelCard game={game} p={p} rows={rows} />
        <LinesCard game={game} />
      </div>
      <Panel padded={false}>
        <PanelHeader title="Model vs sportsbook" />
        <div className="px-3 pb-4 sm:px-4">
          <MarketTable rows={rows} />
          <p className="mt-3 text-[11px] text-mute">
            Research: a fuller starter / bullpen / lineup / park model lost to the closing line in
            every season from 2012 to 2025 (32,000 games), so treat these numbers as reference. Edge
            = model chance − the book&apos;s no-vig chance.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function ModelCard({ game, p, rows }: { game: MlbGame; p: MlbProjection; rows: MlbMarketRow[] }) {
  // Fair prices only: the research found no edge against the closing line, so no picks are shown.
  const row = (m: MlbMarketRow["market"], side: MlbMarketRow["side"]) =>
    rows.find((r) => r.market === m && r.side === side);
  const ml = p.pHome >= p.pAway ? row("Moneyline", "home") : row("Moneyline", "away");
  const rl = row("Run line", "home");
  const over = row("Total", "over");
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Model</h2>
      <p className="label-mono mb-3">Team runs this season + probable starters</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono tabular-nums">
        <span className="text-2xl">{p.awayRuns.toFixed(2)}</span>
        <span className="text-[10px] uppercase tracking-wider text-faint">proj. runs</span>
        <span className="text-right text-2xl">{p.homeRuns.toFixed(2)}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel2">
        <div className="h-2 bg-acc" style={{ width: `${p.pAway * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-mute">
        <span>
          {game.away.team.abbr} {pct(p.pAway)}
        </span>
        <span>
          {game.home.team.abbr} {pct(p.pHome)}
        </span>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Moneyline</dt>
          <dd className="text-right font-mono">
            {ml ? `${ml.label} ${pct(ml.pModel)} · fair ${americanText(ml.fair)}` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Run line</dt>
          <dd className="text-right font-mono">
            {rl ? `${rl.label} ${pct(rl.pModel)} · fair ${americanText(rl.fair)}` : "No line"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Total</dt>
          <dd className="text-right font-mono">
            proj {p.expTotal.toFixed(1)}
            {over ? ` · over ${over.line} ${pct(over.pModel)}` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">First 5 innings</dt>
          <dd className="text-right font-mono">
            {p.f5.awayRuns.toFixed(1)}–{p.f5.homeRuns.toFixed(1)} · {game.away.team.abbr}{" "}
            {pct(p.f5.pAway)} / tie {pct(p.f5.pTie)} / {game.home.team.abbr} {pct(p.f5.pHome)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-faint">
        {pitcherLineShort(game.away.probable)} vs {pitcherLineShort(game.home.probable)}
      </p>
    </Panel>
  );
}

const pitcherLineShort = (p?: MlbPitcher) =>
  p ? `${p.name}${p.era != null ? ` ${p.era.toFixed(2)}` : ""}` : "TBD";

function LinesCard({ game }: { game: MlbGame }) {
  const o = game.odds;
  const final = game.status === "final" && hasScore(game);
  const a = game.away.score ?? 0;
  const h = game.home.score ?? 0;
  const cover =
    final && o?.spread != null
      ? (() => {
          const m = h - a + (o.spread as number);
          return m > 0
            ? `${game.home.team.abbr} covered`
            : m < 0
              ? `${game.away.team.abbr} covered`
              : "push";
        })()
      : null;
  const ou =
    final && o?.total != null
      ? a + h > o.total
        ? "over"
        : a + h < o.total
          ? "under"
          : "push"
      : null;
  const moved = (
    open: number | null | undefined,
    now: number | null | undefined,
    f: (n: number | null | undefined) => string,
  ) =>
    open != null && now != null && open !== now ? (
      <span className="text-mute">
        {f(open)} → <span className="text-foreground">{f(now)}</span>
      </span>
    ) : (
      f(now)
    );
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Lines</h2>
      <p className="label-mono mb-3">
        {o?.provider ?? "ESPN odds"}
        {o?.open ? " · open → current" : ""}
      </p>
      {o ? (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-mute">{game.away.team.abbr} moneyline</dt>
            <dd className="font-mono">{moved(o.open?.mlAway, o.mlAway, americanText)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-mute">{game.home.team.abbr} moneyline</dt>
            <dd className="font-mono">{moved(o.open?.mlHome, o.mlHome, americanText)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-mute">Run line ({game.home.team.abbr})</dt>
            <dd className="font-mono">
              {lineText(o.spread)}
              {o.spreadOddsHome != null ? ` (${americanText(o.spreadOddsHome)})` : ""}
              {cover ? ` · ${cover}` : ""}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-mute">Total</dt>
            <dd className="font-mono">
              {moved(o.open?.total, o.total, (n) => lineText(n, false))}
              {ou ? ` · ${ou}` : ""}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="font-mono text-xs text-mute">No lines posted yet.</p>
      )}
    </Panel>
  );
}

const signed = (n: number | null, d: number, suffix = "") =>
  n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}${suffix}`;
const tone = (n: number | null) =>
  n === null ? "text-mute" : n > 0 ? "text-win" : n < 0 ? "text-loss" : "text-mute";

function MarketTable({ rows }: { rows: MlbMarketRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-3 py-2 font-normal">Market</th>
            <th className="px-2 py-2 font-normal">Pick</th>
            <th className="px-2 py-2 text-right font-normal">Book</th>
            <th className="px-2 py-2 text-right font-normal">Model</th>
            <th className="px-2 py-2 text-right font-normal">Fair odds</th>
            <th className="px-2 py-2 text-right font-normal">No-vig book</th>
            <th className="px-2 py-2 text-right font-normal">Edge</th>
            <th className="px-3 py-2 text-right font-normal">EV / 1u</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {rows.map((r, i) => {
            const first = i === 0 || rows[i - 1].market !== r.market;
            return (
              <tr
                key={`${r.market}-${r.label}`}
                className={first && i > 0 ? "border-t border-line/15" : ""}
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-mute">
                  {first ? r.market : ""}
                </td>
                <td className="whitespace-nowrap px-2 py-2 font-medium">{r.label}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">
                  {americanText(r.price)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">
                  {pct(r.pModel, 1)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">
                  {americanText(r.fair)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-mute">
                  {pct(r.pMarket, 1)}
                </td>
                <td
                  className={`whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums ${tone(r.edge)}`}
                >
                  {signed(r.edge === null ? null : r.edge * 100, 1, " pp")}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${tone(r.ev)}`}
                >
                  {signed(r.ev, 3, "u")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GameInfo({ game }: { game: MlbGame }) {
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
    ["First pitch", when || undefined],
    ["Ballpark", game.venue],
    ["TV", game.broadcast],
    ["Weather", game.weather],
    [`${game.away.team.abbr} starter`, pitcherLine(game.away.probable)],
    [`${game.home.team.abbr} starter`, pitcherLine(game.home.probable)],
    [
      "Game",
      [game.part === "post" ? "Postseason" : "Regular season", game.note]
        .filter(Boolean)
        .join(" · "),
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

function Injuries({ game, injuries }: { game: MlbGame; injuries: MlbGameDetail["injuries"] }) {
  return (
    <Panel padded={false}>
      <PanelHeader title="Injuries" />
      <div className="divide-y divide-line/5">
        {injuries.slice(0, 14).map((i, n) => {
          const t = i.teamId === game.home.team.id ? game.home.team : game.away.team;
          return (
            <div key={`${i.name}-${n}`} className="flex items-center gap-2 px-4 py-2 text-sm">
              <MlbLogo team={t} className="size-4" />
              <span className="flex-1 truncate">{i.name}</span>
              <span
                className={`font-mono text-[10px] uppercase tracking-wider ${/out|il/i.test(i.status) ? "text-loss" : "text-mute"}`}
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
