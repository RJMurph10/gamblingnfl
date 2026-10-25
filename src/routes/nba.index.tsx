import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/booth";
import { NbaLogo } from "@/components/nba/NbaBits";
import { NbaLivePanel, NbaRecentGames, NbaUpcomingGames } from "@/components/nba/NbaTables";
import { hasScore, isRatedGame } from "@/lib/nba";
import { summarizeNba, unitsText } from "@/lib/nba-model";
import { useNbaModelRows, useNbaSchedule, useNbaStandings } from "@/lib/use-nba";

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

  const live = useMemo(() => games.filter((g) => g.status === "live"), [games]);
  const recent = useMemo(
    () =>
      games
        .filter((g) => g.status === "final" && isRatedGame(g) && hasScore(g))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5),
    [games],
  );

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
            emptyText={isLoading ? "Loading games from ESPN…" : isError ? "Could not load games from ESPN. Try refreshing shortly." : "No completed games yet."}
          />
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
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
          <Link to="/nba/teams" className="block text-center font-mono text-[10px] uppercase tracking-wider text-acc">
            + all 30 teams
          </Link>
        </aside>
      </div>
    </>
  );
}
