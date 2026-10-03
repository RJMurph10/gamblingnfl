import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  PageTitle,
  Panel,
  PanelHeader,
  SampleBadge,
  StatCard,
  TeamMark,
} from "@/components/booth";
import { playerById } from "@/data/players";
import { teamById } from "@/data/teams";

export const Route = createFileRoute("/players/$playerId")({
  loader: ({ params }) => {
    const player = playerById(params.playerId);
    if (!player) throw notFound();
    return { player };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Player not found — GamblingNFL" }, { name: "robots", content: "noindex" }],
      };
    }
    const { player } = loaderData;
    const name = `${player.firstName} ${player.lastName}`;
    const title = `${name} (${player.position}) — GamblingNFL`;
    const description = `${name} player profile: season production, game log, and player prop projections versus market lines.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: PlayerPage,
});

function PlayerPage() {
  const { player } = Route.useLoaderData();
  const team = teamById(player.teamId);
  const ft = Math.floor(player.heightIn / 12);
  const inch = player.heightIn % 12;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {team ? <TeamMark team={team} size="lg" /> : null}
        <PageTitle
          eyebrow={`${player.position} · #${player.jersey}${team ? ` · ${team.city} ${team.name}` : ""}`}
          title={`${player.firstName} ${player.lastName}`}
        />
        <SampleBadge />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Games" value={String(player.season.games)} note={`age ${player.age}`} />
        <StatCard
          label="Yards"
          value={player.season.yards.toLocaleString()}
          note={`${(player.season.yards / player.season.games).toFixed(1)} per game`}
        />
        <StatCard label="Touchdowns" value={String(player.season.tds)} note="season total" />
        <StatCard
          label="Frame"
          value={`${ft}'${inch}"`}
          note={`${player.weightLb} lb`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-7">
          <Panel padded={false}>
            <PanelHeader title="Game log" aside={<span className="label-mono">last 5</span>} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Week</th>
                    <th className="px-2 py-2 font-normal">Opponent</th>
                    <th className="px-2 py-2 text-right font-normal">Touches</th>
                    <th className="px-2 py-2 text-right font-normal">Yards</th>
                    <th className="px-4 py-2 text-right font-normal">TD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {player.gameLog.map((g) => {
                    const opp = teamById(g.opponent);
                    return (
                      <tr key={g.week} className="hover:bg-line/5">
                        <td className="px-4 py-2.5 font-mono tabular-nums">WK {g.week}</td>
                        <td className="px-2 py-2.5 font-mono text-mute">
                          {opp ? (
                            <Link
                              to="/teams/$teamId"
                              params={{ teamId: opp.id }}
                              className="hover:text-acc"
                            >
                              {opp.abbr}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{g.touches}</td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{g.yards}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{g.tds}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>

        <section className="lg:col-span-5">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              Prop projections
            </h2>
            <p className="label-mono">model vs market · placeholder</p>
            <div className="mt-4 space-y-3">
              {player.projections.map((proj) => {
                const edge = ((proj.projection - proj.line) / proj.line) * 100;
                const pct = Math.max(
                  8,
                  Math.min(100, (proj.projection / (proj.line * 1.4)) * 100),
                );
                return (
                  <div key={proj.market} className="rounded-lg bg-panel2 p-3 ring-1 ring-line/10">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{proj.market}</span>
                      <span className="font-mono text-xs text-mute">line {proj.line}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between font-mono text-xs">
                      <span className="text-acc tabular-nums">proj {proj.projection}</span>
                      <span className={edge >= 0 ? "text-win tabular-nums" : "text-loss tabular-nums"}>
                        {edge >= 0 ? "+" : ""}
                        {edge.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-background">
                      <div
                        className={`h-1.5 rounded-full ${edge >= 0 ? "bg-acc" : "bg-loss"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <Link
              to="/props"
              className="mt-4 inline-flex rounded-lg bg-acc/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-acc/25"
            >
              Full prop board
            </Link>
          </Panel>
        </section>
      </div>
    </>
  );
}
