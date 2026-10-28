import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel } from "@/components/shared/booth";
import { NbaLogo } from "@/components/nba/NbaBits";
import { EmptyPanel } from "@/components/nba/NbaBits";
import { NBA_DIVISIONS, canonAbbr } from "@/lib/nba/nba";
import { useNbaStandings, useNbaTeams } from "@/lib/nba/use-nba";

export const Route = createFileRoute("/nba/teams/")({
  head: () => ({
    meta: [
      { title: "All 30 NBA Teams — GamblingNBA" },
      {
        name: "description",
        content: "Every NBA team by conference and division, with records and links to each team's analytics page.",
      },
    ],
  }),
  component: NbaTeams,
});

function NbaTeams() {
  const { teams, isLoading } = useNbaTeams();
  const { rows } = useNbaStandings();
  const byAbbr = new Map(teams.map((t) => [canonAbbr(t.abbr), t]));
  const record = new Map(rows.map((r) => [r.teamId, r]));
  return (
    <>
      <PageTitle eyebrow="Team index · NBA" title={teams.length ? `All ${teams.length} Teams` : "All 30 Teams"} />
      {!teams.length ? (
        <EmptyPanel>{isLoading ? "Loading teams…" : "Teams couldn't be loaded right now."}</EmptyPanel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(["East", "West"] as const).map((conf) => (
            <div key={conf} className="space-y-4">
              <h2 className="font-disp text-2xl font-bold uppercase tracking-tight text-acc">{conf}ern Conference</h2>
              {NBA_DIVISIONS.filter((d) => d.conference === conf).map((d) => (
                <Panel key={d.name}>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h3 className="font-disp text-lg font-semibold uppercase tracking-tight">{d.name}</h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{d.teams.length} teams</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {d.teams
                      .map((a) => byAbbr.get(a))
                      .filter((t): t is NonNullable<typeof t> => Boolean(t))
                      .map((t) => {
                        const r = record.get(t.id);
                        return (
                          <Link
                            key={t.id}
                            to="/nba/teams/$teamId"
                            params={{ teamId: t.id }}
                            className="glass flex items-center gap-3 p-3 transition-shadow hover:glow"
                          >
                            <NbaLogo team={t} className="size-10" />
                            <span className="min-w-0">
                              <span className="block truncate font-disp text-lg font-semibold uppercase leading-none tracking-tight">{t.nickname}</span>
                              <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-wider text-faint">
                                {t.location}
                                {r ? ` · ${r.wins}-${r.losses}` : ""}
                              </span>
                            </span>
                          </Link>
                        );
                      })}
                  </div>
                </Panel>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
