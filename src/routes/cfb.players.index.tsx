import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader, TeamLogo } from "@/components/booth";
import { teamById } from "@/data/teams";
import { getCfbConferencePlayers } from "@/lib/cfb.functions";
import type { CfbIndexPlayer } from "@/lib/espn.server";
import { teamShort } from "@/lib/league-links";
import { useCfbConferences } from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/players/")({
  head: () => ({
    meta: [
      { title: "Player Search — GamblingCFB" },
      {
        name: "description",
        content:
          "Search FBS players by conference, team, name and position, with season passing, rushing, receiving and defensive totals.",
      },
    ],
  }),
  component: CfbPlayersPage,
});

type Group = "all" | "QB" | "RB" | "WR/TE" | "DEF" | "ST";

const GROUPS: { key: Group; label: string }[] = [
  { key: "all", label: "All" },
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR/TE", label: "WR / TE" },
  { key: "DEF", label: "Defense" },
  { key: "ST", label: "Special teams" },
];

const DEF = new Set([
  "DE",
  "DT",
  "DL",
  "NT",
  "LB",
  "OLB",
  "ILB",
  "MLB",
  "CB",
  "S",
  "SS",
  "FS",
  "DB",
  "EDGE",
]);
const ST = new Set(["K", "PK", "P", "LS"]);

function groupOf(position: string): Exclude<Group, "all"> | "OL" {
  const p = position.toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB" || p === "FB" || p === "HB" || p === "TB") return "RB";
  if (p === "WR" || p === "TE") return "WR/TE";
  if (DEF.has(p)) return "DEF";
  if (ST.has(p)) return "ST";
  return "OL";
}

const num = (n: number) => n.toLocaleString();

/** Columns for a position group: [label, title, value]. */
function columns(group: Group): [string, string, (s: CfbIndexPlayer["stats"]) => string][] {
  switch (group) {
    case "QB":
      return [
        ["C/ATT", "Completions / attempts", (s) => `${s.cmp}/${s.att}`],
        ["PYDS", "Passing yards", (s) => num(s.passYds)],
        ["PTD", "Passing touchdowns", (s) => num(s.passTd)],
        ["INT", "Interceptions thrown", (s) => num(s.int)],
        ["RUYDS", "Rushing yards", (s) => num(s.rushYds)],
        ["RUTD", "Rushing touchdowns", (s) => num(s.rushTd)],
      ];
    case "RB":
      return [
        ["CAR", "Rushing attempts", (s) => num(s.rushAtt)],
        ["RUYDS", "Rushing yards", (s) => num(s.rushYds)],
        ["YPC", "Yards per carry", (s) => (s.rushAtt ? (s.rushYds / s.rushAtt).toFixed(1) : "—")],
        ["RUTD", "Rushing touchdowns", (s) => num(s.rushTd)],
        ["REC", "Receptions", (s) => num(s.rec)],
        ["REYDS", "Receiving yards", (s) => num(s.recYds)],
      ];
    case "WR/TE":
      return [
        ["REC", "Receptions", (s) => num(s.rec)],
        ["REYDS", "Receiving yards", (s) => num(s.recYds)],
        ["YPR", "Yards per reception", (s) => (s.rec ? (s.recYds / s.rec).toFixed(1) : "—")],
        ["RETD", "Receiving touchdowns", (s) => num(s.recTd)],
        ["RUYDS", "Rushing yards", (s) => num(s.rushYds)],
      ];
    case "DEF":
      return [
        ["TKL", "Total tackles", (s) => num(s.tackles)],
        ["SACK", "Sacks", (s) => (Number.isInteger(s.sacks) ? num(s.sacks) : s.sacks.toFixed(1))],
        ["INT", "Interceptions", (s) => num(s.defInt)],
      ];
    default:
      return [];
  }
}

/** One line of the stats that matter for a player, e.g. "2,145 pass yds · 18 TD · 4 INT". */
function statLine(p: CfbIndexPlayer): string {
  const s = p.stats;
  const parts: string[] = [];
  if (s.att) parts.push(`${num(s.passYds)} pass yds · ${s.passTd} TD · ${s.int} INT`);
  if (s.rushAtt) parts.push(`${num(s.rushYds)} rush yds · ${s.rushTd} TD`);
  if (s.rec) parts.push(`${s.rec} rec · ${num(s.recYds)} yds · ${s.recTd} TD`);
  if (s.tackles || s.sacks || s.defInt)
    parts.push(
      [
        s.tackles ? `${s.tackles} tkl` : "",
        s.sacks ? `${s.sacks} sk` : "",
        s.defInt ? `${s.defInt} INT` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  return parts.join(" | ") || "—";
}

/** Rough production score, to put the season's most productive players first. */
const production = (s: CfbIndexPlayer["stats"]) =>
  s.passYds +
  s.rushYds +
  s.recYds +
  (s.passTd + s.rushTd + s.recTd) * 20 +
  s.tackles * 8 +
  s.sacks * 40 +
  s.defInt * 60;

function CfbPlayersPage() {
  const { conferences, isLoading: confLoading } = useCfbConferences();
  const [picked, setPicked] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("all");
  const [search, setSearch] = useState("");
  // Site teams carry the conference's short name (or full name when ESPN has none).
  const keyOf = (c: { abbr: string; name: string }) => c.abbr || c.name;
  const fallback = conferences.find((c) => /southeastern/i.test(c.name)) ?? conferences[0];
  const key = picked ?? (fallback ? keyOf(fallback) : "");
  const confKey = conferences.find((c) => keyOf(c) === key);

  const query = useQuery({
    queryKey: ["cfb-conference-players", key],
    queryFn: () => getCfbConferencePlayers({ data: { conference: key } }),
    enabled: Boolean(key),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (
      (query.data ?? [])
        // "All" leaves out linemen (no stats) unless you're searching for someone.
        .filter((p) =>
          group === "all"
            ? groupOf(p.position) !== "OL" || q !== ""
            : groupOf(p.position) === group,
        )
        .filter((p) => {
          if (!q) return true;
          const team = teamById(p.teamId);
          return [p.name, team?.city, team?.name, team?.abbr, p.position]
            .filter(Boolean)
            .some((x) => String(x).toLowerCase().includes(q));
        })
        .sort((a, b) => production(b.stats) - production(a.stats) || a.name.localeCompare(b.name))
    );
  }, [query.data, group, search]);
  const cols = columns(group);
  const shown = rows.slice(0, 200);

  return (
    <>
      <PageTitle eyebrow="Player index · FBS" title="Players" />
      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line/10 px-4 py-3">
          <select
            value={key}
            onChange={(e) => setPicked(e.target.value)}
            aria-label="Conference"
            className="rounded-lg bg-panel2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink ring-1 ring-line/10"
          >
            {conferences.map((c) => (
              <option key={c.id} value={keyOf(c)}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players or teams…"
            className="min-w-[200px] flex-1 rounded-lg bg-panel2 px-3 py-1.5 text-sm text-ink ring-1 ring-line/10 outline-none placeholder:text-faint focus:ring-acc/40"
          />
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGroup(g.key)}
                aria-pressed={group === g.key}
                className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                  group === g.key
                    ? "bg-acc/10 text-acc ring-acc/25"
                    : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <PanelHeader
          title={confKey?.name ?? "Players"}
          aside={
            <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
              {query.data ? `${rows.length} players · most productive first` : ""}
            </span>
          }
        />
        {confLoading || query.isLoading ? (
          <p className="px-4 py-8 text-center font-mono text-xs text-mute">
            Loading rosters and season stats… (the first load of a conference takes a moment)
          </p>
        ) : !rows.length ? (
          <p className="px-4 py-8 text-center font-mono text-xs text-mute">
            {query.isError ? "Players couldn't be loaded right now." : "No players match."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Team</th>
                  <th className="px-2 py-2 font-normal">Player</th>
                  <th className="px-2 py-2 font-normal">Pos</th>
                  <th className="px-2 py-2 text-right font-normal" title="Games with a stat">
                    GP
                  </th>
                  {cols.map(([label, title]) => (
                    <th key={label} title={title} className="px-2 py-2 text-right font-normal">
                      {label}
                    </th>
                  ))}
                  {cols.length ? null : <th className="px-4 py-2 font-normal">Season</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {shown.map((p) => {
                  const team = teamById(p.teamId);
                  return (
                    <tr key={`${p.teamId}-${p.id}`} className="hover:bg-line/5">
                      <td className="px-4 py-2">
                        {team ? (
                          <Link
                            to="/cfb/teams/$teamId"
                            params={{ teamId: team.id }}
                            className="inline-flex items-center gap-2 hover:text-acc"
                          >
                            <TeamLogo team={team} className="size-5" />
                            <span className="font-mono text-[11px] text-mute">
                              {teamShort(team)}
                            </span>
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          to="/cfb/players/$playerId"
                          params={{ playerId: p.id }}
                          className="font-medium hover:text-acc"
                        >
                          {p.name}
                        </Link>
                        {p.jersey ? (
                          <span className="ml-2 font-mono text-[10px] text-faint">#{p.jersey}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 font-mono text-mute">{p.position}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-mute">
                        {p.stats.gp || "—"}
                      </td>
                      {cols.map(([label, , value]) => (
                        <td key={label} className="px-2 py-2 text-right font-mono tabular-nums">
                          {value(p.stats)}
                        </td>
                      ))}
                      {cols.length ? null : (
                        <td className="px-4 py-2 font-mono text-[11px] text-mute">{statLine(p)}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > shown.length ? (
          <p className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-faint">
            Showing the top 200 · search or pick a position to narrow it down
          </p>
        ) : null}
      </Panel>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
        Rosters from ESPN · season totals from this season&apos;s box scores
      </p>
    </>
  );
}
