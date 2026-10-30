import { createFileRoute } from "@tanstack/react-router";
import { NhlGameDetailView } from "@/components/nhl/NhlGameDetail";

export const Route = createFileRoute("/nhl/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingNHL" }] }),
  component: NhlGamePage,
});

function NhlGamePage() {
  const { gameId } = Route.useParams();
  return <NhlGameDetailView gameId={gameId} />;
}
