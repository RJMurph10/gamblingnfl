import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  GameRow,
  MatchupLink,
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  SpreadBadge,
  StatCard,
  TeamLogo,
  TeamMark,
  marketResultClass,
} from "@/components/booth";
import { gameScore, type Game } from "@/data/games";
import { players } from "@/data/players";
import { teamById, teams } from "@/data/teams";
import { getLiveSchedule, getPriorSeasonResults } from "@/lib/espn.functions";
import { summarizeModel, unitsText } from "@/lib/game-model";
import { getNflHistory } from "@/lib/history.functions";
import { runModelWithHistory, type HistoryGame } from "@/lib/model-history";
import { buildSeasonPulse, changeTone, weekChangeText } from "@/lib/season-pulse";

/* ---------- Live games: row without date/time, clock first ---------- */

function LiveGameRow({ game, showDown }: { game: Game; showDown: boolean }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  if (!away || !home) return null;
  const score = gameScore(game);
  // "8:42 - 1st Quarter" -> "1st 8:42"
  const rawClock = (game.clock ?? "Live").replace(/\s*Quarter\b/i, "");
  const clockMatch = rawClock.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
  const clock = clockMatch ? `${clockMatch[2]} ${clockMatch[1]}` : rawClock;

  const { spread: spreadClass, total: totalClass } = marketResultClass(game, away, home);
  const isHalftime = /half/i.test(game.clock ?? "");
  // A TD/FG is only a brief substitute for the dash while ESPN has no
  // live down-and-distance to report. As soon as downs return, show them.
  const liveDownDistance = game.downDistance?.trim() ?? "";
  const hasLiveDowns = liveDownDistance !== "" && !/^[-—]+$/.test(liveDownDistance);
  const showScoringTransition = Boolean(game.scoringAlert) && !hasLiveDowns;
  // Team whose side of the field the ball is on (none at midfield).
  const ballTeam =
    game.ballSpot?.side === "away" ? away : game.ballSpot?.side === "home" ? home : null;

  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{clock}</td>
      {showDown ? (
        <td className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">
          {!isHalftime ? (
            showScoringTransition ? (
              <span className="inline-flex items-center gap-1">
                <TeamLogo team={teamById(game.scoringAlert!.teamId)!} className="size-4" />
                {game.scoringAlert!.type === "FG"
                  ? `${game.scoringAlert!.yards ?? ""}${game.scoringAlert!.yards ? "yd " : ""}FG`
                  : "TD"}
              </span>
            ) : hasLiveDowns ? (
              <span className="inline-flex items-center gap-1">
                {liveDownDistance}
                {ballTeam ? (
                  <>
                    <span>·</span>
                    <TeamLogo team={ballTeam} className="size-4" />
                    <span>{game.ballSpot!.yard}</span>
                  </>
                ) : game.ballSpot?.side === "mid" ? (
                  <>
                    <span>·</span>
                    <span>50</span>
                  </>
                ) : null}
              </span>
            ) : (
              "—"
            )
          ) : (
            ""
          )}
        </td>
      ) : null}
      <td className="px-2 py-2.5 text-center">
        <MatchupLink
          game={game}
          away={away}
          home={home}
          awayScore={score.away}
          homeScore={score.home}
          showPossession
        />
      </td>
      <td
        className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${spreadClass}`}
      >
        <div className="flex items-center justify-end">
          <SpreadBadge spread={game.spread} away={away} home={home} />
        </div>
      </td>
      <td
        className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${totalClass}`}
      >
        {game.total || "—"}
      </td>
    </tr>
  );
}

/* ---------- Upcoming games: one tab per day (Eastern Time) ---------- */

interface GameDay {
  key: string;
  label: string;
  dateLabel: string;
  week: number;
  games: Game[];
}

const etFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// One entry per calendar day, covering the next 7 days only, so a weekday never repeats.
function buildDays(all: Game[]): GameDay[] {
  const upcoming = all
    .filter((g) => g.status === "scheduled" && g.kickoffIso)
    .sort((a, b) => new Date(a.kickoffIso!).getTime() - new Date(b.kickoffIso!).getTime());
  const days = new Map<string, GameDay>();
  let firstDay = 0;
  for (const game of upcoming) {
    const parts = etFormat.formatToParts(new Date(game.kickoffIso!));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const year = Number(get("year"));
    const month = Number(get("month"));
    const dayNum = Number(get("day"));
    const weekday = get("weekday");
    const dayIndex = Math.floor(Date.UTC(year, month - 1, dayNum) / 86_400_000);
    if (days.size === 0) firstDay = dayIndex;
    if (dayIndex - firstDay > 6) break;
    const key = `${year}-${month}-${dayNum}`;
    if (!days.has(key)) {
      days.set(key, {
        key,
        label: weekday,
        dateLabel: `${weekday}, ${MONTHS[month - 1]} ${dayNum}`,
        week: game.week,
        games: [],
      });
    }
    days.get(key)!.games.push(game);
  }
  return [...days.values()];
}

function UpcomingGames({ games: all }: { games: Game[] }) {
  const days = useMemo(() => buildDays(all), [all]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const active = days.find((d) => d.key === selectedKey) ?? days[0];

  return (
    <Panel padded={false}>
      <PanelHeader
        title="Upcoming games"
        aside={
          active ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
              Wk {active.week} · {active.games.length}{" "}
              {active.games.length === 1 ? "game" : "games"}
            </span>
          ) : null
        }
      />
      {active ? (
        <>
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {days.map((day) => {
              const isActive = day.key === active.key;
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => setSelectedKey(day.key)}
                  aria-pressed={isActive}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                    isActive
                      ? "bg-acc/10 text-acc ring-acc/25"
                      : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="w-[17%] px-4 py-2 font-normal">Date</th>
                  <th className="w-[15%] px-2 py-2 font-normal">Time</th>
                  <th className="w-[26%] px-2 py-2 text-center font-normal">Matchup</th>
                  <th className="w-[22%] px-2 py-2 font-normal">Venue</th>
                  <th className="w-[10%] px-2 py-2 text-right font-normal">Spread</th>
                  <th className="w-[10%] px-4 py-2 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {active.games.map((g) => (
                  <GameRow
                    key={g.id}
                    game={{ ...g, date: g.date?.replace(/^[A-Za-z]+,\s*/, "") }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="px-4 py-6 text-center font-mono text-xs text-mute">
          No upcoming games scheduled
        </div>
      )}
    </Panel>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingNFL dashboard" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "description",
        content:
          "GamblingNFL home dashboard: season pulse metrics, recent games, the 32-team grid, and player leaders.",
      },
      { property: "og:title", content: "Season Pulse — GamblingNFL dashboard" },
      {
        property: "og:description",
        content:
          "Season metrics, live and upcoming games, recent results, team grid, and player leaders in one view.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const {
    data: liveGames,
    isLoading: scheduleLoading,
    isError: scheduleError,
  } = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    refetchInterval: 1_500, // refresh score and scoring transition together
    staleTime: 0,
    retry: 1,
  });

  // Never substitute the hardcoded sample schedule when ESPN is unavailable.
  const source: Game[] = liveGames ?? [];
  const isLive = source.length > 0;
  const toTimestamp = (g: (typeof source)[number]) => {
    if (g.kickoffIso) return new Date(g.kickoffIso).getTime();
    const d = g.date?.replace(/^[A-Za-z]+,\s*/, "") || "";
    const t = g.time?.replace(/\s*ET$/, "") || "";
    return new Date(`${d} 2026 ${t}`).getTime() || 0;
  };

  const recent = source
    .filter((g) => g.status === "final")
    .sort((a, b) => b.week - a.week || toTimestamp(b) - toTimestamp(a))
    .slice(0, 5);
  const live = source.filter((g) => g.status === "live");
  // Hide the Down column when every live game is at halftime.
  const showLiveDownColumn = live.some((g) => !/half/i.test(g.clock ?? ""));

  // Season Pulse: the model's record and units (flat 1u), plus the league's average total.
  const pulse = useMemo(() => buildSeasonPulse(source), [source]);
  // Last season's scores give the model a head start in the first weeks.
  const priorQuery = useQuery({
    queryKey: ["prior-season-results"],
    queryFn: () => getPriorSeasonResults(),
    staleTime: 12 * 60 * 60_000,
    retry: 1,
  });
  const priorSeason = useMemo(() => priorQuery.data ?? [], [priorQuery.data]);
  const historyQuery = useQuery({
    queryKey: ["nfl-history"],
    queryFn: () => getNflHistory(),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  const history: HistoryGame[] = useMemo(
    () =>
      (historyQuery.data?.games ?? []).filter((h) => h.season < historyQuery.data!.currentSeason),
    [historyQuery.data],
  );
  const modelRows = useMemo(
    () => runModelWithHistory(source, priorSeason, history),
    [source, priorSeason, history],
  );
  // Accuracy cards grade every game; the units card follows the best bets (what it would bet).
  const model = useMemo(() => summarizeModel(modelRows, "predictions"), [modelRows]);
  const bets = useMemo(() => summarizeModel(modelRows, "bets"), [modelRows]);
  const prev = model.previous;
  const pctChange = (now: number | null, before: number | null | undefined) =>
    now !== null && before !== null && before !== undefined
      ? Math.round((now - before) * 10) / 10
      : null;
  const winner = model.byMarket.moneyline;
  const winChange = pctChange(winner.winPct, prev?.byMarket.moneyline.winPct);
  const coverChange = pctChange(model.byMarket.spread.winPct, prev?.byMarket.spread.winPct);
  const totalChange = pctChange(model.byMarket.total.winPct, prev?.byMarket.total.winPct);
  const unitsChange = bets.previous
    ? Math.round((bets.overall.units - bets.previous.overall.units) * 100) / 100
    : null;
  const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
  const rec = (r: { wins: number; losses: number; pushes: number }) =>
    `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
  const note = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");

  const topPlayers = [...players].sort((a, b) => b.season.yards - a.season.yards).slice(0, 5);

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={isLive ? "Home dashboard · 2026 live schedule" : "Home dashboard"}
          title="Season Pulse"
          aside={isLive ? undefined : <SampleBadge />}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(winner.winPct)}
            unit={winner.winPct === null ? undefined : "%"}
            note={
              scheduleLoading
                ? "Loading…"
                : note(weekChangeText(winChange), `${rec(winner)} picking winners`)
            }
            tone={changeTone(winChange)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(model.byMarket.total.winPct)}
            unit={model.byMarket.total.winPct === null ? undefined : "%"}
            note={
              scheduleLoading
                ? "Loading…"
                : note(
                    weekChangeText(totalChange),
                    `${rec(model.byMarket.total)} O/U`,
                    pulse.avgTotal.value !== null && pulse.avgTotalLine !== null
                      ? `games avg ${pulse.avgTotal.value.toFixed(1)} vs line ${pulse.avgTotalLine.toFixed(1)}`
                      : undefined,
                  )
            }
            tone={changeTone(totalChange)}
          />
          <StatCard
            label="Cover % · model"
            value={fmt(model.byMarket.spread.winPct)}
            unit={model.byMarket.spread.winPct === null ? undefined : "%"}
            note={
              scheduleLoading
                ? "Loading…"
                : note(weekChangeText(coverChange), `${rec(model.byMarket.spread)} ATS`)
            }
            tone={changeTone(coverChange)}
          />
          <StatCard
            label="Model edge · ★ best bets"
            value={unitsText(bets.overall.units)}
            note={
              scheduleLoading
                ? "Loading…"
                : note(
                    unitsChange === null
                      ? undefined
                      : `${unitsChange > 0 ? "▲" : unitsChange < 0 ? "▼" : "—"} ${Math.abs(unitsChange).toFixed(2)}u wk/wk`,
                    bets.overall.roi === null
                      ? "No best bets graded yet"
                      : `${rec(bets.overall)} · ROI ${bets.overall.roi > 0 ? "+" : ""}${bets.overall.roi.toFixed(1)}%`,
                    `every game ${unitsText(model.overall.units)}`,
                  )
            }
            tone={bets.overall.units > 0 ? "win" : bets.overall.units < 0 ? "loss" : "mute"}
          />
        </div>
        {pulse.throughWeek !== null ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            Through week {pulse.throughWeek} · flat 1u per pick at closing ESPN odds ·{" "}
            <Link to="/model" className="text-acc">
              Model picks →
            </Link>
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-8 space-y-6">
          {live.length > 0 ? (
            <Panel padded={false}>
              <PanelHeader
                title={
                  <span className="flex items-center gap-2">
                    <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
                    Live games
                  </span>
                }
                aside={
                  <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                    {live.length} in progress
                  </span>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm" style={{ tableLayout: "fixed" }}>
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="w-[14%] px-4 py-2 font-normal">Game Clock</th>
                      {showLiveDownColumn ? (
                        <th className="w-[28%] px-2 py-2 font-normal">Down</th>
                      ) : null}
                      <th className="w-[26%] px-2 py-2 text-center font-normal">Matchup</th>
                      <th className="w-[16%] px-2 py-2 text-right font-normal">Spread</th>
                      <th className="w-[16%] px-4 py-2 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {live.map((g) => (
                      <LiveGameRow key={g.id} game={g} showDown={showLiveDownColumn} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          <UpcomingGames games={source} />

          <Panel padded={false}>
            <PanelHeader
              title="Recent games"
              aside={
                <Link to="/games" className="font-mono text-[11px] text-acc">
                  View all →
                </Link>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="w-[17%] px-4 py-2 font-normal">Date</th>
                    <th className="w-[15%] px-2 py-2 font-normal">Time</th>
                    <th className="w-[26%] px-2 py-2 text-center font-normal">Matchup</th>
                    <th className="w-[22%] px-2 py-2 font-normal">Venue</th>
                    <th className="w-[10%] px-2 py-2 text-right font-normal">Spread</th>
                    <th className="w-[10%] px-4 py-2 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {recent.length > 0 ? (
                    recent.map((g) => <GameRow key={g.id} game={g} />)
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center font-mono text-xs text-mute">
                        {scheduleLoading
                          ? "Loading games from ESPN…"
                          : scheduleError
                            ? "Could not load games from ESPN. Try refreshing shortly."
                            : "No completed NFL games are currently available from ESPN."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <aside className="min-w-0 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Team grid</h2>
            <p className="label-mono mb-3">32 clubs · tap to open</p>
            <div className="grid grid-cols-4 gap-2">
              {teams.slice(0, 12).map((team) => (
                <Link
                  key={team.id}
                  to="/teams/$teamId"
                  params={{ teamId: team.id }}
                  className="glass grid aspect-square place-items-center rounded-xl hover:glow"
                  style={{ boxShadow: `inset 0 0 0 1px ${team.color}44` }}
                >
                  <TeamLogo team={team} className="size-9" />
                </Link>
              ))}
            </div>
            <Link
              to="/teams"
              className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc"
            >
              + all 32 teams
            </Link>
          </Panel>
        </aside>
      </div>

      <section className="mt-6">
        <Panel padded={false}>
          <PanelHeader
            title="Player leaders"
            aside={
              <span className="flex items-center gap-3">
                <SampleBadge />
                <Link to="/players" className="font-mono text-[11px] text-acc">
                  Search players →
                </Link>
              </span>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Player</th>
                  <th className="px-2 py-2 font-normal">Pos</th>
                  <th className="px-2 py-2 font-normal">Team</th>
                  <th className="px-2 py-2 text-right font-normal">Yds</th>
                  <th className="px-2 py-2 text-right font-normal">TD</th>
                  <th className="px-4 py-2 font-normal">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {topPlayers.map((p) => {
                  const team = teams.find((t) => t.id === p.teamId);
                  const share = Math.round((p.season.yards / topPlayers[0]!.season.yards) * 100);
                  return (
                    <tr key={p.id} className="hover:bg-line/5">
                      <td className="px-4 py-2.5">
                        <Link
                          to="/players/$playerId"
                          params={{ playerId: p.id }}
                          className="font-medium hover:text-acc"
                        >
                          {p.firstName} {p.lastName}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-mute">{p.position}</td>
                      <td className="px-2 py-2.5 font-mono text-mute">{team?.abbr}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                        {p.season.yards.toLocaleString()}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                        {p.season.tds}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="h-1.5 w-24 rounded-full bg-panel2">
                          <div
                            className="h-1.5 rounded-full bg-acc"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="mt-6">
        <Panel className="flex flex-wrap items-center gap-3">
          <TeamMark team={teams[13]!} size="sm" />
          <p className="text-sm text-mute">
            Backend is wired for your own Supabase project. Until real play-by-play data is
            imported, every figure on this site is placeholder.
          </p>
          <Link
            to="/props"
            className="ml-auto rounded-lg bg-acc/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-acc/25"
          >
            Prop model
          </Link>
        </Panel>
      </section>
    </>
  );
}
