import { createFileRoute } from "@tanstack/react-router";
import { PropHistoryPage } from "@/components/shared/PropHistory";

export const Route = createFileRoute("/nhl/prop-history")({
  head: () => ({
    meta: [
      { title: "Prop lines — GamblingNHL" },
      {
        name: "description",
        content:
          "NHL player prop lines for upcoming games, and past lines next to what each player did.",
      },
    ],
  }),
  component: () => <PropHistoryPage league="nhl" />,
});
