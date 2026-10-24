import { createFileRoute } from "@tanstack/react-router";
import { PlayerDetail } from "@/components/PlayerDetail";

export const Route = createFileRoute("/players/$playerId")({
  component: PlayerPage,
});

function PlayerPage() {
  const { playerId } = Route.useParams();
  return <PlayerDetail playerId={playerId} league="nfl" />;
}
