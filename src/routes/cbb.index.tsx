import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import { CbbLogo } from "@/components/cbb/CbbBits";
import { CbbGamesTable } from "@/components/cbb/CbbGamesTable";
import { buildCbbStandings, etDayKey, hasScore, recordText } from "@/lib/cbb/cbb";
import { gradeCbbSeason, winPct, type CbbRecord } from "@/lib/cbb/cbb-model";
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
const units = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;
const note = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(" · ");
const change = (now: number | null, before: number | null) =>
  now !== null && before !== null ? Math.round((now - before) * 10) / 10 : null;
const changeText = (c: number | null) =>
  c === null ? undefined : `${c > 0 ? "▲" : c < 0 ? "▼" : "—"} ${Math.abs(c).toFixed(1)} wk/wk`;
const tone = (c: number | null): "win" | "loss" | "mute" =>
  c === null || c === 0 ? "mute" : c > 0 ? "win" : "loss";

const UPCOMING_SHOWN = 25;

function CbbDashboard() {
  const { games, teams, rankings, isLoading, isError, error } = useCbbSchedule(60_000);
  const rows = useCbbModel(games);
  const model = useMemo(() => new Map(rows.map((r) => [r.game.id, r])), [rows]);
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 3_600_000), []);
  const grade = useMemo(() => gradeCbbSeason(rows), [rows]);
  const prev = useMemo(() => gradeCbbSeason(rows, weekAgo), [rows, weekAgo]);
  const hasPrev = prev.games > 0 && prev.games !== grade.games;

  const live = useMemo(() => games.filter((g) => g.status === "live"), [games]);
  const upcoming = useMemo(() => {
    const next = games.filter((g) => g.status === "scheduled").sort((a, b) => a.date.localeCompare(b.date));
    const day = next[0] ? etDayKey(next[0].date) : null;
    const list = day ? next.filter((g) => etDayKey(g.date) === day) : [];
    // ranked teams and games with lines first, then the rest by tip-off
    const weight = (g: (typeof list)[number]) => (g.home.rank || g.away.rank ? 0 : g.odds?.spread != null ? 1 : 2);
    return list.sort((a, b) => weight(a) - weight(b) || a.date.localeCompare(b.date));
  }, [games]);
  const recent = useMemo(
    () =>
      games
        .filter((g) => g.status === "final" && hasScore(g))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
        .slice(0, 8),
    [games],
  );
  const standings = useMemo(() => buildCbbStandings(games, [...teams.values()]), [games, teams]);
  const top25 = useMemo(
    () =>
      Object.entries(rankings)
        .sort((a, b) => a[1] - b[1])
        .map(([id, rank]) => ({ rank, team: teams.get(id), row: standings.get(id) }))
        .filter((x) => x.team),
    [rankings, teams, standings],
  );

  const loading = isLoading ? "Loading…" : undefined;
  const mlC = hasPrev ? change(winPct(grade.moneyline), winPct(prev.moneyline)) : null;
  const totC = hasPrev ? change(winPct(grade.total), winPct(prev.total)) : null;
  const spC = hasPrev ? change(winPct(grade.spread), winPct(prev.spread)) : null;
  const all = grade.moneyline.units + grade.spread.units + grade.total.units;
  const allPrev = prev.moneyline.units + prev.spread.units + prev.total.units;
  const none = !grade.games;

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={games.length ? "Home dashboard · live men's college basketball schedule" : "Home dashboard"}
          title="Season Pulse"
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(winPct(grade.moneyline))}
            unit={winPct(grade.moneyline) === null ? undefined : "%"}
            note={
              loading ??
              (none
                ? "no finished games yet"
                : note(changeText(mlC), `${rec(grade.moneyline)} picking winners`, `${units(grade.moneyline.units)} at the close`))
            }
            tone={tone(mlC)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(winPct(grade.total))}
            unit={winPct(grade.total) === null ? undefined : "%"}
            note={
              loading ??
              (none
                ? "no finished games yet"
                : note(
                    changeText(totC),
                    `${rec(grade.total)} O/U · ${units(grade.total.units)}`,
                    grade.avgPoints !== null &&
                      grade.avgLine !== null &&
                      `games avg ${grade.avgPoints.toFixed(1)} vs line ${grade.avgLine.toFixed(1)}`,
                  ))
            }
            tone={tone(totC)}
          />
          <StatCard
            label="Spread · model"
            value={fmt(winPct(grade.spread))}
            unit={winPct(grade.spread) === null ? undefined : "%"}
            note={
              loading ??
              (none ? "no finished games yet" : note(changeText(spC), `${rec(grade.spread)} ATS · ${units(grade.spread.units)}`))
            }
            tone={tone(spC)}
          />
          <StatCard
            label="Model · every pick"
            value={units(all)}
            note={
              loading ??
              note(
                hasPrev && `${all - allPrev > 0 ? "▲" : all - allPrev < 0 ? "▼" : "—"} ${Math.abs(all - allPrev).toFixed(2)}u wk/wk`,
                "★ best bets: none yet",
              )
            }
            tone={all > 0 ? "win" : all < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {grade.games} games graded · flat 1u per pick at the closing ESPN odds · each game projected from earlier games
          only ·{" "}
          <Link to="/cbb/model" className="text-acc">
            What the research found →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          {live.length ? <CbbGamesTable title="Live now" games={live} model={model} /> : null}
          {upcoming.length ? (
            <CbbGamesTable
              title="Upcoming games"
              aside={`${new Date(upcoming[0].date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${upcoming.length} games`}
              games={upcoming.slice(0, UPCOMING_SHOWN)}
              model={model}
              footer={
                upcoming.length > UPCOMING_SHOWN ? (
                  <Link
                    to="/cbb/games"
                    className="block border-t border-line/10 py-3 text-center font-mono text-[11px] uppercase tracking-wider text-acc"
                  >
                    All {upcoming.length} games →
                  </Link>
                ) : null
              }
            />
          ) : (
            <Panel>
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Upcoming games</h2>
              <p className="mt-3 font-mono text-xs text-mute">
                {isLoading
                  ? "Loading the schedule from ESPN…"
                  : isError && !games.length
                    ? `Could not load games from ESPN. Try refreshing shortly.${error instanceof Error && error.message ? ` (${error.message})` : ""}`
                    : "No games scheduled in the next week."}
              </p>
            </Panel>
          )}
          <CbbGamesTable
            title="Recent games"
            games={recent}
            model={model}
            link
            showDate
            emptyText={isLoading ? "Loading games…" : "No finished games yet this season."}
          />
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel padded={false}>
            <PanelHeader title="AP Top 25" aside={<span className="label-mono">W-L</span>} />
            {top25.length ? (
              <div className="divide-y divide-line/5">
                {top25.map(({ rank, team, row }) => (
                  <Link
                    key={team!.id}
                    to="/cbb/teams/$teamId"
                    params={{ teamId: team!.id }}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-line/5"
                  >
                    <span className="w-5 font-mono text-[10px] text-faint">{rank}</span>
                    <CbbLogo team={team!} className="size-5" />
                    <span className="min-w-0 flex-1 truncate text-sm">{team!.short}</span>
                    <span className="font-mono text-xs tabular-nums text-mute">{row ? recordText(row.overall) : "0-0"}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                {isLoading ? "Loading…" : "Rankings unavailable."}
              </p>
            )}
          </Panel>
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              <span className="text-acc">★</span> Best bets
            </h2>
            <p className="mt-2 text-sm text-mute">
              <span className="font-semibold text-foreground">None yet.</span> Tested on the last three seasons
              (about 17,000 games), the ratings model picked 50–51% against the closing spread and under 50% on
              totals, short of the 52.4% needed to beat the vig. None of 62 simple angles held up in all four
              seasons either.
            </p>
            <p className="mt-2 font-mono text-[10px] text-faint">
              Opening lines are being saved from this season's first game. Once there are a few weeks of them, the
              model gets tested against the opener, where college lines are softest.
            </p>
            <Link to="/cbb/model" className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-acc">
              Full research →
            </Link>
          </Panel>
        </aside>
      </div>
    </>
  );
}
