import { createFileRoute } from "@tanstack/react-router";
import { PropHistoryPage } from "@/components/shared/PropHistory";

export const Route = createFileRoute("/wnba/props")({
  head: () => ({
    meta: [
      { title: "Prop lines — GamblingWNBA" },
      {
        name: "description",
        content:
          "WNBA player prop lines for upcoming games, and past lines next to what each player did.",
      },
    ],
  }),
  component: () => <PropHistoryPage league="wnba" />,
});
