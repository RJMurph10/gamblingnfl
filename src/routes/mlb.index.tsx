import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import { MlbLogo } from "@/components/mlb/MlbBits";
import { MlbGamesTable } from "@/components/mlb/MlbGamesTable";
import { buildMlbStandings, etDayKey, hasScore, isWrigleyBestBet, localTip } from "@/lib/mlb/mlb";
import { mlbAccuracy } from "@/lib/mlb/mlb-model";
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

const note = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(" · ");

function MlbDashboard() {
  const { games, isLoading, isError, error, linesLoading } = useMlbSchedule(60_000);
  const accuracy = useMemo(() => mlbAccuracy(games), [games]);

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
            label="★ Best bets · tested"
            value="59.2"
            unit="%"
            note="Wrigley wind-out overs · 74-51 over 2010–25 · +16.0u at the close"
            tone="win"
          />
          <StatCard
            label="★ Best bets · now"
            value={String(bestBets.size)}
            note={
              bestBets.size
                ? `live this week · see the ★ games below`
                : seasonOver
                  ? "offseason · forecasts start a week before Cubs home games"
                  : "none this week · only Wrigley with wind blowing out 10+ mph"
            }
            tone={bestBets.size ? "win" : "mute"}
          />
          <StatCard
            label="Picked winners · model"
            value={accuracy.pickedWinner === null ? "—" : (accuracy.pickedWinner * 100).toFixed(1)}
            unit={accuracy.pickedWinner === null ? undefined : "%"}
            note={
              loading ??
              note(
                accuracy.favoriteWon !== null &&
                  `betting favorite ${(accuracy.favoriteWon * 100).toFixed(1)}%`,
                accuracy.agreesWithMarket !== null &&
                  `same pick as the line in ${Math.round(accuracy.agreesWithMarket * 100)}% of games`,
              )
            }
            tone="mute"
          />
          <StatCard
            label="Projected totals"
            value={accuracy.totalMiss ? accuracy.totalMiss.model.toFixed(2) : "—"}
            unit={accuracy.totalMiss ? "runs" : undefined}
            note={
              loading ??
              (accuracy.totalMiss
                ? `average miss · closing line ${accuracy.totalMiss.line.toFixed(2)}`
                : undefined)
            }
            tone="mute"
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {accuracy.games} games projected from earlier games only · ★ only for angles that won in
          both 2012–18 and 2019–25 ·{" "}
          <Link to="/mlb/model" className="text-acc">
            Every-pick results and research →
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
