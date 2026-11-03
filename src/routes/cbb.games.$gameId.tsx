import { createFileRoute } from "@tanstack/react-router";
import { CbbGameDetailView } from "@/components/cbb/CbbGameDetail";

export const Route = createFileRoute("/cbb/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingCBB" }] }),
  component: CbbGamePage,
});

function CbbGamePage() {
  const { gameId } = Route.useParams();
  return <CbbGameDetailView key={gameId} gameId={gameId} />;
}
