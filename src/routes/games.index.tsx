import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, SampleBadge, TeamLogo } from "@/components/booth";
import { gameScore, games, weeks } from "@/data/games";
import { teamById } from "@/data/teams";

export const Route = createFileRoute("/games/")({
  head: () => ({
    meta: [
      { title: "Games by Week — GamblingNFL" },
      {
        name: "description",
        content:
          "NFL games grouped by week with scores, spreads, and totals, linking to quarter-by-quarter and drive-by-drive game detail.",
      },
      { property: "og:title", content: "Games by Week — GamblingNFL" },
      {
        property: "og:description",
        content: "Weekly slate with scores, spreads, totals, and full game breakdowns.",
      },
    ],
  }),
  component: GamesPage,
});

function GamesPage() {
  return (
    <>
      <PageTitle eyebrow="Schedule" title="Games" aside={<SampleBadge />} />
      <div className="space-y-4">
        {weeks.map((week) => (
          <Panel key={week} padded={false}>
            <PanelHeader
              title={`Week ${week}`}
              aside={
                <span className="label-mono">
                  {games.filter((g) => g.week === week).length} games
                </span>
              }
            />
            <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {games
                .filter((g) => g.week === week)
                .map((game) => {
                  const away = teamById(game.awayTeamId);
                  const home = teamById(game.homeTeamId);
                  const score = gameScore(game);
                  if (!away || !home) return null;
                  return (
                    <Link
                      key={game.id}
                      to="/games/$gameId"
                      params={{ gameId: game.id }}
                      className="glass p-3 transition-shadow hover:glow"
                    >
                      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
                        <span>{game.kickoff}</span>
                        <span className={game.status === "final" ? "text-mute" : "text-acc"}>
                          {game.status}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1">
                        {[
                          { team: away, pts: score.away },
                          { team: home, pts: score.home },
                        ].map((side) => (
                          <div key={side.team.id} className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 font-disp text-lg font-semibold uppercase leading-none tracking-tight">
                              <TeamLogo team={side.team} /> {side.team.abbr}{" "}
                              <span className="font-body text-xs font-normal normal-case text-mute">
                                {side.team.name}
                              </span>
                            </span>
                            <span className="font-mono text-sm tabular-nums">
                              {game.status === "scheduled" ? "—" : side.pts}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex justify-between border-t border-line/10 pt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                        <span>{game.spread}</span>
                        <span>O/U {game.total}</span>
                      </div>
                    </Link>
                  );
                })}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
