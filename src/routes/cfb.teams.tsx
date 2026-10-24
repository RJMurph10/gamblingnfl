import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { CfbLogo } from "@/components/CfbGameCard";
import { getCfbConferences } from "@/lib/cfb.functions";

export const Route = createFileRoute("/cfb/teams")({
  head: () => ({
    meta: [
      { title: "College football teams — GamblingCFB" },
      { name: "description", content: "Every FBS team by conference, with records." },
    ],
  }),
  component: CfbTeams,
});

function CfbTeams() {
  const query = useQuery({
    queryKey: ["cfb-conferences"],
    queryFn: () => getCfbConferences(),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const conferences = [...(query.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const teamCount = conferences.reduce((s, c) => s + c.teams.length, 0);
  return (
    <>
      <PageTitle eyebrow={teamCount ? `FBS · ${teamCount} teams` : "FBS"} title="Teams" />
      {query.isLoading ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">Loading teams…</p>
        </Panel>
      ) : !conferences.length ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            Teams couldn&apos;t be loaded right now.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {conferences.map((c) => (
            <Panel key={c.id} padded={false}>
              <PanelHeader
                title={c.name}
                aside={
                  <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                    Overall · Conf
                  </span>
                }
              />
              <ul className="divide-y divide-line/5">
                {c.teams.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 px-4 py-1.5 text-sm">
                    <CfbLogo team={t} className="size-5" />
                    <span className="min-w-0 truncate">{t.location}</span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-mute">
                      {t.record ?? "—"}
                    </span>
                    <span className="w-10 text-right font-mono text-[11px] tabular-nums text-faint">
                      {t.confRecord ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
