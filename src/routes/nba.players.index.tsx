import { createFileRoute } from "@tanstack/react-router";
import { NbaPlayersIndex } from "@/components/nba/NbaPlayersIndex";

export const Route = createFileRoute("/nba/players/")({
  head: () => ({
    meta: [
      { title: "Player Search — GamblingNBA" },
      {
        name: "description",
        content: "Search NBA players by name or team, filter by position or team, and sort by per-game averages.",
      },
    ],
  }),
  component: NbaPlayersIndex,
});
