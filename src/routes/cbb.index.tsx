import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, StatCard } from "@/components/shared/booth";
import { CbbLogo } from "@/components/cbb/CbbBits";
import { CbbLiveGames, CbbRecentGames, CbbUpcomingGames } from "@/components/cbb/CbbDashTables";
import { buildCbbStandings, hasScore, recordText } from "@/lib/cbb/cbb";
import { BEST_TOTAL_EDGE, gradeCbbSeason, unitsText, winPct, type CbbRecord } from "@/lib/cbb/cbb-model";
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
  const model = useMemo(() => new Map(rows.map((r) => [r.game.id, r])), [rows]);
  // upcoming and live ★ best bets, soonest first
  const bets = useMemo(
    () =>
      rows
        .filter((r) => r.best && (r.game.status === "scheduled" || r.game.status === "live") && !r.game.nonDivisionI)
        .sort((a, b) => a.game.date.localeCompare(b.game.date))
        .slice(0, 12),
    [rows],
  );
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 3_600_000), []);
  const grade = useMemo(() => gradeCbbSeason(rows), [rows]);
  const prev = useMemo(() => gradeCbbSeason(rows, weekAgo), [rows, weekAgo]);
  const hasPrev = prev.games > 0 && prev.games !== grade.games;

  // games against non-Division I schools stay off the dashboard (they're on the Games page)
  const d1Games = useMemo(() => games.filter((g) => !g.nonDivisionI), [games]);
  const nonD1 = games.filter((g) => g.nonDivisionI && g.status === "final").length;
  const live = useMemo(() => d1Games.filter((g) => g.status === "live"), [d1Games]);
  const finals = useMemo(
    () =>
      d1Games
        .filter((g) => g.status === "final" && hasScore(g))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [d1Games],
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
  const bestStakes = grade.best.wins + grade.best.losses + grade.best.pushes;
  const bestRoi = bestStakes ? (grade.best.units / bestStakes) * 100 : null;
  const bestChange = hasPrev ? Math.round((grade.best.units - prev.best.units) * 100) / 100 : null;
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
            value={unitsText(grade.best.units)}
            note={
              loading ??
              note(
                hasPrev && bestChange !== null
                  ? `${bestChange > 0 ? "▲" : bestChange < 0 ? "▼" : "—"} ${Math.abs(bestChange).toFixed(2)}u wk/wk`
                  : undefined,
                grade.best.wins + grade.best.losses
                  ? `${rec(grade.best)} · ROI ${bestRoi! > 0 ? "+" : ""}${bestRoi!.toFixed(1)}% at the opener`
                  : "No best bets graded yet",
                grade.games ? `every game ${unitsText(every)}` : undefined,
              )
            }
            tone={grade.best.units > 0 ? "win" : grade.best.units < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {through ? `Through ${through} · ` : ""}flat 1u per pick at closing ESPN odds, ★ totals at the opener ·{" "}
          {nonD1 ? (
            <>
              <Link to="/cbb/games" className="text-acc">
                {nonD1} games vs non-D-I schools
              </Link>{" "}
              not shown or graded ·{" "}
            </>
          ) : null}
          <Link to="/cbb/model" className="text-acc">
            Model picks →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          <CbbLiveGames games={live} model={model} />
          <CbbUpcomingGames games={d1Games} model={model} />
          <CbbRecentGames
            model={model}
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

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              <span className="text-acc">★</span> Best bets
            </h2>
            <p className="mt-2 text-sm text-mute">
              <span className="font-semibold text-foreground">
                Totals where the model is {BEST_TOTAL_EDGE}+ points off the opening total.
              </span>{" "}
              55.8%, 55.7% and 53.0% in the last three seasons (break-even 52.4%). Bet them early: at the closing
              total the same picks only hit 50–52%.
            </p>
            <div className="mt-3 divide-y divide-line/5 rounded-lg border border-line/10">
              {bets.length ? (
                bets.map((r) => (
                  <Link
                    key={r.game.id}
                    to="/cbb/games/$gameId"
                    params={{ gameId: r.game.id }}
                    className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] hover:bg-line/5"
                  >
                    <span className="text-acc">★</span>
                    <span className="min-w-0 flex-1 truncate" suppressHydrationWarning>
                      {r.game.away.team.abbr} @ {r.game.home.team.abbr} ·{" "}
                      {r.game.status === "live"
                        ? "live"
                        : new Date(r.game.date).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="font-semibold text-foreground">
                      {r.best!.pick === "over" ? "Over" : "Under"} {r.best!.line}
                    </span>
                    <span className="w-12 text-right text-mute">{r.pred.total.toFixed(1)}</span>
                  </Link>
                ))
              ) : (
                <p className="px-3 py-3 font-mono text-[11px] text-mute">
                  {isLoading ? "Loading…" : "No best bets on the board right now. They show up once a game's opening total is posted."}
                </p>
              )}
            </div>
            <p className="mt-2 font-mono text-[10px] text-faint">
              Line shown is the opening total; the right column is the model's total. If the line has already moved
              toward the model, most of the edge is gone.
            </p>
            <Link to="/cbb/model" className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-acc">
              Full research →
            </Link>
          </Panel>
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
