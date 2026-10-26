import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/booth";
import { NbaLogo } from "@/components/nba/NbaBits";
import { NbaLivePanel, NbaRecentGames, NbaUpcomingGames } from "@/components/nba/NbaTables";
import { hasScore, isRatedGame } from "@/lib/nba";
import { summarizeNba, unitsText } from "@/lib/nba-model";
import { useNbaModelRows, useNbaPlayerIndex, useNbaSchedule, useNbaStandings, useNbaTeams } from "@/lib/use-nba";

export const Route = createFileRoute("/nba/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingNBA dashboard" },
      {
        name: "description",
        content:
          "NBA dashboard: how the model's picks are doing against the closing lines, live and upcoming games, recent results and the standings.",
      },
    ],
  }),
  component: NbaDashboard,
});

const rec = (r: { wins: number; losses: number; pushes: number }) =>
  `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const note = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" · ");
const change = (now: number | null, before: number | null | undefined) =>
  now !== null && before !== null && before !== undefined ? Math.round((now - before) * 10) / 10 : null;
const changeText = (c: number | null) => (c === null ? undefined : `${c > 0 ? "▲" : c < 0 ? "▼" : "—"} ${Math.abs(c).toFixed(1)} pts wk/wk`);
const tone = (c: number | null): "win" | "loss" | "mute" => (c === null || c === 0 ? "mute" : c > 0 ? "win" : "loss");

function NbaDashboard() {
  const { games, isLoading, isError } = useNbaSchedule(60_000);
  const standings = useNbaStandings();
  const rows = useNbaModelRows(games);
  const { teams } = useNbaTeams();
  const playerIndex = useNbaPlayerIndex();

  const live = useMemo(() => games.filter((g) => g.status === "live"), [games]);
  // Display only needs a finished game with a real score: odds and model grades never hide a game here.
  const recent = useMemo(() => {
    const tipoff = (g: (typeof games)[number]) => {
      const t = new Date(g.date).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return games
      .filter((g) => g.status === "final" && hasScore(g))
      .sort((a, b) => tipoff(b) - tipoff(a) || b.id.localeCompare(a.id))
      .slice(0, 5);
  }, [games]);

  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 3_600_000), []);
  const all = useMemo(() => summarizeNba(rows, "predictions"), [rows]);
  const allPrev = useMemo(() => summarizeNba(rows, "predictions", weekAgo), [rows, weekAgo]);
  const bets = useMemo(() => summarizeNba(rows, "bets"), [rows]);
  const betsPrev = useMemo(() => summarizeNba(rows, "bets", weekAgo), [rows, weekAgo]);
  const hasPrev = allPrev.moneyline.wins + allPrev.moneyline.losses > 0;

  const played = games.filter((g) => g.status === "final" && isRatedGame(g) && hasScore(g));
  const avgTotal = played.length
    ? played.reduce((s, g) => s + (g.away.score as number) + (g.home.score as number), 0) / played.length
    : null;
  const lined = played.filter((g) => g.odds?.total);
  const avgLine = lined.length ? lined.reduce((s, g) => s + (g.odds?.total as number), 0) / lined.length : null;

  const mlChange = hasPrev ? change(all.moneyline.winPct, allPrev.moneyline.winPct) : null;
  const spreadChange = hasPrev ? change(all.spread.winPct, allPrev.spread.winPct) : null;
  const totalChange = hasPrev ? change(all.total.winPct, allPrev.total.winPct) : null;
  const unitsChange = hasPrev ? Math.round((bets.overall.units - betsPrev.overall.units) * 100) / 100 : null;
  const loading = isLoading ? "Loading…" : undefined;

  // Player leaders: points per game, ignoring players with only a handful of games.
  const players = playerIndex.data?.players ?? [];
  const statsSeason = playerIndex.data?.statsSeason;
  const maxGp = players.reduce((m, p) => Math.max(m, p.avg?.gp ?? 0), 0);
  const leaders = players
    .filter((p) => p.avg && p.avg.gp >= Math.max(1, Math.floor(maxGp * 0.5)))
    .sort((a, b) => (b.avg?.pts ?? 0) - (a.avg?.pts ?? 0))
    .slice(0, 5);

  const east = standings.rows.filter((r) => r.conference === "East").slice(0, 8);
  const west = standings.rows.filter((r) => r.conference === "West").slice(0, 8);

  return (
    <>
      <section className="mb-6">
        <PageTitle eyebrow={games.length ? "Home dashboard · live NBA schedule" : "Home dashboard"} title="Season Pulse" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(all.moneyline.winPct)}
            unit={all.moneyline.winPct === null ? undefined : "%"}
            note={loading ?? note(changeText(mlChange), `${rec(all.moneyline)} picking winners`)}
            tone={tone(mlChange)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(all.total.winPct)}
            unit={all.total.winPct === null ? undefined : "%"}
            note={
              loading ??
              note(
                changeText(totalChange),
                `${rec(all.total)} O/U`,
                avgTotal !== null && avgLine !== null && `games avg ${avgTotal.toFixed(1)} vs line ${avgLine.toFixed(1)}`,
              )
            }
            tone={tone(totalChange)}
          />
          <StatCard
            label="Cover % · model"
            value={fmt(all.spread.winPct)}
            unit={all.spread.winPct === null ? undefined : "%"}
            note={loading ?? note(changeText(spreadChange), `${rec(all.spread)} ATS`)}
            tone={tone(spreadChange)}
          />
          <StatCard
            label="Model edge · ★ best bets"
            value={unitsText(bets.overall.units)}
            note={
              loading ??
              note(
                unitsChange !== null && `${unitsChange > 0 ? "▲" : unitsChange < 0 ? "▼" : "—"} ${Math.abs(unitsChange).toFixed(2)}u wk/wk`,
                bets.overall.roi === null
                  ? "No best bets graded yet"
                  : `${rec(bets.overall)} · ROI ${bets.overall.roi > 0 ? "+" : ""}${bets.overall.roi.toFixed(1)}%`,
                `every pick ${unitsText(all.overall.units)}`,
              )
            }
            tone={bets.overall.units > 0 ? "win" : bets.overall.units < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {played.length} games graded · flat 1u per pick at -110 · picks made before tip-off from earlier games only ·{" "}
          <Link to="/nba/model" className="text-acc">
            Model picks →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          <NbaLivePanel games={live} />
          <NbaUpcomingGames games={games} />
          <NbaRecentGames
            games={recent}
            emptyText={isLoading ? "Loading games from ESPN…" : isError ? "Could not load games from ESPN. Try refreshing shortly." : "No completed NBA games are currently available from ESPN."}
          />
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Team grid</h2>
            <p className="label-mono mb-3">30 clubs · tap to open</p>
            <div className="grid grid-cols-4 gap-2">
              {teams.slice(0, 12).map((team) => (
                <Link
                  key={team.id}
                  to="/nba/teams/$teamId"
                  params={{ teamId: team.id }}
                  className="glass grid aspect-square place-items-center rounded-xl hover:glow"
                  style={{ boxShadow: `inset 0 0 0 1px ${team.color}44` }}
                  title={team.name}
                >
                  <NbaLogo team={team} className="size-9" />
                </Link>
              ))}
            </div>
            <Link to="/nba/teams" className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc">
              + all 30 teams
            </Link>
          </Panel>
          {[
            { label: "Eastern Conference", list: east },
            { label: "Western Conference", list: west },
          ].map(({ label, list }) => (
            <Panel key={label} padded={false}>
              <PanelHeader title={label} aside={<span className="label-mono">W-L</span>} />
              {list.length ? (
                <div className="divide-y divide-line/5">
                  {list.map((r, i) => (
                    <Link
                      key={r.teamId}
                      to="/nba/teams/$teamId"
                      params={{ teamId: r.teamId }}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-line/5"
                    >
                      <span className="w-4 font-mono text-[10px] text-faint">{r.seed ?? i + 1}</span>
                      <NbaLogo team={r.team} className="size-5" />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
                      <span className="font-mono text-xs tabular-nums text-mute">
                        {r.wins}-{r.losses}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                  {standings.isLoading ? "Loading standings…" : "Standings unavailable."}
                </p>
              )}
            </Panel>
          ))}
        </aside>
      </div>

      <section className="mt-6">
        <Panel padded={false}>
          <PanelHeader
            title="Player leaders"
            aside={
              <span className="flex items-center gap-3">
                {statsSeason ? (
                  <span className="label-mono">
                    Per game · {statsSeason - 1}-{String(statsSeason).slice(2)}
                  </span>
                ) : null}
                <Link to="/nba/players" className="font-mono text-[11px] text-acc">
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
                  <th className="px-2 py-2 text-right font-normal">Pts</th>
                  <th className="px-2 py-2 text-right font-normal">Reb</th>
                  <th className="px-2 py-2 text-right font-normal">Ast</th>
                  <th className="px-4 py-2 font-normal">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {leaders.length ? (
                  leaders.map((p) => (
                    <tr key={p.id} className="hover:bg-line/5">
                      <td className="px-4 py-2.5">
                        <Link to="/nba/players/$playerId" params={{ playerId: p.id }} className="font-medium hover:text-acc">
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2.5 font-mono text-mute">{p.position || "—"}</td>
                      <td className="px-2 py-2.5 font-mono text-mute">{p.teamAbbr || "—"}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">{p.avg?.pts.toFixed(1)}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">{p.avg?.reb.toFixed(1)}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">{p.avg?.ast.toFixed(1)}</td>
                      <td className="px-4 py-2.5">
                        <div className="h-1.5 w-24 rounded-full bg-panel2">
                          <div
                            className="h-1.5 rounded-full bg-acc"
                            style={{ width: `${Math.round(((p.avg?.pts ?? 0) / (leaders[0]?.avg?.pts || 1)) * 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center font-mono text-xs text-mute">
                      {playerIndex.isLoading ? "Loading players…" : "Player stats unavailable."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="mt-6">
        <Panel className="flex flex-wrap items-center gap-3">
          {teams[0] ? <NbaLogo team={teams[0]} className="size-6" /> : null}
          <p className="text-sm text-mute">
            Player props for every NBA game, projected from recent game logs and compared with posted lines.
          </p>
          <Link
            to="/nba/props"
            className="ml-auto rounded-lg bg-acc/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-acc/25"
          >
            Prop model
          </Link>
        </Panel>
      </section>
    </>
  );
}
