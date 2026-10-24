import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LiveGamesPanel, RecentGamesPanel, UpcomingGames } from "@/components/GameTables";
import {
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  StatCard,
  TeamLogo,
  TeamMark,
} from "@/components/booth";
import type { Game } from "@/data/games";
import { players } from "@/data/players";
import { teams } from "@/data/teams";
import { getLiveSchedule, getPriorSeasonResults } from "@/lib/espn.functions";
import { summarizeModel, unitsText } from "@/lib/game-model";
import { getNflHistory } from "@/lib/history.functions";
import { readHistory, runModelWithHistory } from "@/lib/model-history";
import { buildSeasonPulse, changeTone, weekChangeText } from "@/lib/season-pulse";

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
    queryKey: ["nfl-history-v2"],
    queryFn: () => getNflHistory(),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  const { history, current, runOptions } = useMemo(() => {
    const { games, currentSeason, upcoming, qbRows } = readHistory(historyQuery.data);
    return {
      runOptions: { qbRows },
      history: games.filter((h) => h.season < currentSeason),
      current: {
        season: currentSeason,
        games: games.filter((h) => h.season === currentSeason),
        upcoming,
      },
    };
  }, [historyQuery.data]);
  const modelRows = useMemo(
    () => runModelWithHistory(source, priorSeason, history, current, runOptions),
    [source, priorSeason, history, current, runOptions],
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
          <LiveGamesPanel games={live} />

          <UpcomingGames games={source} />

          <RecentGamesPanel
            games={recent}
            allGamesTo="/games"
            emptyText={
              scheduleLoading
                ? "Loading games from ESPN…"
                : scheduleError
                  ? "Could not load games from ESPN. Try refreshing shortly."
                  : "No completed NFL games are currently available from ESPN."
            }
          />
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
