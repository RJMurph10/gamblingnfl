import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel } from "@/components/booth";
import { TeamDetail } from "@/components/TeamDetail";
import { teamById } from "@/data/teams";
import { useCfbConferences, useCfbSchedule } from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/teams/$teamId")({
  head: () => ({
    meta: [
      { title: "Team — GamblingCFB" },
      {
        name: "description",
        content:
          "College football team page: season metrics ranked within the conference, schedule with lines, player stats and roster.",
      },
    ],
  }),
  component: CfbTeamPage,
});

function CfbTeamPage() {
  const { teamId } = Route.useParams();
  // College teams come from ESPN (conferences for FBS teams, the schedule for FCS opponents).
  const conferences = useCfbConferences();
  const schedule = useCfbSchedule(5 * 60_000);
  // Look the team up only once the data is in, so the server and browser render the same thing
  // (the server may already know the team from earlier requests).
  const ready = Boolean(conferences.data || schedule.data);
  const team = ready ? teamById(teamId) : undefined;
  if (team) return <TeamDetail key={team.id} team={team} />;
  const loading = conferences.isLoading || schedule.isLoading;
  return (
    <>
      <PageTitle eyebrow="FBS" title={loading ? "Loading team…" : "Team not found"} />
      {!loading ? (
        <Panel>
          <p className="py-6 text-center font-mono text-xs text-mute">
            This team isn&apos;t on ESPN&apos;s FBS schedule.{" "}
            <Link to="/cfb/teams" className="text-acc">
              All teams →
            </Link>
          </p>
        </Panel>
      ) : null}
    </>
  );
}
