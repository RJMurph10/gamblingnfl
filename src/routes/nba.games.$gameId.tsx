import { createFileRoute } from "@tanstack/react-router";
import { NbaGameDetailView } from "@/components/nba/NbaGameDetail";

export const Route = createFileRoute("/nba/games/$gameId")({
  head: () => ({
    meta: [
      { title: "Game — GamblingNBA" },
      {
        name: "description",
        content: "NBA game detail: line score, box score, team stats, play-by-play, win probability, lines and model pick.",
      },
    ],
  }),
  component: NbaGamePage,
});

function NbaGamePage() {
  const { gameId } = Route.useParams();
  return <NbaGameDetailView key={gameId} gameId={gameId} />;
}
