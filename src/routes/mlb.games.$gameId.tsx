import { createFileRoute } from "@tanstack/react-router";
import { MlbGameDetailView } from "@/components/mlb/MlbGameDetail";

export const Route = createFileRoute("/mlb/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingMLB" }] }),
  component: MlbGamePage,
});

function MlbGamePage() {
  const { gameId } = Route.useParams();
  return <MlbGameDetailView gameId={gameId} />;
}
