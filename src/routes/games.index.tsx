import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { GameCard } from "@/components/shared/GameCard";
import type { Game } from "@/data/shared/games";
import { getLiveSchedule } from "@/lib/shared/espn.functions";

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

function GamesPage() {
  const {
    data: liveGames,
    isLoading: scheduleLoading,
    isError: scheduleError,
  } = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    // Recheck the ESPN schedule periodically so newly released lines appear
    // without requiring the user to reload the Games tab.
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
    retry: 1,
  });

  // Do not fall back to fake/local fixtures when the ESPN feed is empty or fails.
  const games: Game[] = liveGames ?? [];
  const live = games.length > 0;
  const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => b - a);

  return (
    <>
      <PageTitle eyebrow={live ? "2026 Season · Live data" : "Live ESPN schedule"} title="Games" />
      <div className="space-y-4">
        {!live && (
          <Panel>
            <p className="text-center font-mono text-xs text-mute">
              {scheduleLoading
                ? "Loading games from ESPN…"
                : scheduleError
                  ? "Could not load games from ESPN. Try refreshing shortly."
                  : "No games are currently available from ESPN. Sample games are disabled."}
            </p>
          </Panel>
        )}
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
                .map((game) => (
                  <GameCard key={game.id} game={game} />
                ))}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
