import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, StatCard } from "@/components/shared/booth";
import { CbbLogo } from "@/components/cbb/CbbBits";
import { CbbLiveGames, CbbRecentGames, CbbUpcomingGames } from "@/components/cbb/CbbDashTables";
import { buildCbbStandings, hasScore, recordText } from "@/lib/cbb/cbb";
import { gradeCbbSeason, unitsText, winPct, type CbbRecord } from "@/lib/cbb/cbb-model";
import { changeTone, weekChangeText } from "@/lib/shared/season-pulse";
import { useCbbModel, useCbbSchedule } from "@/lib/cbb/use-cbb";

export const Route = createFileRoute("/cbb/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingCBB dashboard" },
      {
        name: "description",
        content:
          "Men's college basketball dashboard: how the model's picks did against the closing lines, live and upcoming games, recent results and the AP Top 25.",
      },
    ],
  }),
  component: CbbDashboard,
});

const rec = (r: CbbRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const note = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(" · ");
const pctChange = (now: number | null, before: number | null) =>
  now !== null && before !== null ? Math.round((now - before) * 10) / 10 : null;

function CbbDashboard() {
  const { games, teams, rankings, season, isLoading, isError } = useCbbSchedule(60_000);
  const rows = useCbbModel(games);
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 3_600_000), []);
  const grade = useMemo(() => gradeCbbSeason(rows), [rows]);
  const prev = useMemo(() => gradeCbbSeason(rows, weekAgo), [rows, weekAgo]);
  const hasPrev = prev.games > 0 && prev.games !== grade.games;

  const live = useMemo(() => games.filter((g) => g.status === "live"), [games]);
  const finals = useMemo(
    () =>
      games
        .filter((g) => g.status === "final" && hasScore(g))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [games],
  );
  const standings = useMemo(() => buildCbbStandings(games, [...teams.values()]), [games, teams]);
  const top25 = useMemo(
    () =>
      Object.entries(rankings)
        .sort((a, b) => a[1] - b[1])
        .map(([id, rank]) => ({ rank, team: teams.get(id), row: standings.get(id) }))
        .filter((x): x is { rank: number; team: NonNullable<typeof x.team>; row: typeof x.row } => Boolean(x.team)),
    [rankings, teams, standings],
  );

  const winChange = hasPrev ? pctChange(winPct(grade.moneyline), winPct(prev.moneyline)) : null;
  const totalChange = hasPrev ? pctChange(winPct(grade.total), winPct(prev.total)) : null;
  const coverChange = hasPrev ? pctChange(winPct(grade.spread), winPct(prev.spread)) : null;
  const every = grade.moneyline.units + grade.spread.units + grade.total.units;
  const loading = isLoading ? "Loading…" : undefined;
  const through = finals[0]
    ? new Date(finals[0].date).toLocaleDateString([], { month: "short", day: "numeric" })
    : null;

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={games.length ? `Home dashboard · ${season || "2026-27"} live schedule` : "Home dashboard"}
          title="Season Pulse"
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(winPct(grade.moneyline))}
            unit={winPct(grade.moneyline) === null ? undefined : "%"}
            note={loading ?? note(weekChangeText(winChange), grade.games ? `${rec(grade.moneyline)} picking winners` : "No games graded yet")}
            tone={changeTone(winChange)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(winPct(grade.total))}
            unit={winPct(grade.total) === null ? undefined : "%"}
            note={
              loading ??
              note(
                weekChangeText(totalChange),
                grade.games ? `${rec(grade.total)} O/U` : "No games graded yet",
                grade.avgPoints !== null &&
                  grade.avgLine !== null &&
                  `games avg ${grade.avgPoints.toFixed(1)} vs line ${grade.avgLine.toFixed(1)}`,
              )
            }
            tone={changeTone(totalChange)}
          />
          <StatCard
            label="Cover % · model"
            value={fmt(winPct(grade.spread))}
            unit={winPct(grade.spread) === null ? undefined : "%"}
            note={loading ?? note(weekChangeText(coverChange), grade.games ? `${rec(grade.spread)} ATS` : "No games graded yet")}
            tone={changeTone(coverChange)}
          />
          <StatCard
            label="Model edge · ★ best bets"
            value={unitsText(0)}
            note={loading ?? note("No best bets yet", grade.games ? `every game ${unitsText(every)}` : undefined)}
            tone="mute"
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {through ? `Through ${through} · ` : ""}flat 1u per pick at closing ESPN odds ·{" "}
          <Link to="/cbb/model" className="text-acc">
            Model picks →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          <CbbLiveGames games={live} />
          <CbbUpcomingGames games={games} />
          <CbbRecentGames
            games={finals.slice(0, 5)}
            emptyText={
              isLoading
                ? "Loading games from ESPN…"
                : isError
                  ? "Could not load games from ESPN. Try refreshing shortly."
                  : "No completed games yet."
            }
          />
        </section>

        <aside className="min-w-0 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">AP Poll</h2>
            <p className="label-mono mb-3">This week · tap to open</p>
            {top25.length ? (
              <div className="grid grid-cols-5 gap-2">
                {top25.map(({ rank, team, row }) => (
                  <Link
                    key={team.id}
                    to="/cbb/teams/$teamId"
                    params={{ teamId: team.id }}
                    title={`#${rank} ${team.short}${row ? ` (${recordText(row.overall)})` : ""}`}
                    className="glass relative grid aspect-square place-items-center rounded-xl hover:glow"
                    style={{ boxShadow: `inset 0 0 0 1px ${team.color}44` }}
                  >
                    <span className="absolute left-1 top-0.5 font-mono text-[9px] font-bold text-acc">{rank}</span>
                    <CbbLogo team={team} className="size-8" />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center font-mono text-xs text-mute">{isLoading ? "Loading rankings…" : "Rankings unavailable."}</p>
            )}
            <Link to="/cbb/teams" className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc">
              + all D-I teams
            </Link>
          </Panel>
        </aside>
      </div>
    </>
  );
}
