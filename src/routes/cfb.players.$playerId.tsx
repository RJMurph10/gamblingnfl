import { createFileRoute } from "@tanstack/react-router";
import { PlayerDetail } from "@/components/PlayerDetail";

export const Route = createFileRoute("/cfb/players/$playerId")({
  head: () => ({
    meta: [
      { title: "Player — GamblingCFB" },
      {
        name: "description",
        content: "College football player: season totals, averages and game log.",
      },
    ],
  }),
  component: CfbPlayerPage,
});

function CfbPlayerPage() {
  const { playerId } = Route.useParams();
  return <PlayerDetail key={playerId} playerId={playerId} league="cfb" />;
}
