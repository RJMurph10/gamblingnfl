import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader, SampleBadge, SpreadBadge, TeamLogo } from "@/components/booth";
import { gameScore, games as sampleGames, weeks as sampleWeeks, type Game } from "@/data/games";
import { teamById } from "@/data/teams";
import { getLiveSchedule } from "@/lib/espn.functions";

export const Route = createFileRoute("/games/")({
  head: () => ({
    meta: [
      { title: "Games by Week — GamblingNFL" },
      {
        name: "description",
        content:
          "Live 2026 NFL schedule and results grouped by week, linking to quarter-by-quarter and drive-by-drive game detail.",
      },
      { property: "og:title", content: "Games by Week — GamblingNFL" },
      {
        property: "og:description",
        content: "Weekly slate with live scores, spreads, totals, and full game breakdowns.",
      },
    ],
  }),
  component: GamesPage,
});

/** Kickoff in the viewer's own time zone, e.g. "Sun 1:00 PM" (no hardcoded ET). */
function localKickoff(game: Game): string {
  if (!game.kickoffIso) return (game.kickoff ?? "").replace(/\s*(ET|EDT|EST)$/i, "");
  const d = new Date(game.kickoffIso);
  return `${d.toLocaleDateString([], { weekday: "short" })} ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function GamesPage() {
  const { data: liveGames } = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const live = liveGames && liveGames.length > 0;
  const games = live ? liveGames : sampleGames;
  const weeks = live
    ? Array.from(new Set(games.map((g) => g.week))).sort((a, b) => b - a)
    : sampleWeeks;

  return (
    <>
      <PageTitle
        eyebrow={live ? "2026 Season · Live data" : "Schedule"}
        title="Games"
        aside={live ? undefined : <SampleBadge />}
      />
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
                        <span suppressHydrationWarning>{localKickoff(game)}</span>
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
                            <span className="flex items-center gap-2 font-disp text-lg font-bold uppercase leading-none tracking-tight text-ink">
                              <TeamLogo team={side.team} />
                              {side.team.name}
                            </span>
                            <span className="font-mono text-sm tabular-nums">
                              {game.status === "scheduled" ? "—" : side.pts}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex justify-between border-t border-line/10 pt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                        <SpreadBadge spread={game.spread} away={away} home={home} />
                        <span>{game.total > 0 ? `O/U ${game.total}` : "O/U —"}</span>
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
