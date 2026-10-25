import { createFileRoute } from "@tanstack/react-router";
import { NbaPlayerDetail } from "@/components/nba/NbaPlayerDetail";

export const Route = createFileRoute("/nba/players/$playerId")({
  head: () => ({
    meta: [
      { title: "Player — GamblingNBA" },
      { name: "description", content: "NBA player: season averages, trend chart and game log." },
    ],
  }),
  component: NbaPlayerPage,
});

function NbaPlayerPage() {
  const { playerId } = Route.useParams();
  return <NbaPlayerDetail key={playerId} playerId={playerId} />;
}
