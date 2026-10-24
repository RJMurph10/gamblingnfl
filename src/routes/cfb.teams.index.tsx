import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, TeamCard } from "@/components/booth";
import { teamById, type Team } from "@/data/teams";
import { useCfbConferences, useCfbTop25 } from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/teams/")({
  head: () => ({
    meta: [
      { title: "All FBS Teams — GamblingCFB" },
      {
        name: "description",
        content:
          "Every FBS team by conference, with records, rankings and links to each team's analytics page.",
      },
    ],
  }),
  component: CfbTeams,
});

function CfbTeams() {
  const { conferences, isLoading } = useCfbConferences();
  const top25 = useCfbTop25();
  const rankOf = useMemo(
    () => new Map(top25.ranks.map((r) => [r.team.id, r.rank] as const)),
    [top25.ranks],
  );
  const teamCount = conferences.reduce((s, c) => s + c.teams.length, 0);

  return (
    <>
      <PageTitle
        eyebrow="Team index · FBS"
        title={teamCount ? `All ${teamCount} Teams` : "All FBS Teams"}
      />
      {!conferences.length ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            {isLoading ? "Loading teams…" : "Teams couldn't be loaded right now."}
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {conferences.map((c) => {
            const group = c.teams
              .map((t) => teamById(`cfb-${t.id}`))
              .filter((t): t is Team => !!t)
              .map((t) => ({ ...t, rank: rankOf.get(t.id) }));
            return (
              <Panel key={c.id}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">
                    {c.name}
                  </h2>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                    {group.length} teams
                  </span>
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
      )}
    </>
  );
}
