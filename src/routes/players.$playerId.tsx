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

/** ESPN game-log stats can be nested (e.g. passing.passingYards) or flattened. */
const firstStat = (s: Stats, ...keys: string[]) => {
  for (const key of keys) {
    const value = g(s, key);
    if (value !== 0) return value;
  }
  return 0;
};

const quarterback = (): Col[] => [
  { group: "QB", label: "C/ATT", title: "Completions / attempts", core: true, raw: (s) => firstStat(s, "pa", "passing.passingAttempts"), text: (s) => `${firstStat(s, "pc", "passing.completions")}/${firstStat(s, "pa", "passing.passingAttempts")}` },
  { group: "QB", label: "PYDS", title: "Passing yards", core: true, raw: (s) => firstStat(s, "passing.passingYards", "passingYards", "pyds") },
  { group: "QB", label: "PYAC", title: "Passing yards after catch", core: true, raw: (s) => firstStat(s, "yardsAfterCatch", "passing.passingYardsAfterCatch", "passing.yardsAfterCatch", "passingYardsAfterCatch", "pyac") },
  { group: "QB", label: "PTD", title: "Passing touchdowns", core: true, raw: (s) => firstStat(s, "passing.passingTouchdowns", "passingTouchdowns", "ptd") },
  { group: "QB", label: "INT", title: "Interceptions thrown", core: true, raw: (s) => firstStat(s, "passing.interceptions", "interceptions", "int") },
  { group: "QB", label: "CAR", title: "Rushing attempts", core: true, raw: (s) => firstStat(s, "rushing.rushingAttempts", "rushingAttempts", "car") },
  { group: "QB", label: "RUYDS", title: "Rushing yards", core: true, raw: (s) => firstStat(s, "rushing.rushingYards", "rushingYards", "ruyds") },
  { group: "QB", label: "RUTD", title: "Rushing touchdowns", core: true, raw: (s) => firstStat(s, "rushing.rushingTouchdowns", "rushingTouchdowns", "rutd") },
  { group: "QB", label: "SACK", title: "Sacks taken", core: true, raw: (s) => firstStat(s, "passing.sacks", "passing.sacksTaken", "sacks", "sack") },
  { group: "QB", label: "FL", title: "Fumbles lost", core: true, raw: (s) => firstStat(s, "fumbles.fumblesLost", "fumblesLost", "lostFumbles", "fl") },
];

const rushingYards = (s: Stats) => firstStat(s, "rushing.rushingYards", "rushingYards", "ruyds");
const rushingAttempts = (s: Stats) => firstStat(s, "rushing.rushingAttempts", "rushingAttempts", "car");
const rushingTds = (s: Stats) => firstStat(s, "rushing.rushingTouchdowns", "rushingTouchdowns", "rutd");
const receivingYards = (s: Stats) => firstStat(s, "receiving.receivingYards", "receivingYards", "recyds");
const receptions = (s: Stats) => firstStat(s, "receiving.receptions", "receptions", "rec");
const receivingTds = (s: Stats) => firstStat(s, "receiving.receivingTouchdowns", "receivingTouchdowns", "rectd");
const totalFumblesLost = (s: Stats) => firstStat(s, "fumbles.fumblesLost", "fumblesLost", "lostFumbles", "fl");

const runningBack = (): Col[] => [
  { group: "RB", label: "YDS", title: "Total rushing and receiving yards", core: true, raw: (s) => rushingYards(s) + receivingYards(s) },
  { group: "RB", label: "TD", title: "Total rushing and receiving touchdowns", core: true, raw: (s) => rushingTds(s) + receivingTds(s) },
  { group: "RB", label: "CAR", title: "Rushing attempts", core: true, raw: rushingAttempts },
  { group: "RB", label: "RUYDS", title: "Rushing yards", core: true, raw: rushingYards },
  { group: "RB", label: "RUTD", title: "Rushing touchdowns", core: true, raw: rushingTds },
  { group: "RB", label: "RULNG", title: "Longest rush", core: true, raw: (s) => firstStat(s, "rushing.longRushing", "rushing.longRush", "longRushing", "rulng") },
  { group: "RB", label: "REC", title: "Receptions", core: true, raw: receptions },
  { group: "RB", label: "REYDS", title: "Receiving yards", core: true, raw: receivingYards },
  { group: "RB", label: "YAC", title: "Yards after catch", core: true, raw: (s) => g(s, "yardsAfterCatch") },
  { group: "RB", label: "RETD", title: "Receiving touchdowns", core: true, raw: receivingTds },
  { group: "RB", label: "RELNG", title: "Longest reception", core: true, raw: (s) => firstStat(s, "receiving.longReception", "longReception", "relng") },
  { group: "RB", label: "TGT", title: "Targets", core: true, raw: (s) => firstStat(s, "receiving.receivingTargets", "receivingTargets", "tgt") },
  { group: "RB", label: "FL", title: "Fumbles lost", core: true, raw: totalFumblesLost },
];

const receiver = (): Col[] => [
  { group: "WR/TE", label: "YDS", title: "Total receiving and rushing yards", core: true, raw: (s) => receivingYards(s) + rushingYards(s) },
  { group: "WR/TE", label: "TD", title: "Total receiving and rushing touchdowns", core: true, raw: (s) => receivingTds(s) + rushingTds(s) },
  { group: "WR/TE", label: "REC", title: "Receptions", core: true, raw: receptions },
  { group: "WR/TE", label: "REYDS", title: "Receiving yards", core: true, raw: receivingYards },
  { group: "WR/TE", label: "YAC", title: "Yards after catch", core: true, raw: (s) => g(s, "yardsAfterCatch") },
  { group: "WR/TE", label: "RETD", title: "Receiving touchdowns", core: true, raw: receivingTds },
  { group: "WR/TE", label: "RELNG", title: "Longest reception", core: true, raw: (s) => firstStat(s, "receiving.longReception", "longReception", "relng") },
  { group: "WR/TE", label: "TGT", title: "Targets", core: true, raw: (s) => firstStat(s, "receiving.receivingTargets", "receivingTargets", "tgt") },
  { group: "WR/TE", label: "CAR", title: "Rushing attempts", core: true, raw: rushingAttempts },
  { group: "WR/TE", label: "RUYDS", title: "Rushing yards", core: true, raw: rushingYards },
  { group: "WR/TE", label: "RUTD", title: "Rushing touchdowns", core: true, raw: rushingTds },
  { group: "WR/TE", label: "FL", title: "Fumbles lost", core: true, raw: totalFumblesLost },
];

const kicking = (): Col[] => [
  { group: "K", label: "FG%", title: "Field goals made / attempted", core: true, raw: (s) => g(s, "fga"), text: (s) => `${g(s, "fgm")}/${g(s, "fga")}` },
  { group: "K", label: "XP%", title: "Extra points made / attempted", core: true, raw: (s) => g(s, "xpa"), text: (s) => `${g(s, "xpm")}/${g(s, "xpa")}` },
  { group: "K", label: "LNG", title: "Longest made field goal", core: true, raw: (s) => firstStat(s, "matchup.fgLong", "fgLong", "kicking.longFieldGoalMade") },
  { group: "K", label: "FGYDS", title: "Total yards from made field goals", core: true, raw: (s) => g(s, "matchup.fgYds") },
  { group: "K", label: "0-19", title: "Made field goals from 0–19 yards", core: true, raw: (s) => g(s, "matchup.fg0_19") },
  { group: "K", label: "20-29", title: "Made field goals from 20–29 yards", core: true, raw: (s) => g(s, "matchup.fg20_29") },
  { group: "K", label: "30-39", title: "Made field goals from 30–39 yards", core: true, raw: (s) => g(s, "matchup.fg30_39") },
  { group: "K", label: "40-49", title: "Made field goals from 40–49 yards", core: true, raw: (s) => g(s, "matchup.fg40_49") },
  { group: "K", label: "50+", title: "Made field goals from 50+ yards", core: true, raw: (s) => g(s, "matchup.fg50plus") },
];

const punting = (): Col[] => [
  { group: "P", label: "PUNT", title: "Punts", core: true, raw: (s) => firstStat(s, "punting.punts", "punts") },
  { group: "P", label: "AVG", title: "Average punt yards", core: true, raw: (s) => firstStat(s, "punting.punts", "punts"), text: (s) => avg(firstStat(s, "punting.puntYards", "puntYards", "puyds"), firstStat(s, "punting.punts", "punts")) },
  { group: "P", label: "LNG", title: "Longest punt", core: true, raw: (s) => firstStat(s, "puntLong", "punting.longPunt", "punting.longestPunt") },
  { group: "P", label: "PUYDS", title: "Total punt yards", core: true, raw: (s) => firstStat(s, "punting.puntYards", "puntYards", "puyds") },
  { group: "P", label: "P20", title: "Punts inside the 20", core: true, raw: (s) => firstStat(s, "punting.puntsInside20", "puntsInside20", "p20") },
  { group: "P", label: "PTB", title: "Blocked punts", core: true, raw: (s) => firstStat(s, "punting.blockedPunts", "punting.puntsBlocked", "blockedPunts", "ptb") },
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
  const ordered = [...core.map((k) => all.find((c) => c.key === k)!), ...all.filter((c) => !core.includes(c.key))];
  return ordered.map((c) => ({ ...c, core: core.includes(c.key) }));
};

const ALIASES: Record<string, string> = {
  K: "PK", OLB: "LB", ILB: "LB", MLB: "LB", NT: "DT", DL: "DE", FS: "S", SS: "S", DB: "CB", HB: "RB", TB: "RB",
};

/** The columns that fit this player's position. */
function columnsFor(position: string): Col[] {
  const pos = ALIASES[position.toUpperCase()] ?? position.toUpperCase();
  switch (pos) {
    case "QB":
      return quarterback();
    case "RB":
    case "FB":
      return runningBack();
    case "WR":
    case "TE":
      return receiver();
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
  // Offensive skill players, kickers, and punters use one flat stat-header row.
  // Keep matchup columns and rows unchanged; only remove the extra group-heading row.
  const normalizedPosition = ALIASES[position.toUpperCase()] ?? position.toUpperCase();
  const flatHeaders = ["QB", "RB", "WR", "TE", "PK", "P"].includes(normalizedPosition);
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
          {groups.length > 0 && !flatHeaders ? (
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
            {groups.length === 0 || flatHeaders ? (
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
                  !flatHeaders && firstOfGroup.has(c) ? "border-l border-line/10" : ""
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
                      !flatHeaders && firstOfGroup.has(c) ? "border-l border-line/10" : ""
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
