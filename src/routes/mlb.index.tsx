import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import { MlbLogo } from "@/components/mlb/MlbBits";
import {
  americanText,
  etDayKey,
  hasScore,
  inningText,
  type MlbGame,
  type MlbTeamRef,
} from "@/lib/mlb/mlb";
import { gradeMlbSeason, winPct, type MlbRecord } from "@/lib/mlb/mlb-model";
import { useMlbSchedule } from "@/lib/mlb/use-mlb";

export const Route = createFileRoute("/mlb/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingMLB dashboard" },
      {
        name: "description",
        content:
          "MLB dashboard: how the model's picks did against the closing lines, live and upcoming games, recent results and standings.",
      },
    ],
  }),
  component: MlbDashboard,
});

const rec = (r: MlbRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const units = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(2)}u`;
const note = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(" · ");
const change = (now: number | null, before: number | null) =>
  now !== null && before !== null ? Math.round((now - before) * 10) / 10 : null;
const changeText = (c: number | null) =>
  c === null ? undefined : `${c > 0 ? "▲" : c < 0 ? "▼" : "—"} ${Math.abs(c).toFixed(1)} wk/wk`;
const tone = (c: number | null): "win" | "loss" | "mute" =>
  c === null || c === 0 ? "mute" : c > 0 ? "win" : "loss";

function MlbDashboard() {
  const { games, isLoading, isError, error } = useMlbSchedule(60_000);
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 3_600_000), []);
  const grade = useMemo(() => gradeMlbSeason(games), [games]);
  const prev = useMemo(() => gradeMlbSeason(games, weekAgo), [games, weekAgo]);
  const hasPrev = prev.games > 0 && prev.games !== grade.games;

  const live = useMemo(() => games.filter((g) => g.status === "live"), [games]);
  const upcoming = useMemo(() => {
    const next = games
      .filter((g) => g.status === "scheduled")
      .sort((a, b) => a.date.localeCompare(b.date));
    const day = next[0] ? etDayKey(next[0].date) : null;
    return day ? next.filter((g) => etDayKey(g.date) === day) : [];
  }, [games]);
  const recent = useMemo(
    () =>
      games
        .filter((g) => g.status === "final" && hasScore(g))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
        .slice(0, 8),
    [games],
  );
  const standings = useMemo(() => {
    const t = new Map<string, { team: MlbTeamRef; w: number; l: number }>();
    for (const g of games) {
      if (g.status !== "final" || !hasScore(g) || g.part !== "reg") continue;
      for (const [s, won] of [
        [g.away, (g.away.score as number) > (g.home.score as number)],
        [g.home, (g.home.score as number) > (g.away.score as number)],
      ] as const) {
        const x = t.get(s.team.id) ?? { team: s.team, w: 0, l: 0 };
        if (won) x.w += 1;
        else x.l += 1;
        t.set(s.team.id, x);
      }
    }
    return [...t.values()].sort(
      (a, b) => b.w / Math.max(1, b.w + b.l) - a.w / Math.max(1, a.w + a.l),
    );
  }, [games]);
  const teams = useMemo(
    () => [...standings.map((s) => s.team)].sort((a, b) => a.name.localeCompare(b.name)),
    [standings],
  );

  const loading = isLoading ? "Loading…" : undefined;
  const mlC = hasPrev ? change(winPct(grade.moneyline), winPct(prev.moneyline)) : null;
  const totC = hasPrev ? change(winPct(grade.total), winPct(prev.total)) : null;
  const rlC = hasPrev ? change(winPct(grade.runLine), winPct(prev.runLine)) : null;
  const all = grade.moneyline.units + grade.runLine.units + grade.total.units;
  const allPrev = prev.moneyline.units + prev.runLine.units + prev.total.units;
  const seasonOver = !live.length && !upcoming.length && recent.length > 0;

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={games.length ? "Home dashboard · live MLB schedule" : "Home dashboard"}
          title="Season Pulse"
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(winPct(grade.moneyline))}
            unit={winPct(grade.moneyline) === null ? undefined : "%"}
            note={
              loading ??
              note(
                changeText(mlC),
                `${rec(grade.moneyline)} picking winners`,
                `${units(grade.moneyline.units)} at the close`,
              )
            }
            tone={tone(mlC)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(winPct(grade.total))}
            unit={winPct(grade.total) === null ? undefined : "%"}
            note={
              loading ??
              note(
                changeText(totC),
                `${rec(grade.total)} O/U`,
                grade.avgRuns !== null &&
                  grade.avgLine !== null &&
                  `games avg ${grade.avgRuns.toFixed(1)} vs line ${grade.avgLine.toFixed(1)}`,
              )
            }
            tone={tone(totC)}
          />
          <StatCard
            label="Run line · model"
            value={fmt(winPct(grade.runLine))}
            unit={winPct(grade.runLine) === null ? undefined : "%"}
            note={loading ?? note(changeText(rlC), `${rec(grade.runLine)} on the run line`)}
            tone={tone(rlC)}
          />
          <StatCard
            label="Model · every pick"
            value={units(all)}
            note={
              loading ??
              note(
                hasPrev &&
                  `${all - allPrev > 0 ? "▲" : all - allPrev < 0 ? "▼" : "—"} ${Math.abs(all - allPrev).toFixed(2)}u wk/wk`,
                "no ★ best bets for baseball",
              )
            }
            tone={all > 0 ? "win" : all < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {grade.games} games graded · flat 1u per pick at the closing ESPN odds · each game
          projected from earlier games only ·{" "}
          <Link to="/mlb/model" className="text-acc">
            What the research found →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          {live.length ? <GamesTable title="Live now" games={live} live /> : null}
          {upcoming.length ? (
            <GamesTable
              title="Upcoming games"
              aside={`${new Date(upcoming[0].date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${upcoming.length} games`}
              games={upcoming}
            />
          ) : (
            <Panel>
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Upcoming games
              </h2>
              <p className="mt-3 font-mono text-xs text-mute">
                {isLoading
                  ? "Loading the schedule from ESPN…"
                  : isError && !games.length
                    ? `Could not load games from ESPN. Try refreshing shortly.${error instanceof Error && error.message ? ` (${error.message})` : ""}`
                    : seasonOver
                      ? "The season is over. Opening Day is in late March."
                      : "No games scheduled in the next two weeks."}
              </p>
            </Panel>
          )}
          <GamesTable
            title="Recent games"
            games={recent}
            link
            emptyText={
              isLoading ? "Loading games from ESPN…" : "No finished MLB games available from ESPN."
            }
          />
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Team grid</h2>
            <p className="label-mono mb-3">{teams.length || 30} clubs</p>
            <div className="grid grid-cols-5 gap-2">
              {teams.slice(0, 15).map((team) => (
                <div
                  key={team.id}
                  className="glass grid aspect-square place-items-center rounded-xl"
                  style={{ boxShadow: `inset 0 0 0 1px ${team.color}44` }}
                  title={team.name}
                >
                  <MlbLogo team={team} className="size-8" />
                </div>
              ))}
            </div>
          </Panel>
          <Panel padded={false}>
            <PanelHeader title="Best records" aside={<span className="label-mono">W-L</span>} />
            {standings.length ? (
              <div className="divide-y divide-line/5">
                {standings.slice(0, 10).map((r, i) => (
                  <div key={r.team.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-4 font-mono text-[10px] text-faint">{i + 1}</span>
                    <MlbLogo team={r.team} className="size-5" />
                    <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
                    <span className="font-mono text-xs tabular-nums text-mute">
                      {r.w}-{r.l}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                {isLoading ? "Loading…" : "Standings unavailable."}
              </p>
            )}
          </Panel>
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Watch list</h2>
            <p className="mt-2 text-sm text-mute">
              <span className="font-semibold text-foreground">
                Wrigley Field, wind blowing out 10+ mph → over.
              </span>{" "}
              59.2% over in 125 games, profitable in both 2012–18 and 2019–25. About 9 games a
              season; check the wind before Cubs home games.
            </p>
            <Link
              to="/mlb/model"
              className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-acc"
            >
              Full research →
            </Link>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function GamesTable({
  title,
  aside,
  games,
  live = false,
  link = false,
  emptyText,
}: {
  title: string;
  aside?: string;
  games: MlbGame[];
  live?: boolean;
  link?: boolean;
  emptyText?: string;
}) {
  return (
    <Panel padded={false}>
      <PanelHeader
        title={title}
        aside={
          link ? (
            <Link to="/mlb/games" className="font-mono text-[11px] text-acc">
              View all →
            </Link>
          ) : aside ? (
            <span className="label-mono">{aside}</span>
          ) : undefined
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">{live ? "Inning" : "Date"}</th>
              <th className="px-2 py-2 font-normal">{live ? "" : "Time"}</th>
              <th className="px-2 py-2 font-normal">Matchup</th>
              <th className="px-2 py-2 font-normal">Starters</th>
              <th className="px-2 py-2 font-normal">Moneyline</th>
              <th className="px-4 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {games.length ? (
              games.map((g) => <Row key={g.id} game={g} live={live} />)
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center font-mono text-xs text-mute">
                  {emptyText ?? "No games."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Row({ game, live }: { game: MlbGame; live: boolean }) {
  const started = game.status === "live" || game.status === "final";
  const d = new Date(game.date);
  const fav =
    game.odds?.mlHome != null && game.odds?.mlAway != null
      ? game.odds.mlHome < game.odds.mlAway
        ? "home"
        : "away"
      : null;
  const winner =
    game.status === "final" && hasScore(game)
      ? (game.home.score as number) > (game.away.score as number)
        ? "home"
        : "away"
      : null;
  const t = game.odds?.total;
  const tot =
    started && hasScore(game) ? (game.away.score as number) + (game.home.score as number) : null;
  return (
    <tr className="hover:bg-line/5">
      <td
        className={`px-4 py-2.5 font-mono text-xs ${live ? "text-win" : "text-mute"}`}
        suppressHydrationWarning
      >
        {live ? inningText(game) : d.toLocaleDateString([], { month: "numeric", day: "numeric" })}
      </td>
      <td className="px-2 py-2.5 font-mono text-xs text-mute" suppressHydrationWarning>
        {live ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </td>
      <td className="px-2 py-2.5">
        <Link
          to="/mlb/games/$gameId"
          params={{ gameId: game.id }}
          className="flex items-center gap-2 hover:text-acc"
        >
          {started ? (
            <span
              className={`w-5 text-right font-mono tabular-nums ${winner === "away" ? "text-acc" : ""}`}
            >
              {game.away.score}
            </span>
          ) : null}
          <MlbLogo team={game.away.team} className="size-6" />
          <span className="text-faint">@</span>
          <MlbLogo team={game.home.team} className="size-6" />
          {started ? (
            <span className={`w-5 font-mono tabular-nums ${winner === "home" ? "text-acc" : ""}`}>
              {game.home.score}
            </span>
          ) : null}
        </Link>
      </td>
      <td className="max-w-[220px] truncate px-2 py-2.5 font-mono text-[11px] text-mute">
        {game.away.probable?.name ?? "TBD"} / {game.home.probable?.name ?? "TBD"}
      </td>
      <td className="px-2 py-2.5">
        {fav ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs">
            <MlbLogo team={game[fav].team} className="size-4" />
            {americanText(fav === "home" ? game.odds?.mlHome : game.odds?.mlAway)}
          </span>
        ) : (
          <span className="font-mono text-xs text-mute">—</span>
        )}
      </td>
      <td
        className={`px-4 py-2.5 text-right font-mono text-xs ${
          game.status === "final" && t != null && tot !== null
            ? tot > t
              ? "text-win"
              : tot < t
                ? "text-loss"
                : "text-mute"
            : ""
        }`}
      >
        {t ?? "—"}
      </td>
    </tr>
  );
}
