import { createFileRoute } from "@tanstack/react-router";
import { WnbaGameDetailView } from "@/components/wnba/WnbaGameDetail";

export const Route = createFileRoute("/wnba/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingWNBA" }] }),
  component: WnbaGamePage,
});

function WnbaGamePage() {
  const { gameId } = Route.useParams();
  return <WnbaGameDetailView key={gameId} gameId={gameId} />;
}
