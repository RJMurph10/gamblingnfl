import { createFileRoute } from "@tanstack/react-router";
import { PropHistoryPage } from "@/components/shared/PropHistory";

export const Route = createFileRoute("/nba/prop-history")({
  head: () => ({
    meta: [
      { title: "Prop history — GamblingNBA" },
      {
        name: "description",
        content: "Past NBA player prop lines and prices next to what each player actually did.",
      },
    ],
  }),
  component: () => <PropHistoryPage league="nba" />,
});
