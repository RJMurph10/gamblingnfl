import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import { MlbLogo } from "@/components/mlb/MlbBits";
import { MlbGamesTable } from "@/components/mlb/MlbGamesTable";
import { buildMlbStandings, etDayKey, hasScore, isWrigleyBestBet, localTip } from "@/lib/mlb/mlb";
import { gradeMlbSeason, winPct, type MlbRecord } from "@/lib/mlb/mlb-model";
import { useMlbSchedule, useWrigleyWind } from "@/lib/mlb/use-mlb";

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
  const { games, isLoading, isError, error, linesLoading } = useMlbSchedule(60_000);
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
  const standings = useMemo(() => buildMlbStandings(games), [games]);
  const wrigley = useWrigleyWind(games);
  const bestBets = useMemo(
    () =>
      new Set(wrigley.games.filter((g) => isWrigleyBestBet(wrigley.wind[g.id])).map((g) => g.id)),
    [wrigley.games, wrigley.wind],
  );
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
                `${rec(grade.total)} O/U · ${units(grade.total.units)}`,
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
            note={
              loading ??
              (grade.runLine.wins + grade.runLine.losses
                ? note(
                    changeText(rlC),
                    `${rec(grade.runLine)} on the run line · ${units(grade.runLine.units)}`,
                  )
                : "graded only with real run-line prices · none from ESPN yet")
            }
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
                bestBets.size
                  ? `${bestBets.size} ★ best bet${bestBets.size > 1 ? "s" : ""} now`
                  : "★ best bets: Wrigley wind-out overs only",
              )
            }
            tone={all > 0 ? "win" : all < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {linesLoading ? (
            <span className="text-acc">Loading closing lines · {linesLoading} games left · </span>
          ) : null}
          {grade.games} games graded · flat 1u per pick at the closing ESPN odds · each game
          projected from earlier games only ·{" "}
          <Link to="/mlb/model" className="text-acc">
            What the research found →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          {live.length ? (
            <MlbGamesTable title="Live now" games={live} live starred={bestBets} />
          ) : null}
          {upcoming.length ? (
            <MlbGamesTable
              title="Upcoming games"
              aside={`${new Date(upcoming[0].date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${upcoming.length} games`}
              games={upcoming}
              starred={bestBets}
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
          <MlbGamesTable
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
              {teams.map((team) => (
                <Link
                  key={team.id}
                  to="/mlb/teams/$teamId"
                  params={{ teamId: team.id }}
                  className="glass grid aspect-square place-items-center rounded-xl transition-transform hover:scale-105"
                  style={{ boxShadow: `inset 0 0 0 1px ${team.color}44` }}
                  title={team.name}
                >
                  <MlbLogo team={team} className="size-8" />
                </Link>
              ))}
            </div>
          </Panel>
          <Panel padded={false}>
            <PanelHeader title="Best records" aside={<span className="label-mono">W-L</span>} />
            {standings.length ? (
              <div className="divide-y divide-line/5">
                {standings.slice(0, 10).map((r, i) => (
                  <Link
                    key={r.team.id}
                    to="/mlb/teams/$teamId"
                    params={{ teamId: r.teamId }}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-line/5"
                  >
                    <span className="w-4 font-mono text-[10px] text-faint">{i + 1}</span>
                    <MlbLogo team={r.team} className="size-5" />
                    <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
                    <span className="font-mono text-xs tabular-nums text-mute">
                      {r.wins}-{r.losses}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                {isLoading ? "Loading…" : "Standings unavailable."}
              </p>
            )}
          </Panel>
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              <span className="text-acc">★</span> Best bets
            </h2>
            <p className="mt-2 text-sm text-mute">
              <span className="font-semibold text-foreground">
                Wrigley Field, wind blowing out 10+ mph → over.
              </span>{" "}
              59.2% over in 125 games, profitable in both 2012–18 and 2019–25. The only MLB angle
              that held up out of 49 tested.
            </p>
            <div className="mt-3 divide-y divide-line/5 rounded-lg border border-line/10">
              {wrigley.games.length ? (
                wrigley.games.map((g) => {
                  const w = wrigley.wind[g.id];
                  const bet = isWrigleyBestBet(w);
                  return (
                    <Link
                      key={g.id}
                      to="/mlb/games/$gameId"
                      params={{ gameId: g.id }}
                      className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] hover:bg-line/5"
                    >
                      <span className={`w-3 ${bet ? "text-acc" : "text-transparent"}`}>★</span>
                      <span className="min-w-0 flex-1 truncate" suppressHydrationWarning>
                        {g.away.team.abbr} @ CHC · {localTip(g.date)}
                      </span>
                      <span className={bet ? "font-semibold text-acc" : "text-mute"}>
                        {w
                          ? `${w.mph != null ? Math.round(w.mph) : "?"} mph ${w.out ? "out" : `from ${w.from ?? "?"}`}`
                          : wrigley.isLoading
                            ? "…"
                            : "no forecast yet"}
                      </span>
                      {bet ? (
                        <span className="font-semibold text-foreground">
                          o{g.odds?.total ?? "—"}
                        </span>
                      ) : null}
                    </Link>
                  );
                })
              ) : (
                <p className="px-3 py-3 font-mono text-[11px] text-mute">
                  No Cubs home games in the next 7 days. Forecasts appear about a week out.
                </p>
              )}
            </div>
            <p className="mt-2 font-mono text-[10px] text-faint">
              Wind is the National Weather Service forecast for first pitch; check it again before
              betting. Everything else the model sees, the market already prices in.
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
