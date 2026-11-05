import { createFileRoute } from "@tanstack/react-router";
import { WcbbGameDetailView } from "@/components/wcbb/WcbbGameDetail";

export const Route = createFileRoute("/wcbb/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingWCBB" }] }),
  component: WcbbGamePage,
});

function WcbbGamePage() {
  const { gameId } = Route.useParams();
  return <WcbbGameDetailView key={gameId} gameId={gameId} />;
}
