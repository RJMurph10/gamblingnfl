import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/shared/booth";
import { NhlPropsBoard } from "@/components/nhl/NhlPropsBoard";
import { NhlSlate } from "@/components/nhl/NhlSlate";
import { useNhlSchedule } from "@/lib/nhl/use-nhl";

export const Route = createFileRoute("/nhl/props")({
  validateSearch: (search: Record<string, unknown>): { game?: string } => ({
    game: typeof search.game === "string" ? search.game : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Player Props — GamblingNHL" },
      {
        name: "description",
        content: "NHL player props by game: DraftKings lines for goals, assists, points, shots on goal and saves, compared with model projections.",
      },
    ],
  }),
  component: NhlPropsPage,
});

function NhlPropsPage() {
  const search = Route.useSearch();
  const { games, isLoading, isError } = useNhlSchedule(60_000);
  return (
    <>
      <PageTitle eyebrow="NHL" title="Player Props" />
      <NhlSlate
        games={games}
        isLoading={isLoading}
        isError={isError}
        initialGame={search.game}
        renderBoard={(game) => <NhlPropsBoard key={game.id} game={game} />}
      />
    </>
  );
}
