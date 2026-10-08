import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader, StatCard, TeamLogo, TeamMark } from "@/components/booth";
import { getPlayerGameLog, getPlayerProfile } from "@/lib/espn.functions";
import type { PlayerProfile } from "@/lib/espn.server";
import type { PlayerGameLogEntry } from "@/lib/league-players.server";
import { teamById } from "@/data/teams";

/* ---------- game log columns: what to show depends on the position ---------- */

type Stats = Record<string, number>;

interface Col {
  group: string;
  label: string;
  title: string;
  /** Number used to decide whether the column has any data. */
  raw: (s: Stats) => number;
  /** Text shown in the cell (defaults to the number). */
  text?: (s: Stats) => string;
  /** Always shown for this position, even if every game is zero. */
  core?: boolean;
}

const g = (s: Stats, key: string) => s[key] ?? 0;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const avg = (yards: number, count: number) => (count > 0 ? (yards / count).toFixed(1) : "—");

const passing = (): Col[] => [
  { group: "Passing", label: "C/ATT", title: "Completions / attempts", core: true, raw: (s) => g(s, "pa"), text: (s) => `${g(s, "pc")}/${g(s, "pa")}` },
  { group: "Passing", label: "YDS", title: "Passing yards", core: true, raw: (s) => g(s, "passing.passingYards") },
  { group: "Passing", label: "TD", title: "Passing touchdowns", core: true, raw: (s) => g(s, "passing.passingTouchdowns") },
  { group: "Passing", label: "INT", title: "Interceptions thrown", core: true, raw: (s) => g(s, "passing.interceptions") },
  { group: "Passing", label: "RTG", title: "Passer rating", raw: (s) => g(s, "passing.QBRating"), text: (s) => g(s, "passing.QBRating").toFixed(1) },
];

const rushing = (core: boolean): Col[] => [
  { group: "Rushing", label: "CAR", title: "Carries", core, raw: (s) => g(s, "rushing.rushingAttempts") },
  { group: "Rushing", label: "YDS", title: "Rushing yards", core, raw: (s) => g(s, "rushing.rushingYards") },
  { group: "Rushing", label: "AVG", title: "Yards per carry", core, raw: (s) => g(s, "rushing.rushingAttempts"), text: (s) => avg(g(s, "rushing.rushingYards"), g(s, "rushing.rushingAttempts")) },
  { group: "Rushing", label: "TD", title: "Rushing touchdowns", core, raw: (s) => g(s, "rushing.rushingTouchdowns") },
];

const receiving = (core: boolean): Col[] => [
  { group: "Receiving", label: "REC", title: "Receptions", core, raw: (s) => g(s, "receiving.receptions") },
  { group: "Receiving", label: "TGT", title: "Targets", raw: (s) => g(s, "receiving.receivingTargets") },
  { group: "Receiving", label: "YDS", title: "Receiving yards", core, raw: (s) => g(s, "receiving.receivingYards") },
  { group: "Receiving", label: "AVG", title: "Yards per catch", core, raw: (s) => g(s, "receiving.receptions"), text: (s) => avg(g(s, "receiving.receivingYards"), g(s, "receiving.receptions")) },
  { group: "Receiving", label: "TD", title: "Receiving touchdowns", core, raw: (s) => g(s, "receiving.receivingTouchdowns") },
];

const defense = (core: string[]): Col[] => {
  const all: (Col & { key: string })[] = [
    { key: "SCK", group: "Defense", label: "SCK", title: "Sacks", raw: (s) => g(s, "defensive.sacks"), text: (s) => fmt(g(s, "defensive.sacks")) },
    { key: "TFL", group: "Defense", label: "TFL", title: "Tackles for loss", raw: (s) => g(s, "defensive.tacklesForLoss"), text: (s) => fmt(g(s, "defensive.tacklesForLoss")) },
    { key: "QBH", group: "Defense", label: "QBH", title: "QB hits", raw: (s) => g(s, "defensive.QBHits") },
    { key: "TKL", group: "Defense", label: "TKL", title: "Total tackles", raw: (s) => g(s, "defensive.totalTackles") },
    { key: "SOLO", group: "Defense", label: "SOLO", title: "Solo tackles", raw: (s) => g(s, "defensive.soloTackles") },
    { key: "INT", group: "Defense", label: "INT", title: "Interceptions", raw: (s) => g(s, "interceptions.interceptions") },
    { key: "PD", group: "Defense", label: "PD", title: "Passes defended", raw: (s) => g(s, "defensive.passesDefended") },
    { key: "FF", group: "Defense", label: "FF", title: "Forced fumbles", raw: (s) => g(s, "defensive.forcedFumbles") },
    { key: "TD", group: "Defense", label: "TD", title: "Defensive touchdowns", raw: (s) => g(s, "dtd") },
  ];
  // Keep the order given in `core`, then any other column that has data.
  const ordered = [
    ...core.map((k) => all.find((c) => c.key === k)!),
    ...all.filter((c) => !core.includes(c.key)),
  ];
  return ordered.map((c) => ({ ...c, core: core.includes(c.key) }));
};

const kicking = (): Col[] => [
  { group: "Kicking", label: "FG", title: "Field goals made / attempted", core: true, raw: (s) => g(s, "fga"), text: (s) => `${g(s, "fgm")}/${g(s, "fga")}` },
  { group: "Kicking", label: "LNG", title: "Longest field goal", raw: (s) => g(s, "fgLong") },
  { group: "Kicking", label: "XP", title: "Extra points made / attempted", core: true, raw: (s) => g(s, "xpa"), text: (s) => `${g(s, "xpm")}/${g(s, "xpa")}` },
  { group: "Kicking", label: "PTS", title: "Kicking points", core: true, raw: (s) => g(s, "kicking.totalKickingPoints") || g(s, "fgm") * 3 + g(s, "xpm") },
];

const punting = (): Col[] => [
  { group: "Punting", label: "PUNTS", title: "Punts", core: true, raw: (s) => g(s, "punting.punts") },
  { group: "Punting", label: "YDS", title: "Punt yards", core: true, raw: (s) => g(s, "punting.puntYards") },
  { group: "Punting", label: "AVG", title: "Average yards per punt", core: true, raw: (s) => g(s, "punting.punts"), text: (s) => avg(g(s, "punting.puntYards"), g(s, "punting.punts")) },
  { group: "Punting", label: "LNG", title: "Longest punt", raw: (s) => g(s, "puntLong") },
  { group: "Punting", label: "IN20", title: "Punts inside the 20", raw: (s) => g(s, "punting.puntsInside20") },
];

const ALIASES: Record<string, string> = {
  K: "PK", OLB: "LB", ILB: "LB", MLB: "LB", NT: "DT", DL: "DE", FS: "S", SS: "S", DB: "CB", HB: "RB", TB: "RB",
};

/** The columns that fit this player's position. */
function columnsFor(position: string): Col[] {
  const pos = ALIASES[position.toUpperCase()] ?? position.toUpperCase();
  switch (pos) {
    case "QB":
      return [...passing(), ...rushing(false)];
    case "RB":
    case "FB":
      return [...rushing(true), ...receiving(true)];
    case "WR":
    case "TE":
      return [...receiving(true), ...rushing(false)];
    case "DE":
    case "DT":
      return defense(["SCK", "TFL", "QBH", "TKL", "SOLO"]);
    case "LB":
      return defense(["TKL", "SOLO", "TFL", "SCK"]);
    case "CB":
    case "S":
      return defense(["TKL", "SOLO", "INT", "PD"]);
    case "PK":
      return kicking();
    case "P":
      return punting();
    default:
      return [];
  }
}

export const Route = createFileRoute("/players/$playerId")({
  component: PlayerPage,
});

function PlayerPage() {
  const { playerId } = Route.useParams();
  const { data: player, isLoading } = useQuery<PlayerProfile | null>({
    queryKey: ["player-profile", playerId],
    queryFn: () => getPlayerProfile({ data: { playerId } }),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const { data: log, isLoading: logLoading } = useQuery<PlayerGameLogEntry[]>({
    queryKey: ["player-gamelog", playerId, player?.teamId],
    queryFn: () => getPlayerGameLog({ data: { playerId, teamId: player?.teamId } }),
    enabled: !!player,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return <Panel><p className="py-10 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Loading player profile…</p></Panel>;
  }
  if (!player) {
    return <Panel><p className="py-10 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Player profile unavailable.</p></Panel>;
  }

  const team = teamById(player.teamId);
  const s = player.season;
  const passYpg = s.gamesPlayed ? s.passingYards / s.gamesPlayed : 0;
  const rushYpg = s.gamesPlayed ? s.rushingYards / s.gamesPlayed : 0;
  const recYpg = s.gamesPlayed ? s.receivingYards / s.gamesPlayed : 0;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-panel2 ring-1 ring-line/10">
          {player.headshot ? <img src={player.headshot} alt={player.name} className="size-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-4">
            {team ? <TeamMark team={team} size="lg" /> : null}
            <PageTitle
              eyebrow={`${player.position} · #${player.jersey ?? "—"} · ${player.teamName}`}
              title={player.name}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Chip label="Age" value={player.age ?? "—"} />
            <Chip label="Height" value={player.height ?? "—"} />
            <Chip label="Weight" value={player.weight ?? "—"} />
            <Chip label="Born" value={player.birthDate ?? "—"} />
            <Chip label="Birthplace" value={player.birthPlace ?? "—"} />
            <Chip label="College" value={player.college ?? "—"} />
            <Chip label="Experience" value={player.experience != null ? `${player.experience} yrs` : "—"} />
            <Chip label="Draft" value={player.draft ?? "Undrafted"} />
            <Chip label="Status" value={player.status ?? "—"} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Games" value={String(s.gamesPlayed)} note="2026 season" />
        <StatCard label="Pass Yards" value={s.passingYards.toLocaleString()} note={`${passYpg.toFixed(1)} per game`} />
        <StatCard label="Rush Yards" value={s.rushingYards.toLocaleString()} note={`${rushYpg.toFixed(1)} per game`} />
        <StatCard label="Rec Yards" value={s.receivingYards.toLocaleString()} note={`${recYpg.toFixed(1)} per game`} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Panel padded={false}>
          <PanelHeader title="Season totals" aside={<span className="label-mono">ESPN · 2026</span>} />
          <div className="grid grid-cols-2 divide-x divide-y divide-line/5 sm:grid-cols-3">
            <Metric label="Completions" value={`${s.completions}/${s.passingAttempts}`} />
            <Metric label="Pass TD" value={s.passingTouchdowns} />
            <Metric label="INT" value={s.interceptions} />
            <Metric label="Rush" value={s.rushingAttempts} />
            <Metric label="Rush TD" value={s.rushingTouchdowns} />
            <Metric label="Receptions" value={s.receptions} />
            <Metric label="Rec TD" value={s.receivingTouchdowns} />
            <Metric label="Tackles" value={s.totalTackles} />
            <Metric label="Sacks" value={s.sacks} />
          </div>
        </Panel>

        <Panel padded={false} className="lg:col-span-2">
          <PanelHeader title="Game log" aside={<span className="label-mono">2026 season</span>} />
          <GameLog log={log} loading={logLoading} position={player.position} />
        </Panel>
      </div>
    </>
  );
}

function GameLog({
  log,
  loading,
  position,
}: {
  log: PlayerGameLogEntry[] | undefined;
  loading: boolean;
  position: string;
}) {
  if (loading || !log) {
    return (
      <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
        Loading game log…
      </p>
    );
  }
  if (log.length === 0) {
    return (
      <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
        No games with recorded stats yet.
      </p>
    );
  }

  // Core columns always show; the rest only when some game has a value.
  const cols = columnsFor(position).filter((c) => c.core || log.some((e) => c.raw(e.stats) !== 0));
  const groups: { name: string; span: number }[] = [];
  for (const c of cols) {
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.span += 1;
    else groups.push({ name: c.group, span: 1 });
  }
  const firstOfGroup = new Set(
    cols.filter((c, i) => i === 0 || cols[i - 1].group !== c.group).map((c) => c),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="font-mono text-[10px] uppercase tracking-wider text-faint">
          {groups.length > 0 ? (
            <tr>
              <th rowSpan={2} className="px-4 py-2 text-left align-bottom font-normal">
                Wk
              </th>
              <th rowSpan={2} className="px-2 py-2 text-center align-bottom font-normal">
                Matchup
              </th>
              {groups.map((grp) => (
                <th
                  key={grp.name}
                  colSpan={grp.span}
                  className="border-l border-line/10 px-2 pt-2 text-center font-normal text-mute"
                >
                  {grp.name}
                </th>
              ))}
            </tr>
          ) : null}
          <tr>
            {groups.length === 0 ? (
              <>
                <th className="px-4 py-2 text-left font-normal">Wk</th>
                <th className="px-2 py-2 text-center font-normal">Matchup</th>
              </>
            ) : null}
            {cols.map((c) => (
              <th
                key={`${c.group}-${c.label}`}
                title={c.title}
                className={`px-2 py-2 text-right font-normal ${
                  firstOfGroup.has(c) ? "border-l border-line/10" : ""
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {log.map((e) => {
            const away = teamById(e.awayTeamId);
            const home = teamById(e.homeTeamId);
            return (
              <tr key={e.gameId} className="hover:bg-line/5">
                <td className="px-4 py-2.5 font-mono tabular-nums text-mute">{e.week}</td>
                <td className="px-2 py-2.5 text-center">
                  {away && home ? (
                    <Link
                      to="/games/$gameId"
                      params={{ gameId: e.gameId }}
                      className="inline-flex items-center justify-center gap-1.5 font-mono font-semibold tabular-nums hover:text-acc"
                    >
                      {/* Invisible twin of the (OT) tag so every matchup lines up */}
                      {e.overtime ? (
                        <span aria-hidden="true" className="invisible font-mono text-[10px] font-normal">
                          (OT)
                        </span>
                      ) : null}
                      <span className="w-6 text-right">{e.awayScore}</span>
                      <TeamLogo team={away} />
                      <span className="font-sans font-normal text-mute">@</span>
                      <TeamLogo team={home} />
                      <span className="w-6 text-left">{e.homeScore}</span>
                      {e.overtime ? (
                        <span className="font-mono text-[10px] font-normal text-mute">(OT)</span>
                      ) : null}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                {cols.map((c) => (
                  <td
                    key={`${c.group}-${c.label}`}
                    className={`px-2 py-2.5 text-right font-mono tabular-nums ${
                      firstOfGroup.has(c) ? "border-l border-line/10" : ""
                    }`}
                  >
                    {c.text ? c.text(e.stats) : fmt(c.raw(e.stats))}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="p-4"><div className="label-mono">{label}</div><div className="mt-1 font-disp text-xl font-semibold tabular-nums">{value}</div></div>;
}

function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="text-xs">
      <span className="label-mono mr-1.5">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}
