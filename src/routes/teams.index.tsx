import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, SampleBadge, TeamCard } from "@/components/booth";
import { divisions, teams } from "@/data/teams";

export const Route = createFileRoute("/teams/")({
  head: () => ({
    meta: [
      { title: "All 32 NFL Teams — GamblingNFL" },
      {
        name: "description",
        content:
          "Browse all 32 NFL teams by conference and division, with records and links to each team's analytics page.",
      },
      { property: "og:title", content: "All 32 NFL Teams — GamblingNFL" },
      {
        property: "og:description",
        content: "Every NFL franchise by division, with team analytics pages one tap away.",
      },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  return (
    <>
      <PageTitle eyebrow="Team index" title="All 32 Teams" aside={<SampleBadge />} />
      <div className="grid gap-4 lg:grid-cols-2">
        {divisions.map(({ conference, division }) => {
          const group = teams.filter(
            (t) => t.conference === conference && t.division === division,
          );
          return (
            <Panel key={`${conference}-${division}`}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">
                  {conference} {division}
                </h2>
                <span className="label-mono">4 clubs</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.map((team) => (
                  <TeamCard key={team.id} team={team} />
                ))}
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
