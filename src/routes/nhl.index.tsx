import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/booth";
import { NhlLogo } from "@/components/nhl/NhlBits";
import { NhlLivePanel, NhlRecentGames, NhlUpcomingGames } from "@/components/nhl/NhlTables";
import { buildStandings, hasScore, teamsFromGames } from "@/lib/nhl";
import { summarizeNhl, unitsText } from "@/lib/nhl-model";
import { useNhlSchedule } from "@/lib/use-nhl";

export const Route = createFileRoute("/nhl/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingNHL dashboard" },
      {
        name: "description",
        content:
          "NHL dashboard: how the model is doing against the posted lines, live and upcoming games, recent results and the standings.",
      },
    ],
  }),
  component: NhlDashboard,
});

const rec = (r: { wins: number; losses: number; pushes: number }) =>
  `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const note = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" · ");
const change = (now: number | null, before: number | null | undefined) =>
  now !== null && before !== null && before !== undefined ? Math.round((now - before) * 10) / 10 : null;
const changeText = (c: number | null) =>
  c === null ? undefined : `${c > 0 ? "▲" : c < 0 ? "▼" : "—"} ${Math.abs(c).toFixed(1)} pts wk/wk`;
const tone = (c: number | null): "win" | "loss" | "mute" => (c === null || c === 0 ? "mute" : c > 0 ? "win" : "loss");

function NhlDashboard() {
  const { games, isLoading, isError, error } = useNhlSchedule(60_000);

  const live = useMemo(() => games.filter((g) => g.status === "live"), [games]);
  // Display only needs a finished game with a real score: odds and model grades never hide a game here.
  const recent = useMemo(() => {
    const tipoff = (g: (typeof games)[number]) => {
      const t = new Date(g.date).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return games
      .filter((g) => g.status === "final" && hasScore(g) && g.part !== "pre")
      .sort((a, b) => tipoff(b) - tipoff(a) || b.id.localeCompare(a.id))
      .slice(0, 5);
  }, [games]);

  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 3_600_000), []);
  const all = useMemo(() => summarizeNhl(games), [games]);
  const prev = useMemo(() => summarizeNhl(games, weekAgo), [games, weekAgo]);
  const hasPrev = prev.moneyline.wins + prev.moneyline.losses > 0;

  const played = games.filter((g) => g.part === "reg" && g.status === "final" && hasScore(g));
  const avgTotal = played.length
    ? played.reduce((s, g) => s + (g.away.score as number) + (g.home.score as number), 0) / played.length
    : null;
  const lined = played.filter((g) => g.odds?.total);
  const avgLine = lined.length ? lined.reduce((s, g) => s + (g.odds?.total as number), 0) / lined.length : null;

  const mlChange = hasPrev ? change(all.moneyline.winPct, prev.moneyline.winPct) : null;
  const plChange = hasPrev ? change(all.puckLine.winPct, prev.puckLine.winPct) : null;
  const totChange = hasPrev ? change(all.total.winPct, prev.total.winPct) : null;
  const unitsChange = hasPrev ? Math.round((all.bets.units - prev.bets.units) * 100) / 100 : null;
  const loading = isLoading ? "Loading…" : undefined;

  const standings = useMemo(() => buildStandings(games), [games]);
  const teams = useMemo(() => teamsFromGames(games), [games]);
  const east = standings.filter((r) => r.conference === "East").slice(0, 8);
  const west = standings.filter((r) => r.conference === "West").slice(0, 8);

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={games.length ? "Home dashboard · live NHL schedule" : "Home dashboard"}
          title="Season Pulse"
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(all.moneyline.winPct)}
            unit={all.moneyline.winPct === null ? undefined : "%"}
            note={
              loading ??
              note(
                changeText(mlChange),
                `${rec(all.moneyline)} picking winners`,
                all.marketFavorite.winPct !== null && `book favorites ${all.marketFavorite.winPct.toFixed(1)}%`,
              )
            }
            tone={tone(mlChange)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(all.total.winPct)}
            unit={all.total.winPct === null ? undefined : "%"}
            note={
              loading ??
              note(
                changeText(totChange),
                `${rec(all.total)} O/U`,
                avgTotal !== null && avgLine !== null && `goals avg ${avgTotal.toFixed(1)} vs line ${avgLine.toFixed(1)}`,
              )
            }
            tone={tone(totChange)}
          />
          <StatCard
            label="Cover % · model"
            value={fmt(all.puckLine.winPct)}
            unit={all.puckLine.winPct === null ? undefined : "%"}
            note={loading ?? note(changeText(plChange), `${rec(all.puckLine)} puck line`)}
            tone={tone(plChange)}
          />
          <StatCard
            label="Model edge · +EV moneylines"
            value={unitsText(all.bets.units)}
            note={
              loading ??
              note(
                unitsChange !== null &&
                  `${unitsChange > 0 ? "▲" : unitsChange < 0 ? "▼" : "—"} ${Math.abs(unitsChange).toFixed(2)}u wk/wk`,
                all.bets.roi === null
                  ? "No +EV moneylines graded yet"
                  : `${all.bets.wins}-${all.bets.losses} · ROI ${all.bets.roi > 0 ? "+" : ""}${all.bets.roi.toFixed(1)}%`,
              )
            }
            tone={all.bets.units > 0 ? "win" : all.bets.units < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {all.games} games graded · flat 1u at the posted moneyline · each game projected from earlier games only ·{" "}
          <Link to="/nhl/model" className="text-acc">
            Model →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          <NhlLivePanel games={live} />
          <NhlUpcomingGames games={games} />
          <NhlRecentGames
            games={recent}
            emptyText={
              isLoading
                ? "Loading games from ESPN…"
                : isError
                  ? `Could not load games from ESPN. Try refreshing shortly.${error instanceof Error && error.message ? ` (${error.message})` : ""}`
                  : "No completed NHL games are currently available from ESPN."
            }
          />
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Team grid</h2>
            <p className="label-mono mb-3">{teams.length || 32} clubs · tap to open</p>
            <div className="grid grid-cols-4 gap-2">
              {teams.slice(0, 12).map((team) => (
                <Link
                  key={team.id}
                  to="/nhl/teams/$teamId"
                  params={{ teamId: team.id }}
                  className="glass grid aspect-square place-items-center rounded-xl hover:glow"
                  style={{ boxShadow: `inset 0 0 0 1px ${team.color}44` }}
                  title={team.name}
                >
                  <NhlLogo team={team} className="size-9" />
                </Link>
              ))}
            </div>
            <Link to="/nhl/teams" className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc">
              + all {teams.length || 32} teams
            </Link>
          </Panel>
          {[
            { label: "Eastern Conference", list: east },
            { label: "Western Conference", list: west },
          ].map(({ label, list }) => (
            <Panel key={label} padded={false}>
              <PanelHeader title={label} aside={<span className="label-mono">W-L-OT · PTS</span>} />
              {list.length ? (
                <div className="divide-y divide-line/5">
                  {list.map((r, i) => (
                    <Link
                      key={r.teamId}
                      to="/nhl/teams/$teamId"
                      params={{ teamId: r.teamId }}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-line/5"
                    >
                      <span className="w-4 font-mono text-[10px] text-faint">{i + 1}</span>
                      <NhlLogo team={r.team} className="size-5" />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
                      <span className="font-mono text-xs tabular-nums text-mute">
                        {r.wins}-{r.losses}-{r.otLosses}
                      </span>
                      <span className="w-7 text-right font-mono text-xs font-semibold tabular-nums">{r.points}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                  {isLoading ? "Loading standings…" : "Standings unavailable."}
                </p>
              )}
            </Panel>
          ))}
        </aside>
      </div>
    </>
  );
}
