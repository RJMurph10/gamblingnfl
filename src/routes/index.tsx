import { createFileRoute, Link } from "@tanstack/react-router";
import {
  DriveRail,
  GameRow,
  LineScore,
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  StatCard,
  StatComparison,
  TeamLogo,
  TeamMark,
} from "@/components/booth";
import { games } from "@/data/games";
import { players } from "@/data/players";
import { teams } from "@/data/teams";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingNFL dashboard" },
      {
        name: "description",
        content:
          "GamblingNFL home dashboard: season pulse metrics, recent games, the 32-team grid, and live prop projection snapshots.",
      },
      { property: "og:title", content: "Season Pulse — GamblingNFL dashboard" },
      {
        property: "og:description",
        content: "Season metrics, recent results, team grid, and prop projections in one view.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const recent = games.filter((g) => g.status === "final").slice(0, 5);
  const featured = recent[0];
  const topPlayers = [...players].sort((a, b) => b.season.yards - a.season.yards).slice(0, 5);

  return (
    <>
      <section className="mb-6">
        <PageTitle eyebrow="Home dashboard" title="Season Pulse" aside={<SampleBadge />} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Win rate" value="54.2" unit="%" note="▲ 2.1 wk/wk" tone="win" />
          <StatCard label="Avg total" value="47.8" note="o/u line 45.5" />
          <StatCard label="Cover %" value="51.7" unit="%" note="▼ 0.6 wk/wk" tone="loss" />
          <StatCard label="Model edge" value="+3.4" unit="pts" note="▲ 0.9 wk/wk" tone="win" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-8">
          <Panel padded={false}>
            <PanelHeader
              title="Recent games"
              aside={
                <Link to="/games" className="font-mono text-[11px] text-acc">
                  View all →
                </Link>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Matchup</th>
                    <th className="px-2 py-2 font-normal">Week</th>
                    <th className="px-2 py-2 text-right font-normal">Score</th>
                    <th className="px-2 py-2 text-right font-normal">Spread</th>
                    <th className="px-4 py-2 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {recent.map((g) => (
                    <GameRow key={g.id} game={g} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
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
              <Link to="/players" className="font-mono text-[11px] text-acc">
                Search players →
              </Link>
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

      {featured ? (
        <section className="mt-6 grid gap-6 lg:grid-cols-12">
          <Panel className="lg:col-span-5">
            <div className="flex items-center justify-between">
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Gamecast
              </h2>
              <Link
                to="/games/$gameId"
                params={{ gameId: featured.id }}
                className="font-mono text-[10px] uppercase text-acc"
              >
                Final →
              </Link>
            </div>
            <div className="mt-3">
              <LineScore game={featured} />
            </div>
            <p className="label-mono mt-4">Drive rail · away</p>
            <div className="mt-1.5">
              <DriveRail game={featured} teamId={featured.awayTeamId} />
            </div>
          </Panel>
          <Panel className="lg:col-span-7">
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              Team comparison
            </h2>
            <div className="mt-4">
              <StatComparison game={featured} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-panel2 p-2 ring-1 ring-line/10">
              <span className="label-mono">Prop projection</span>
              <span className="ml-auto font-mono text-sm tabular-nums">
                J. Marrow 291.0 pass yds <span className="text-win">▲</span>
              </span>
            </div>
          </Panel>
        </section>
      ) : null}

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
