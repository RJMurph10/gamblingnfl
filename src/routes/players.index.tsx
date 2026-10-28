import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PlayersIndex } from "@/components/shared/PlayersIndex";
import { getLeaguePlayers } from "@/lib/shared/espn.functions";
import type { LeaguePlayer } from "@/lib/shared/league-players.server";

export const Route = createFileRoute("/players/")({
  head: () => ({
    meta: [
      { title: "Player Search — GamblingNFL" },
      {
        name: "description",
        content:
          "Search NFL players by name or team and filter by position, with stats that fit each position: offense, defense, kickers and punters.",
      },
      { property: "og:title", content: "Player Search — GamblingNFL" },
      {
        property: "og:description",
        content: "Searchable player index with position-specific season stats.",
      },
    ],
  }),
  component: PlayersPage,
});

function PlayersPage() {
  const { data: live, isError } = useQuery<LeaguePlayer[]>({
    queryKey: ["league-players"],
    queryFn: () => getLeaguePlayers(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  return (
    <PlayersIndex
      live={live}
      isError={isError}
      useSample
      liveLabel={(n) => `${n} players · ESPN 2026`}
    />
  );
}
