import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { PageTitle, Panel, PanelHeader, TeamLogo } from "@/components/booth";
import { players as sampleData, type Player } from "@/data/players";
import { teamById } from "@/data/teams";
import { getLeaguePlayers } from "@/lib/espn.functions";
import type { LeaguePlayer } from "@/lib/league-players.server";

export const Route = createFileRoute("/players/")({
  head: () => ({
    meta: [
      { title: "Player Search — GamblingNFL" },
      {
        name: "description",
        content:
          "Search NFL players by name or team and filter by position, with stats that fit each position: offense, defense, kickers and punters.",
      },
      { property: "og:title", content: "Player Search — GamblingNFL" },
      {
        property: "og:description",
        content: "Searchable player index with position-specific season stats.",
      },
    ],
  }),
  component: PlayersPage,
});

/* ---------- positions ---------- */

type Group = "offense" | "defense" | "special";

const POSITIONS: { code: string; short: string; label: string; group: Group }[] = [
  { code: "QB", short: "QB", label: "Quarterback", group: "offense" },
  { code: "RB", short: "RB", label: "Running Back", group: "offense" },
  { code: "FB", short: "FB", label: "Fullback", group: "offense" },
  { code: "WR", short: "WR", label: "Wide Receiver", group: "offense" },
  { code: "TE", short: "TE", label: "Tight End", group: "offense" },
  { code: "OT", short: "OT", label: "Offensive Tackle", group: "offense" },
  { code: "G", short: "G", label: "Guard", group: "offense" },
  { code: "C", short: "C", label: "Center", group: "offense" },
  { code: "DE", short: "DE", label: "Defensive End", group: "defense" },
  { code: "DT", short: "DT", label: "Defensive Tackle", group: "defense" },
  { code: "LB", short: "LB", label: "Linebacker", group: "defense" },
  { code: "CB", short: "CB", label: "Cornerback", group: "defense" },
  { code: "S", short: "S", label: "Safety", group: "defense" },
  { code: "PK", short: "K", label: "Kicker", group: "special" },
  { code: "P", short: "P", label: "Punter", group: "special" },
  { code: "LS", short: "LS", label: "Long Snapper", group: "special" },
];

const GROUPS: { key: Group; filter: string; label: string }[] = [
  { key: "offense", filter: "OFFENSE", label: "Offense" },
  { key: "defense", filter: "DEFENSE", label: "Defense" },
  { key: "special", filter: "SPECIAL", label: "Special teams" },
];

// ESPN uses several abbreviations for the same job; fold them into one.
const ALIASES: Record<string, string> = {
  K: "PK",
  OLB: "LB",
  ILB: "LB",
  MLB: "LB",
  NT: "DT",
  DL: "DE",
  FS: "S",
  SS: "S",
  SAF: "S",
  DB: "CB",
  OG: "G",
  LG: "G",
  RG: "G",
  T: "OT",
  LT: "OT",
  RT: "OT",
  HB: "RB",
  TB: "RB",
};

function normalizePos(pos: string): string {
  const upper = (pos || "").toUpperCase();
  return ALIASES[upper] ?? upper;
}

const groupOf = (pos: string): Group | null => POSITIONS.find((p) => p.code === pos)?.group ?? null;

/** Short label shown to people (kickers are "K", ESPN calls them "PK"). */
const shortPos = (pos: string) => POSITIONS.find((p) => p.code === pos)?.short ?? pos;

function matches(pos: string, filter: string): boolean {
  if (filter === "ALL") return true;
  if (filter === "OFFENSE") return groupOf(pos) === "offense";
  if (filter === "DEFENSE") return groupOf(pos) === "defense";
  if (filter === "SPECIAL") return groupOf(pos) === "special";
  return pos === filter;
}

/* ---------- stat columns for each kind of position ---------- */

interface Col {
  label: string;
  title: string;
  value: (p: LeaguePlayer) => number | string;
  /** Hide the column when nobody in the list has a value (e.g. forced fumbles). */
  hideIfEmpty?: boolean;
}

interface ColumnSet {
  cols: Col[];
  sort: (p: LeaguePlayer) => number;
  /** Show the usage-share bar (offense only). */
  share?: boolean;
  /** Show one text column that adapts to each player's position. */
  text?: boolean;
  /** Needs the live ESPN totals (the saved sample data doesn't have them). */
  needsLive?: boolean;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pct = (made: number, att: number) => (att > 0 ? `${Math.round((made / att) * 100)}%` : "—");

const G: Col = { label: "G", title: "Games played", value: (p) => p.games };
const TKL: Col = { label: "TKL", title: "Total tackles", value: (p) => p.tkl };
const SOLO: Col = { label: "SOLO", title: "Solo tackles", value: (p) => p.solo };
const SCK: Col = { label: "SCK", title: "Sacks", value: (p) => fmt(p.sck) };
const TFL: Col = { label: "TFL", title: "Tackles for loss", value: (p) => fmt(p.tfl) };
const QBH: Col = { label: "QBH", title: "QB hits", value: (p) => p.qbh };
const PD: Col = { label: "PD", title: "Passes defended", value: (p) => p.pd };
const INT: Col = { label: "INT", title: "Interceptions", value: (p) => p.int };
const FF: Col = { label: "FF", title: "Forced fumbles", value: (p) => p.ff, hideIfEmpty: true };
const DTD: Col = { label: "TD", title: "Defensive touchdowns", value: (p) => p.dtd, hideIfEmpty: true };

const SETS = {
  generic: { cols: [G], text: true, sort: (p) => p.yards * 1000 + p.tkl + p.fgm + p.punts },
  offense: {
    cols: [
      G,
      { label: "YDS", title: "Passing + rushing + receiving yards", value: (p) => p.yards.toLocaleString() },
      { label: "TD", title: "Touchdowns", value: (p) => p.tds },
      { label: "Y/G", title: "Yards per game", value: (p) => (p.yards / Math.max(1, p.games)).toFixed(1) },
    ],
    share: true,
    sort: (p) => p.yards * 1000 + p.tds,
  },
  line: { cols: [G], sort: (p) => p.games },
  dl: {
    cols: [G, SCK, TFL, QBH, TKL, SOLO, PD, FF],
    needsLive: true,
    sort: (p) => p.sck * 1000 + p.tfl * 10 + p.tkl,
  },
  lb: {
    cols: [G, TKL, SOLO, TFL, SCK, PD, INT, FF],
    needsLive: true,
    sort: (p) => p.tkl * 1000 + p.sck * 10 + p.tfl,
  },
  db: {
    cols: [G, TKL, SOLO, INT, PD, TFL, DTD],
    needsLive: true,
    sort: (p) => p.int * 100000 + p.pd * 1000 + p.tkl,
  },
  defense: {
    cols: [G, TKL, SOLO, SCK, TFL, QBH, PD, INT, FF, DTD],
    needsLive: true,
    sort: (p) => p.tkl * 1000 + p.sck * 10 + p.int,
  },
  kicker: {
    cols: [
      G,
      { label: "FG", title: "Field goals made / attempted", value: (p) => `${p.fgm}/${p.fga}` },
      { label: "FG%", title: "Field goal percentage", value: (p) => pct(p.fgm, p.fga) },
      { label: "LNG", title: "Longest field goal", value: (p) => p.fgLong },
      { label: "XP", title: "Extra points made / attempted", value: (p) => `${p.xpm}/${p.xpa}` },
      { label: "PTS", title: "Kicking points", value: (p) => p.kpts || p.fgm * 3 + p.xpm },
    ],
    needsLive: true,
    sort: (p) => p.fgm * 1000 + p.xpm,
  },
  punter: {
    cols: [
      G,
      { label: "PUNTS", title: "Punts", value: (p) => p.punts },
      { label: "YDS", title: "Punt yards", value: (p) => p.puntYds.toLocaleString() },
      {
        label: "AVG",
        title: "Average yards per punt",
        value: (p) => (p.punts > 0 ? (p.puntYds / p.punts).toFixed(1) : "—"),
      },
      { label: "LNG", title: "Longest punt", value: (p) => p.puntLong },
      { label: "IN20", title: "Punts inside the 20", value: (p) => p.in20 },
    ],
    needsLive: true,
    sort: (p) => p.punts * 1000 + p.puntYds,
  },
  longSnapper: { cols: [G, TKL], sort: (p) => p.games * 1000 + p.tkl },
} satisfies Record<string, ColumnSet>;

type SetKey = keyof typeof SETS;

function setFor(filter: string): SetKey {
  switch (filter) {
    case "OFFENSE":
    case "QB":
    case "RB":
    case "FB":
    case "WR":
    case "TE":
      return "offense";
    case "OT":
    case "G":
    case "C":
      return "line";
    case "DE":
    case "DT":
      return "dl";
    case "LB":
      return "lb";
    case "CB":
    case "S":
      return "db";
    case "DEFENSE":
      return "defense";
    case "PK":
      return "kicker";
    case "P":
      return "punter";
    case "LS":
      return "longSnapper";
    default:
      return "generic"; // All players, Special teams
  }
}

/** One short line that fits the player's position (used when positions are mixed). */
function statsText(p: LeaguePlayer, pos: string): string {
  const group = groupOf(pos);
  const parts: string[] = [];
  if (group === "offense") {
    if (p.yards || p.tds) parts.push(`${p.yards.toLocaleString()} yds`, `${p.tds} TD`);
  } else if (pos === "PK") {
    if (p.fga || p.xpa) parts.push(`${p.fgm}/${p.fga} FG`, `${p.xpm}/${p.xpa} XP`);
  } else if (pos === "P") {
    if (p.punts) parts.push(`${p.punts} punts`, `${(p.puntYds / p.punts).toFixed(1)} avg`);
  } else {
    if (p.tkl) parts.push(`${p.tkl} TKL`);
    if (p.sck) parts.push(`${fmt(p.sck)} SCK`);
    if (p.int) parts.push(`${p.int} INT`);
    if (p.pd) parts.push(`${p.pd} PD`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

/** The saved sample data only knows yards, touchdowns and one "touches" number. */
function fromSample(p: Player): LeaguePlayer {
  const pos = normalizePos(p.position);
  const group = groupOf(pos);
  const touches = p.season.touches;
  return {
    id: p.id,
    name: `${p.firstName} ${p.lastName}`,
    teamId: p.teamId,
    position: p.position,
    games: p.season.games,
    yards: p.season.yards,
    tds: p.season.tds,
    tkl: group === "defense" || pos === "LS" ? touches : 0,
    solo: 0,
    sck: 0,
    tfl: 0,
    qbh: 0,
    pd: 0,
    int: 0,
    ff: 0,
    dtd: 0,
    fgm: pos === "PK" ? touches : 0,
    fga: 0,
    fgLong: 0,
    xpm: 0,
    xpa: 0,
    kpts: 0,
    punts: 0,
    puntYds: 0,
    in20: 0,
    puntLong: 0,
  };
}

/* ---------- page ---------- */

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 font-mono text-[11px] ring-1 ${
        active ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10"
      }`}
    >
      {children}
    </button>
  );
}

function PlayersPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [limit, setLimit] = useState(150);

  const { data: live, isError } = useQuery<LeaguePlayer[]>({
    queryKey: ["league-players"],
    queryFn: () => getLeaguePlayers(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const sampleRows = useMemo(() => sampleData.map(fromSample), []);
  const samplePosition = useMemo(
    () => new Map(sampleData.map((p) => [p.id, p.position])),
    [],
  );
  const usingLive = !!live && live.length > 0;
  const source = usingLive ? live : sampleRows;

  const pick = (next: string) => {
    setFilter(next);
    setLimit(150);
  };

  const setKey = setFor(filter);
  const set: ColumnSet = SETS[setKey];
  const waitingForLive = set.needsLive && !usingLive;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source
      .map((p) => {
        const raw = !p.position || p.position === "ATH" ? (samplePosition.get(p.id) ?? "ATH") : p.position;
        return { p, pos: normalizePos(raw) };
      })
      .filter(({ pos }) => matches(pos, filter))
      .filter(({ p }) => {
        if (!q) return true;
        const team = teamById(p.teamId);
        return (
          p.name.toLowerCase().includes(q) ||
          (team ? `${team.city} ${team.name} ${team.abbr}`.toLowerCase().includes(q) : false)
        );
      })
      .sort((a, b) => set.sort(b.p) - set.sort(a.p) || b.p.games - a.p.games);
  }, [source, samplePosition, query, filter, set]);

  const cols = set.cols.filter(
    (c) => !c.hideIfEmpty || rows.some(({ p }) => c.value(p) !== 0),
  );
  const maxYards = rows.reduce((m, { p }) => Math.max(m, p.yards), 0) || 1;

  return (
    <>
      <PageTitle
        eyebrow="Player index"
        title="Players"
        aside={
          <span className="label-mono">
            {usingLive
              ? `${source.length} players · ESPN 2026`
              : isError
                ? "Live stats unavailable · showing saved data"
                : "Loading live stats…"}
          </span>
        }
      />
      <Panel padded={false}>
        <PanelHeader
          title="Search"
          aside={
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="rounded-lg bg-panel2 px-3 py-1.5 text-sm text-ink ring-1 ring-line/10 outline-none placeholder:text-faint focus:ring-acc/40"
              placeholder="Search players or teams…"
              aria-label="Search players"
            />
          }
        />

        <div className="space-y-3 border-b border-line/10 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip active={filter === "ALL"} onClick={() => pick("ALL")}>
              All
            </Chip>
          </div>
          {GROUPS.map((g) => (
            <div key={g.filter} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => pick(g.filter)}
                aria-pressed={filter === g.filter}
                className={`w-28 text-left font-mono text-[10px] uppercase tracking-wider ${
                  filter === g.filter ? "text-acc" : "text-faint hover:text-acc"
                }`}
              >
                {g.label}
              </button>
              {POSITIONS.filter((p) => p.group === g.key).map((p) => (
                <Chip
                  key={p.code}
                  active={filter === p.code}
                  onClick={() => pick(p.code)}
                  title={p.label}
                >
                  {p.short}
                </Chip>
              ))}
            </div>
          ))}
        </div>

        {waitingForLive ? (
          <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
            {isError
              ? "Live ESPN stats are unavailable right now. Try again in a minute."
              : "Loading live stats from ESPN…"}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Team</th>
                    <th className="px-2 py-2 font-normal">Player</th>
                    <th className="px-2 py-2 font-normal">Pos</th>
                    {cols.map((c) => (
                      <th key={c.label} title={c.title} className="px-2 py-2 text-right font-normal">
                        {c.label}
                      </th>
                    ))}
                    {set.text ? <th className="px-4 py-2 font-normal">Stats</th> : null}
                    {set.share ? <th className="px-4 py-2 font-normal">Share</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {rows.slice(0, limit).map(({ p, pos }) => {
                    const team = teamById(p.teamId);
                    return (
                      <tr key={p.id} className="hover:bg-line/5">
                        <td className="px-4 py-2.5">
                          {team ? (
                            <Link
                              to="/teams/$teamId"
                              params={{ teamId: team.id }}
                              className="inline-flex"
                              title={`${team.city} ${team.name}`}
                              aria-label={`${team.city} ${team.name}`}
                            >
                              <TeamLogo team={team} className="size-6" />
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <Link
                            to="/players/$playerId"
                            params={{ playerId: p.id }}
                            className="font-medium hover:text-acc"
                          >
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-[11px] text-mute">{shortPos(pos)}</td>
                        {cols.map((c) => (
                          <td key={c.label} className="px-2 py-2.5 text-right font-mono tabular-nums">
                            {c.value(p)}
                          </td>
                        ))}
                        {set.text ? (
                          <td className="px-4 py-2.5 font-mono text-[12px] text-mute">
                            {statsText(p, pos)}
                          </td>
                        ) : null}
                        {set.share ? (
                          <td className="px-4 py-2.5">
                            <div className="h-1.5 w-24 rounded-full bg-panel2">
                              <div
                                className="h-1.5 rounded-full bg-acc"
                                style={{ width: `${Math.round((p.yards / maxYards) * 100)}%` }}
                              />
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > limit ? (
              <button
                onClick={() => setLimit((l) => l + 150)}
                className="w-full px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5"
              >
                Show more ({rows.length - limit} remaining)
              </button>
            ) : null}
            {rows.length === 0 ? (
              <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
                No players match that search.
              </p>
            ) : null}
          </>
        )}
      </Panel>
    </>
  );
}
