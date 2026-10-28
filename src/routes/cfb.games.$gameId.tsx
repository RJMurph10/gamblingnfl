import { createFileRoute } from "@tanstack/react-router";
import { GameDetail } from "@/components/shared/GameDetail";

export const Route = createFileRoute("/cfb/games/$gameId")({
  head: () => ({
    meta: [
      { title: "Game — GamblingCFB" },
      {
        name: "description",
        content:
          "College football game detail: line score, drive chart, team statistics, box score and lines.",
      },
    ],
  }),
  component: CfbGamePage,
});

function CfbGamePage() {
  const { gameId } = Route.useParams();
  return <GameDetail gameId={gameId} />;
}
