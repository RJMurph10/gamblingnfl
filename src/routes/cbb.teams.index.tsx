import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { CbbEmpty, CbbLogo } from "@/components/cbb/CbbBits";
import { buildCbbStandings, recordText, type CbbStandingRow, type CbbTeamRef } from "@/lib/cbb/cbb";
import { buildRatings, ratingRows } from "@/lib/cbb/cbb-model";
import { useCbbSchedule } from "@/lib/cbb/use-cbb";

export const Route = createFileRoute("/cbb/teams/")({
  head: () => ({
    meta: [
      { title: "Teams — GamblingCBB" },
      {
        name: "description",
        content: "Every Division I men's college basketball team by conference, with records and model power ratings.",
      },
    ],
  }),
  component: CbbTeamsPage,
});

function CbbTeamsPage() {
  const { games, teams, conferences, rankings, isLoading, isError } = useCbbSchedule(60_000);
  const [q, setQ] = useState("");
  const standings = useMemo(() => buildCbbStandings(games, [...teams.values()]), [games, teams]);
  const ranks = useMemo(() => {
    const d1 = new Set([...teams.values()].filter((t) => t.confId && conferences.has(t.confId)).map((t) => t.id));
    const finals = games.filter((g) => g.status === "final");
    return new Map(ratingRows(buildRatings(finals), d1).map((r) => [r.teamId, r]));
  }, [games, teams, conferences]);

  const groups = useMemo(() => {
    const s = q.toLowerCase();
    return [...conferences.values()]
      .sort((a, b) => a.short.localeCompare(b.short))
      .map((c) => {
        const list = [...teams.values()]
          .filter((t) => t.confId === c.id)
          .filter((t) => !s || `${t.name} ${t.abbr} ${t.short}`.toLowerCase().includes(s));
        const confPct = (t: CbbTeamRef) => {
          const r = standings.get(t.id);
          return r ? r.conf.wins - r.conf.losses : 0;
        };
        list.sort(
          (a, b) =>
            confPct(b) - confPct(a) ||
            (standings.get(b.id)?.overall.wins ?? 0) - (standings.get(a.id)?.overall.wins ?? 0) ||
            (ranks.get(a.id)?.rank ?? 999) - (ranks.get(b.id)?.rank ?? 999),
        );
        return { conf: c, teams: list };
      })
      .filter((g) => g.teams.length);
  }, [conferences, teams, standings, ranks, q]);

  return (
    <>
      <PageTitle
        eyebrow="Men's college basketball · Division I"
        title="Teams"
        aside={
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a team"
            aria-label="Find a team"
            className="w-full rounded-full bg-panel2 px-3 py-1.5 font-mono text-[11px] ring-1 ring-line/10 placeholder:text-faint sm:w-56"
          />
        }
      />
      {!groups.length ? (
        <CbbEmpty>
          {isLoading ? "Loading teams…" : isError ? "Teams couldn't be loaded right now." : q ? "No team matches." : "No teams available yet."}
        </CbbEmpty>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(({ conf, teams: list }) => (
            <Panel key={conf.id} padded={false}>
              <PanelHeader title={conf.short || conf.name} aside={<span className="label-mono">Conf · All · Power</span>} />
              <div className="divide-y divide-line/5">
                {list.map((t) => (
                  <TeamRow key={t.id} team={t} row={standings.get(t.id)} power={ranks.get(t.id)?.rank} ap={rankings[t.id]} />
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function TeamRow({ team, row, power, ap }: { team: CbbTeamRef; row?: CbbStandingRow; power?: number; ap?: number }) {
  return (
    <Link to="/cbb/teams/$teamId" params={{ teamId: team.id }} className="flex items-center gap-3 px-4 py-2 hover:bg-line/5">
      <CbbLogo team={team} className="size-6" />
      <span className="min-w-0 flex-1 truncate text-sm">
        {ap ? <span className="mr-1 font-mono text-[10px] text-acc">{ap}</span> : null}
        {team.short}
      </span>
      <span className="w-10 text-right font-mono text-xs tabular-nums text-mute">{row ? recordText(row.conf) : "0-0"}</span>
      <span className="w-10 text-right font-mono text-xs tabular-nums">{row ? recordText(row.overall) : "0-0"}</span>
      <span className="w-9 text-right font-mono text-[11px] tabular-nums text-faint">{power ? `#${power}` : "—"}</span>
    </Link>
  );
}
