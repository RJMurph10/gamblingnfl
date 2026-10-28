import { createFileRoute, notFound } from "@tanstack/react-router";
import { TeamDetail } from "@/components/shared/TeamDetail";
import { teamById } from "@/data/shared/teams";

export const Route = createFileRoute("/teams/$teamId")({
  loader: ({ params }) => {
    const team = teamById(params.teamId);
    if (!team) throw notFound();
    return { team };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Team not found — GamblingNFL" }, { name: "robots", content: "noindex" }] };
    }
    const { team } = loaderData;
    const title = `${team.city} ${team.name} Analytics — GamblingNFL`;
    const description = `${team.city} ${team.name} team page with schedule, season player statistics, roster, and depth chart.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: TeamPage,
});

function TeamPage() {
  const { team } = Route.useLoaderData();
  return <TeamDetail team={team} />;
}
