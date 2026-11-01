import { createFileRoute } from "@tanstack/react-router";
import { PropHistoryPage } from "@/components/shared/PropHistory";

export const Route = createFileRoute("/prop-history")({
  head: () => ({
    meta: [
      { title: "Prop history — GamblingNFL" },
      {
        name: "description",
        content: "Past NFL player prop lines and prices next to what each player actually did.",
      },
    ],
  }),
  component: () => <PropHistoryPage league="nfl" />,
});
