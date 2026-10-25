import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel } from "@/components/booth";
import { NbaTeamDetail } from "@/components/nba/NbaTeamDetail";
import { useNbaTeams } from "@/lib/use-nba";

export const Route = createFileRoute("/nba/teams/$teamId")({
  head: () => ({
    meta: [
      { title: "Team — GamblingNBA" },
      {
        name: "description",
        content: "NBA team page: season metrics ranked across the league, schedule with lines, player stats and roster.",
      },
    ],
  }),
  component: NbaTeamPage,
});

function NbaTeamPage() {
  const { teamId } = Route.useParams();
  const { teams, isLoading, data } = useNbaTeams();
  // Look the team up only once the list has loaded so server and browser render the same thing.
  const team = data ? teams.find((t) => t.id === teamId || t.abbr.toLowerCase() === teamId.toLowerCase()) : undefined;
  if (team) return <NbaTeamDetail key={team.id} team={team} />;
  return (
    <>
      <PageTitle eyebrow="NBA" title={isLoading ? "Loading team…" : "Team not found"} />
      {!isLoading ? (
        <Panel>
          <p className="py-6 text-center font-mono text-xs text-mute">
            That team isn&apos;t in ESPN&apos;s NBA list.{" "}
            <Link to="/nba/teams" className="text-acc">
              All teams →
            </Link>
          </p>
        </Panel>
      ) : null}
    </>
  );
}
