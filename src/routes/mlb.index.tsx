import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle } from "@/components/shared/booth";
import { MlbEmpty } from "@/components/mlb/MlbBits";
import { MlbSlate } from "@/components/mlb/MlbSlate";
import { useMlbSchedule } from "@/lib/mlb/use-mlb";

export const Route = createFileRoute("/mlb/")({
  head: () => ({
    meta: [
      { title: "MLB — GamblingMLB" },
      {
        name: "description",
        content:
          "MLB games by day: probable starters, live scores, sportsbook lines and the model's numbers.",
      },
    ],
  }),
  component: MlbDashboard,
});

function MlbDashboard() {
  const { games, isLoading, isError } = useMlbSchedule(60_000);
  const upcoming = games.some((g) => g.status === "scheduled" || g.status === "live");
  return (
    <>
      <PageTitle
        eyebrow="MLB"
        title="Dashboard"
        aside={
          <Link to="/mlb/model" className="font-mono text-[11px] uppercase tracking-wider text-acc">
            What the research found →
          </Link>
        }
      />
      {!upcoming && games.length ? (
        <p className="mb-4 font-mono text-[11px] uppercase tracking-wider text-mute">
          The season is over. Showing the last games played; the next season starts in late March.
        </p>
      ) : null}
      {isLoading ? (
        <MlbEmpty>Loading the schedule…</MlbEmpty>
      ) : isError && !games.length ? (
        <MlbEmpty>ESPN's MLB schedule is unavailable right now. Try again in a minute.</MlbEmpty>
      ) : games.length ? (
        <MlbSlate games={games} />
      ) : (
        <MlbEmpty>No MLB games found for this season.</MlbEmpty>
      )}
    </>
  );
}
