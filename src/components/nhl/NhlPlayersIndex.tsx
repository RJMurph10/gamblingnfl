/** Searchable NHL player table with season totals (skater and goalie columns). */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { Chip, NhlLogo } from "@/components/nhl/NhlBits";
import { nhlHeadshot, posGroup, teamsFromGames, type NhlPlayer, type NhlPlayerStats } from "@/lib/nhl/nhl";
import { useNhlPlayerIndex, useNhlSchedule } from "@/lib/nhl/use-nhl";

type Group = "ALL" | "F" | "D" | "G";
const GROUPS: { id: Group; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "F", label: "Forwards" },
  { id: "D", label: "Defense" },
  { id: "G", label: "Goalies" },
];

interface Col {
  key: string;
  label: string;
  title: string;
  get: (s: NhlPlayerStats) => number | null;
  fmt: (v: number) => string;
}

const int = (v: number) => String(Math.round(v));
const one = (v: number) => v.toFixed(1);
const toi = (v: number) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`;
const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)));
const pct = (v: number) => (v * 100).toFixed(1);
const sv = (v: number) => v.toFixed(3).replace(/^0/, "");

const SKATER: Col[] = [
  { key: "gp", label: "GP", title: "Games played", get: (s) => s.gp, fmt: int },
  { key: "toi", label: "TOI", title: "Time on ice per game", get: (s) => s.toi, fmt: toi },
  { key: "goals", label: "G", title: "Goals", get: (s) => s.goals, fmt: int },
  { key: "assists", label: "A", title: "Assists", get: (s) => s.assists, fmt: int },
  { key: "points", label: "PTS", title: "Points", get: (s) => s.points, fmt: int },
  { key: "plusMinus", label: "+/-", title: "Plus/minus", get: (s) => s.plusMinus, fmt: signed },
  { key: "shots", label: "SOG", title: "Shots on goal", get: (s) => s.shots, fmt: int },
  { key: "shootingPct", label: "S%", title: "Shooting percentage", get: (s) => s.shootingPct, fmt: pct },
  { key: "pim", label: "PIM", title: "Penalty minutes", get: (s) => s.pim, fmt: int },
];

const GOALIE: Col[] = [
  { key: "gp", label: "GP", title: "Games played", get: (s) => s.gp, fmt: int },
  { key: "gs", label: "GS", title: "Games started", get: (s) => s.gs, fmt: int },
  { key: "wins", label: "W", title: "Wins", get: (s) => s.wins, fmt: int },
  { key: "losses", label: "L", title: "Losses", get: (s) => s.losses, fmt: int },
  { key: "otLosses", label: "OTL", title: "Overtime losses", get: (s) => s.otLosses, fmt: int },
  { key: "savePct", label: "SV%", title: "Save percentage", get: (s) => s.savePct, fmt: sv },
  { key: "gaa", label: "GAA", title: "Goals against average", get: (s) => s.gaa, fmt: (v) => v.toFixed(2) },
  { key: "saves", label: "SV", title: "Saves", get: (s) => s.saves, fmt: int },
  { key: "shutouts", label: "SO", title: "Shutouts", get: (s) => s.shutouts, fmt: int },
];

const inGroup = (pos: string, g: Group) => g === "ALL" || posGroup(pos) === g;

export function NhlPlayersIndex() {
  const q = useNhlPlayerIndex();
  const { games } = useNhlSchedule(false);
  const teams = useMemo(() => teamsFromGames(games), [games]);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group>("ALL");
  const [teamId, setTeamId] = useState("");
  const [sort, setSort] = useState("points");
  const [limit, setLimit] = useState(100);

  const cols = group === "G" ? GOALIE : SKATER;
  const players = q.data?.players ?? [];
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const col = cols.find((c) => c.key === sort);
    const value = (p: NhlPlayer) => (col && p.stats ? (col.get(p.stats) ?? -Infinity) : -Infinity);
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
      .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : value(b) - value(a) || a.name.localeCompare(b.name)));
  }, [players, query, group, teamId, sort, teamById, cols]);

  const pickGroup = (g: Group) => {
    setGroup(g);
    setSort(g === "G" ? "wins" : "points");
    setLimit(100);
  };

  const label = q.data
    ? `${players.length.toLocaleString()} players · ESPN ${q.data.statsSeason - 1}-${String(q.data.statsSeason).slice(2)} season totals`
    : q.isError
      ? "Player data unavailable"
      : "Loading players…";

  return (
    <>
      <PageTitle
        eyebrow="Player index · NHL"
        title="Players"
        aside={<span className="rounded-lg bg-panel px-3 py-1 font-mono text-[11px] text-mute">{label}</span>}
      />
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
            <Chip key={g.id} active={group === g.id} onClick={() => pickGroup(g.id)}>
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
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Team</th>
                    <th className="px-2 py-2 font-normal">
                      <button type="button" onClick={() => setSort("name")} className={sort === "name" ? "text-acc" : "hover:text-acc"}>
                        Player
                      </button>
                    </th>
                    <th className="px-2 py-2 font-normal">Pos</th>
                    {cols.map((c) => (
                      <th key={c.key} title={c.title} className="px-2 py-2 text-right font-normal">
                        <button type="button" onClick={() => setSort(c.key)} className={sort === c.key ? "text-acc" : "hover:text-acc"}>
                          {c.label}
                        </button>
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
                            <Link to="/nhl/teams/$teamId" params={{ teamId: t.id }} className="inline-flex" title={t.name} aria-label={t.name}>
                              <NhlLogo team={t} className="size-6" />
                            </Link>
                          ) : (
                            <span className="font-mono text-[10px] text-faint">{p.teamAbbr}</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <Link
                            to="/nhl/players/$playerId"
                            params={{ playerId: p.id }}
                            className="inline-flex items-center gap-2 font-medium hover:text-acc"
                          >
                            <img
                              src={p.headshot || nhlHeadshot(p.id)}
                              alt=""
                              loading="lazy"
                              className="size-7 rounded-full bg-panel2 object-cover"
                              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                            />
                            {p.name}
                            {p.status ? <span className="font-mono text-[9px] uppercase text-loss">{p.status}</span> : null}
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[11px] text-mute">{p.position}</td>
                        {cols.map((c) => {
                          const v = p.stats ? c.get(p.stats) : null;
                          return (
                            <td key={c.key} className={`px-2 py-2.5 text-right font-mono tabular-nums ${sort === c.key ? "text-acc" : ""}`}>
                              {v === null ? "—" : c.fmt(v)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > limit ? (
              <button
                type="button"
                onClick={() => setLimit((l) => l + 150)}
                className="w-full px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5"
              >
                Show more ({rows.length - limit} remaining)
              </button>
            ) : null}
            {rows.length === 0 ? (
              <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">No players match that search.</p>
            ) : null}
            {group === "G" && rows.every((p) => !p.stats) ? (
              <p className="px-4 py-3 text-xs text-mute">ESPN&apos;s stat feed has no goalie numbers right now.</p>
            ) : null}
          </>
        )}
      </Panel>
    </>
  );
}
