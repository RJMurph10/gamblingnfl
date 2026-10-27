import { createFileRoute } from "@tanstack/react-router";
import { NhlPlayersIndex } from "@/components/nhl/NhlPlayersIndex";

export const Route = createFileRoute("/nhl/players/")({
  head: () => ({
    meta: [
      { title: "Players — GamblingNHL" },
      { name: "description", content: "Search every NHL player with season totals: goals, assists, points, shots, ice time and goalie stats." },
    ],
  }),
  component: NhlPlayersIndex,
});
