import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageTitle, Panel } from "@/components/shared/booth";
import { CbaseEmpty, CbaseTeamLink, SeasonPicker } from "@/components/cbase/CbaseBits";
import { signed } from "@/lib/cbase/cbase";
import { useCbaseSeason } from "@/lib/cbase/use-cbase";

export const Route = createFileRoute("/cbase/teams/")({
  validateSearch: (search: Record<string, unknown>): { season?: number } => ({
    season: Number(search.season) || undefined,
  }),
  head: () => ({
    meta: [
      { title: "Teams — GamblingCBASE" },
      {
        name: "description",
        content:
          "Every Division I college baseball team ranked by the run-ratings model: record, runs scored and allowed, offense, defense and home park.",
      },
    ],
  }),
  component: CbaseTeamsPage,
});

type SortKey = "rank" | "off" | "dfn" | "park" | "rpg";

function CbaseTeamsPage() {
  const { season } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data, isLoading } = useCbaseSeason(season);
  const [q, setQ] = useState("");
  const [conf, setConf] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");
  const teams = useMemo(() => data?.teams ?? {}, [data]);
  const confs = useMemo(
    () =>
      [
        ...new Set(
          Object.values(teams)
            .map((t) => t.conf)
            .filter(Boolean),
        ),
      ].sort(),
    [teams],
  );
  const rows = useMemo(() => {
    const list = Object.entries(teams).filter(
      ([, t]) =>
        t.rank &&
        (!conf || t.conf === conf) &&
        (!q || t.name.toLowerCase().includes(q.toLowerCase())),
    );
    const val = (t: (typeof list)[number][1]) =>
      sort === "rank"
        ? -t.rank!
        : sort === "rpg"
          ? (t.rs - t.ra) / Math.max(1, t.w + t.l)
          : (t[sort] ?? 0);
    return list.sort((a, b) => val(b[1]) - val(a[1]));
  }, [teams, conf, q, sort]);

  const th = (key: SortKey, label: string, title: string) => (
    <th className="px-2 py-2 text-right font-normal">
      <button
        type="button"
        title={title}
        onClick={() => setSort(key)}
        className={sort === key ? "text-acc" : "hover:text-acc"}
      >
        {label}
      </button>
    </th>
  );

  return (
    <>
      <PageTitle
        eyebrow={`College baseball · ${data?.season ?? ""} season`}
        title="Teams"
        aside={
          <SeasonPicker
            seasons={data?.seasons ?? []}
            value={data?.season}
            onChange={(s) => navigate({ search: { season: s } })}
          />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={conf}
          onChange={(e) => setConf(e.target.value)}
          aria-label="Conference"
          className="rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] text-mute ring-1 ring-line/10"
        >
          <option value="">All conferences</option>
          {confs.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a team"
          aria-label="Find a team"
          className="min-w-0 flex-1 rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] ring-1 ring-line/10 placeholder:text-faint sm:max-w-[220px]"
        />
      </div>
      {isLoading ? (
        <CbaseEmpty>Loading teams…</CbaseEmpty>
      ) : !rows.length ? (
        <CbaseEmpty>No teams match.</CbaseEmpty>
      ) : (
        <Panel padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">
                    <button
                      type="button"
                      onClick={() => setSort("rank")}
                      className={sort === "rank" ? "text-acc" : "hover:text-acc"}
                    >
                      #
                    </button>
                  </th>
                  <th className="px-2 py-2 font-normal">Team</th>
                  <th className="px-2 py-2 font-normal">Conf</th>
                  <th className="px-2 py-2 text-right font-normal">W-L</th>
                  {th("rpg", "Run diff/g", "Runs scored minus allowed per game")}
                  {th("off", "Offense", "Runs scored per game above average, opponent-adjusted")}
                  {th("dfn", "Defense", "Runs prevented per game below average, opponent-adjusted")}
                  {th("park", "Park", "Home park's runs effect per team per game")}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {rows.map(([key, t]) => (
                  <tr key={key}>
                    <td className="px-4 py-1.5 font-mono text-xs text-faint">{t.rank}</td>
                    <td className="px-2 py-1.5">
                      <CbaseTeamLink
                        teams={teams}
                        teamKey={key}
                        season={data?.season}
                        showRank={false}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[10px] uppercase text-faint">
                      {t.conf}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {t.w}-{t.l}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {signed((t.rs - t.ra) / Math.max(1, t.w + t.l), 1)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">{signed(t.off, 2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">{signed(t.dfn, 2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {signed(t.park, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
