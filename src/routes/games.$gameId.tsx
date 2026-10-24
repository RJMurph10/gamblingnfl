import { createFileRoute } from "@tanstack/react-router";
import { GameDetail } from "@/components/GameDetail";

export const Route = createFileRoute("/games/$gameId")({
  head: () => ({
    meta: [
      { title: "Game — GamblingNFL" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "description",
        content:
          "NFL game detail: quarter-by-quarter line score, drive chart, team statistics, and box score.",
      },
      { property: "og:title", content: "Game — GamblingNFL" },
      {
        property: "og:description",
        content: "NFL game breakdown with line score, drives, team stats, and box score.",
      },
    ],
  }),
  component: GamePage,
});

function GamePage() {
  const { gameId } = Route.useParams();
  return <GameDetail gameId={gameId} />;
}
