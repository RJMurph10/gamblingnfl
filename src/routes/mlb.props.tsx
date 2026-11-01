import { createFileRoute } from "@tanstack/react-router";
import { PropHistoryPage } from "@/components/shared/PropHistory";

export const Route = createFileRoute("/mlb/props")({
  head: () => ({
    meta: [
      { title: "Prop lines — GamblingMLB" },
      {
        name: "description",
        content:
          "MLB player prop lines for upcoming games, and past lines next to what each player did.",
      },
    ],
  }),
  component: () => <PropHistoryPage league="mlb" />,
});
