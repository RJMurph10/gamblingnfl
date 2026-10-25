/** Searchable NBA player table with per-game averages. */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { Chip, NbaLogo } from "@/components/nba/NbaBits";
import { nbaHeadshot, type NbaPlayer } from "@/lib/nba";
import { useNbaPlayerIndex, useNbaTeams } from "@/lib/use-nba";

type Group = "ALL" | "G" | "F" | "C";
const GROUPS: { id: Group; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "G", label: "Guards" },
  { id: "F", label: "Forwards" },
  { id: "C", label: "Centers" },
];

const inGroup = (pos: string, g: Group) => {
  if (g === "ALL") return true;
  const parts = pos.toUpperCase().split(/[-/]/);
  if (g === "G") return parts.some((p) => p === "G" || p === "PG" || p === "SG");
  if (g === "F") return parts.some((p) => p === "F" || p === "SF" || p === "PF");
  return parts.includes("C");
};

type SortKey = "pts" | "reb" | "ast" | "stl" | "blk" | "min" | "gp" | "fgPct" | "fg3Pct" | "name";

const COLS: { key: SortKey; label: string; title: string; value: (p: NbaPlayer) => string }[] = [
  { key: "gp", label: "GP", title: "Games played", value: (p) => (p.avg ? String(p.avg.gp) : "—") },
  { key: "min", label: "MIN", title: "Minutes per game", value: (p) => (p.avg ? p.avg.min.toFixed(1) : "—") },
  { key: "pts", label: "PTS", title: "Points per game", value: (p) => (p.avg ? p.avg.pts.toFixed(1) : "—") },
  { key: "reb", label: "REB", title: "Rebounds per game", value: (p) => (p.avg ? p.avg.reb.toFixed(1) : "—") },
  { key: "ast", label: "AST", title: "Assists per game", value: (p) => (p.avg ? p.avg.ast.toFixed(1) : "—") },
  { key: "stl", label: "STL", title: "Steals per game", value: (p) => (p.avg ? p.avg.stl.toFixed(1) : "—") },
  { key: "blk", label: "BLK", title: "Blocks per game", value: (p) => (p.avg ? p.avg.blk.toFixed(1) : "—") },
  { key: "fgPct", label: "FG%", title: "Field goal percentage", value: (p) => (p.avg?.fgPct == null ? "—" : (p.avg.fgPct * 100).toFixed(1)) },
  { key: "fg3Pct", label: "3P%", title: "Three-point percentage", value: (p) => (p.avg?.fg3Pct == null ? "—" : (p.avg.fg3Pct * 100).toFixed(1)) },
];

function sortValue(p: NbaPlayer, key: SortKey): number | string {
  if (key === "name") return p.name;
  const v = p.avg?.[key];
  return v === null || v === undefined ? -1 : v;
}

export function NbaPlayersIndex() {
  const q = useNbaPlayerIndex();
  const { teams } = useNbaTeams();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group>("ALL");
  const [teamId, setTeamId] = useState("");
  const [sort, setSort] = useState<SortKey>("pts");
  const [limit, setLimit] = useState(100);

  const players = q.data?.players ?? [];
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return players
      .filter((p) => inGroup(p.position, group))
      .filter((p) => !teamId || p.teamId === teamId)
      .filter(
        (p) =>
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          p.teamAbbr.toLowerCase().includes(needle) ||
          (teamById.get(p.teamId)?.name.toLowerCase().includes(needle) ?? false),
      )
      .sort((a, b) => {
        const av = sortValue(a, sort);
        const bv = sortValue(b, sort);
        return sort === "name" ? String(av).localeCompare(String(bv)) : (bv as number) - (av as number) || a.name.localeCompare(b.name);
      });
  }, [players, query, group, teamId, sort, teamById]);

  const label = q.data
    ? `${players.length.toLocaleString()} players · ESPN ${q.data.statsSeason - 1}-${String(q.data.statsSeason).slice(2)} averages`
    : q.isError
      ? "Player data unavailable"
      : "Loading players…";

  return (
    <>
      <PageTitle eyebrow="Player index · NBA" title="Players" aside={<span className="rounded-lg bg-panel px-3 py-1 font-mono text-[11px] text-mute">{label}</span>} />
      <Panel padded={false}>
        <PanelHeader
          title="Search"
          aside={
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(100);
              }}
              className="rounded-lg bg-panel2 px-3 py-1.5 text-sm text-ink ring-1 ring-line/10 outline-none placeholder:text-faint focus:ring-acc/40"
              placeholder="Search players or teams…"
              aria-label="Search players"
            />
          }
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-line/10 px-4 py-3">
          {GROUPS.map((g) => (
            <Chip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </Chip>
          ))}
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            aria-label="Filter by team"
            className="ml-auto rounded-lg bg-panel2 px-3 py-1.5 text-sm text-ink ring-1 ring-line/10 outline-none focus:ring-acc/40"
          >
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {!players.length ? (
          <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
            {q.isError ? "Live ESPN data is unavailable right now. Try again in a minute." : "Loading players from ESPN…"}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Team</th>
                    <th className="px-2 py-2 font-normal">
                      <button type="button" onClick={() => setSort("name")} className={sort === "name" ? "text-acc" : "hover:text-acc"}>Player</button>
                    </th>
                    <th className="px-2 py-2 font-normal">Pos</th>
                    {COLS.map((c) => (
                      <th key={c.key} title={c.title} className="px-2 py-2 text-right font-normal">
                        <button type="button" onClick={() => setSort(c.key)} className={sort === c.key ? "text-acc" : "hover:text-acc"}>{c.label}</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {rows.slice(0, limit).map((p) => {
                    const t = teamById.get(p.teamId);
                    return (
                      <tr key={p.id} className="hover:bg-line/5">
                        <td className="px-4 py-2.5">
                          {t ? (
                            <Link to="/nba/teams/$teamId" params={{ teamId: t.id }} className="inline-flex" title={t.name} aria-label={t.name}>
                              <NbaLogo team={t} className="size-6" />
                            </Link>
                          ) : (
                            <span className="font-mono text-[10px] text-faint">{p.teamAbbr}</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <Link to="/nba/players/$playerId" params={{ playerId: p.id }} className="inline-flex items-center gap-2 font-medium hover:text-acc">
                            <img src={p.headshot || nbaHeadshot(p.id)} alt="" loading="lazy" className="size-7 rounded-full bg-panel2 object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                            {p.name}
                            {p.status ? <span className="font-mono text-[9px] uppercase text-loss">{p.status}</span> : null}
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[11px] text-mute">{p.position}</td>
                        {COLS.map((c) => (
                          <td key={c.key} className={`px-2 py-2.5 text-right font-mono tabular-nums ${sort === c.key ? "text-acc" : ""}`}>
                            {c.value(p)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > limit ? (
              <button onClick={() => setLimit((l) => l + 150)} className="w-full px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5">
                Show more ({rows.length - limit} remaining)
              </button>
            ) : null}
            {rows.length === 0 ? <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">No players match that search.</p> : null}
          </>
        )}
      </Panel>
    </>
  );
}
