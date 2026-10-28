import { createFileRoute } from "@tanstack/react-router";
import { NhlModelBoard } from "@/components/nhl/NhlModelBoard";
import { useNhlModelInputs, useNhlSchedule } from "@/lib/nhl/use-nhl";

export const Route = createFileRoute("/nhl/model")({
  validateSearch: (search: Record<string, unknown>): { game?: string } => ({
    game: typeof search.game === "string" ? search.game : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Model — GamblingNHL" },
      {
        name: "description",
        content:
          "The NHL game model: every game's winner, puck-line and over/under call graded at real prices, its track record by season since 2009, tracked edges against opening lines and the watch list.",
      },
    ],
  }),
  component: NhlModelPage,
});

function NhlModelPage() {
  const { games, isLoading } = useNhlSchedule(30_000);
  const { inputs } = useNhlModelInputs();
  return <NhlModelBoard games={games} inputs={inputs} loading={isLoading} />;
}
