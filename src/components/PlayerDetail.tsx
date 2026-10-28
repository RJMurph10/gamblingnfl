/** Player page body, shared by the NFL and college player routes. */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelHeader, StatCard, TeamLogo, TeamMark } from "@/components/booth";
import { getPlayerGameLog, getPlayerProfile } from "@/lib/espn.functions";
import type { PlayerProfile } from "@/lib/shared/espn-teams-players.server";
import type { PlayerGameLogEntry } from "@/lib/league-players.server";
import { teamById } from "@/data/teams";
import { getCfbPlayerGameLog } from "@/lib/cfb.functions";
import { gameRoute, teamRoute } from "@/lib/league-links";
import type { LeagueId } from "@/lib/leagues";
import { useCfbConferences, useCfbSchedule } from "@/lib/use-cfb";

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
  { group: "QB", label: "PYAC", title: "Passing yards after catch", core: true, raw: (s) => firstStat(s, "yardsAfterCatch", "passing.yardsAfterCatch", "passing.passingYardsAfterCatch", "passingYardsAfterCatch", "pyac") },
  { group: "QB", label: "PTD", title: "Passing touchdowns", core: true, raw: (s) => firstStat(s, "passing.passingTouchdowns", "passingTouchdowns", "ptd") },
  { group: "QB", label: "INT", title: "Interceptions thrown", core: true, raw: (s) => firstStat(s, "passing.interceptions", "interceptions", "int") },
  { group: "QB", label: "CAR", title: "Rushing attempts", core: true, raw: (s) => firstStat(s, "rushing.rushingAttempts", "rushingAttempts", "car") },
  { group: "QB", label: "RUYDS", title: "Rushing yards", core: true, raw: (s) => firstStat(s, "rushing.rushingYards", "rushingYards", "ruyds") },
  { group: "QB", label: "RUTD", title: "Rushing touchdowns", core: true, raw: (s) => firstStat(s, "rushing.rushingTouchdowns", "rushingTouchdowns", "rutd") },
  { group: "QB", label: "SACK", title: "Times the quarterback was sacked", core: true, raw: (s) => firstStat(s, "passing.sacks", "passing.sacksTaken", "passing.sacks-sackedYards", "sacks", "sack") },
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
/** Columns for a position; college box scores have no yards after catch, so those go. */
function columnsFor(position: string, college = false): Col[] {
  const cols = positionColumns(position);
  return college ? cols.filter((c) => !c.label.includes("YAC")) : cols;
}

function positionColumns(position: string): Col[] {
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

/**
 * A player's page: bio header, season totals and averages, and the game log. Shared by NFL
 * players (/players/<id>) and college players (/cfb/players/<id>).
 */
export function PlayerDetail({ playerId, league }: { playerId: string; league: LeagueId }) {
  const college = league === "cfb";
  const { data: player, isLoading } = useQuery<PlayerProfile | null>({
    queryKey: ["player-profile", league, playerId],
    queryFn: () => getPlayerProfile({ data: { playerId, league: college ? "cfb" : "nfl" } }),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // College teams (and their opponents in the log) come from the FBS schedule.
  useCfbConferences(college);
  useCfbSchedule(false, college);

  const { data: log, isLoading: logLoading } = useQuery<PlayerGameLogEntry[]>({
    queryKey: ["player-gamelog", league, playerId, player?.teamId],
    queryFn: () =>
      college
        ? getCfbPlayerGameLog({ data: { playerId, teamId: player!.teamId } })
        : getPlayerGameLog({ data: { playerId, teamId: player?.teamId } }),
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
  const offensivePositions = new Set(["QB", "RB", "FB", "WR", "TE", "OL", "OT", "OG", "G", "C", "T", "LT", "RT", "LG", "RG"]);
  const isOffensivePlayer = offensivePositions.has(String(player.position ?? "").toUpperCase());

  // Split name for stacked ESPN-style presentation: first name above, last name below
  const nameParts = (player.name ?? "").trim().split(" ");
  const firstName = player.firstName || (nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : "");
  const lastName = player.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : player.name ?? "");

  // Format bio values
  const htWt = [player.height, player.weight].filter(Boolean).join(", ") || "—";
  const birthdate = player.birthDate
    ? `${player.birthDate}${player.age ? ` (${player.age})` : ""}`
    : player.age
      ? `Age ${player.age}`
      : "—";
  const draftInfo = player.draft ?? "Undrafted";

  return (
    <>
      {/* ESPN-style Player Profile Header */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-line/10 bg-panel/60 backdrop-blur-md">
        <div className="flex flex-col gap-6 p-5 sm:p-7 md:flex-row md:items-end md:justify-between">
          {/* Left: Cutout Headshot + Stacked Name & Team line */}
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            {/* Cutout Headshot Box */}
            <div className="relative h-44 w-36 shrink-0 self-center overflow-hidden rounded-xl border border-line/10 bg-panel2/80 sm:h-52 sm:w-40 sm:self-auto">
              {player.headshot ? (
                <img
                  src={player.headshot}
                  alt={player.name}
                  className="size-full object-cover object-top"
                />
              ) : (
                <div className="grid size-full place-items-center text-xs font-mono uppercase text-faint">
                  No Image
                </div>
              )}
            </div>

            {/* Name + Team row */}
            <div className="flex flex-col justify-end">
              <div className="font-sans text-xl font-extrabold uppercase tracking-tight text-mute sm:text-2xl">
                {firstName}
              </div>
              <div className="font-sans text-4xl font-black uppercase tracking-tight text-fg sm:text-5xl md:text-6xl">
                {lastName}
              </div>

              {/* Team Logo, Name, Position, Jersey */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-mute">
                {team ? (
                  <Link
                    to={teamRoute(team.id)}
                    params={{ teamId: team.id }}
                    className="flex items-center gap-2 font-medium text-fg hover:text-acc"
                  >
                    <TeamLogo team={team} />
                    <span>{player.teamName || team.name}</span>
                  </Link>
                ) : (
                  <span>{player.teamName || "—"}</span>
                )}
                <span className="text-line/40">•</span>
                <span className="font-mono font-bold text-fg">#{player.jersey ?? "—"}</span>
                <span className="text-line/40">•</span>
                <span className="font-mono uppercase font-semibold text-fg">{player.position}</span>
              </div>
            </div>
          </div>

          {/* Right: Vertical Bio List */}
          <div className="border-t border-line/10 pt-4 md:border-t-0 md:pt-0">
            <ul className="flex flex-wrap gap-x-6 gap-y-3 md:flex-col md:gap-y-2 text-xs">
              <li>
                <span className="font-mono uppercase text-faint">HT/WT</span>
                <div className="font-mono font-semibold text-fg text-sm">{htWt}</div>
              </li>
              <li>
                <span className="font-mono uppercase text-faint">Birthdate</span>
                <div className="font-medium text-fg text-sm">{birthdate}</div>
              </li>
              {college ? (
                <li>
                  <span className="font-mono uppercase text-faint">Hometown</span>
                  <div className="font-medium text-fg text-sm">{player.birthPlace || "—"}</div>
                </li>
              ) : (
                <>
                  <li>
                    <span className="font-mono uppercase text-faint">College</span>
                    <div className="font-medium text-fg text-sm">{player.college || "—"}</div>
                  </li>
                  <li>
                    <span className="font-mono uppercase text-faint">Draft Info</span>
                    <div className="font-medium text-fg text-sm">{draftInfo}</div>
                  </li>
                </>
              )}
              <li>
                <span className="font-mono uppercase text-faint">Status</span>
                <div className="flex items-center gap-1.5 font-semibold text-emerald-400 text-sm">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span>{player.status || "Active"}</span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {!isOffensivePlayer ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Games" value={String(s.gamesPlayed)} note="2026 season" />
          <StatCard label="Pass Yards" value={s.passingYards.toLocaleString()} note={`${passYpg.toFixed(1)} per game`} />
          <StatCard label="Rush Yards" value={s.rushingYards.toLocaleString()} note={`${rushYpg.toFixed(1)} per game`} />
          <StatCard label="Rec Yards" value={s.receivingYards.toLocaleString()} note={`${recYpg.toFixed(1)} per game`} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <SeasonTable log={log} loading={logLoading} position={player.position} mode="totals" college={college} />
          <SeasonTable log={log} loading={logLoading} position={player.position} mode="averages" college={college} />
        </div>
        <Panel padded={false}>
          <PanelHeader title="Game log" aside={<span className="label-mono">2026 season</span>} />
          <GameLog log={log} loading={logLoading} position={player.position} college={college} />
        </Panel>
      </div>
    </>
  );
}

function SeasonTable({
  log,
  loading,
  position,
  mode,
  college = false,
}: {
  college?: boolean;
  log: PlayerGameLogEntry[] | undefined;
  loading: boolean;
  position: string;
  mode: "totals" | "averages";
}) {
  const title = mode === "totals" ? "Season totals" : "Season averages";
  if (loading || !log) {
    return (
      <Panel padded={false}>
        <PanelHeader title={title} aside={<span className="label-mono">2026 season</span>} />
        <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">Loading season stats…</p>
      </Panel>
    );
  }
  if (log.length === 0) {
    return (
      <Panel padded={false}>
        <PanelHeader title={title} aside={<span className="label-mono">2026 season</span>} />
        <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">No season stats available yet.</p>
      </Panel>
    );
  }

  const cols = columnsFor(position, college).filter((c) => c.core || log.some((e) => c.raw(e.stats) !== 0));
  const games = log.length;
  const sum = (pick: (stats: Stats) => number) => log.reduce((total, entry) => total + pick(entry.stats), 0);
  const max = (pick: (stats: Stats) => number) => log.reduce((value, entry) => Math.max(value, pick(entry.stats)), 0);
  const perGame = (value: number) => (games > 0 ? value / games : 0);
  const valueFor = (c: Col) => {
    const label = c.label;
    const totalsValue = () => {
      if (label === "C/ATT") return `${sum((st) => firstStat(st, "pc", "passing.completions"))}/${sum((st) => firstStat(st, "pa", "passing.passingAttempts"))}`;
      if (label === "FG%") return `${sum((st) => g(st, "fgm"))}/${sum((st) => g(st, "fga"))}`;
      if (label === "XP%") return `${sum((st) => g(st, "xpm"))}/${sum((st) => g(st, "xpa"))}`;
      if (label === "AVG") {
        const punts = sum((st) => firstStat(st, "punting.punts", "punts"));
        const yards = sum((st) => firstStat(st, "punting.puntYards", "puntYards", "puyds"));
        return punts > 0 ? (yards / punts).toFixed(1) : "—";
      }
      if (label === "LNG" || label === "RULNG" || label === "RELNG") return fmt(max(c.raw));
      return fmt(sum(c.raw));
    };
    if (mode === "totals") return totalsValue();

    if (label === "C/ATT") {
      return `${perGame(sum((st) => firstStat(st, "pc", "passing.completions"))).toFixed(1)}/${perGame(sum((st) => firstStat(st, "pa", "passing.passingAttempts"))).toFixed(1)}`;
    }
    if (label === "FG%") return `${perGame(sum((st) => g(st, "fgm"))).toFixed(1)}/${perGame(sum((st) => g(st, "fga"))).toFixed(1)}`;
    if (label === "XP%") return `${perGame(sum((st) => g(st, "xpm"))).toFixed(1)}/${perGame(sum((st) => g(st, "xpa"))).toFixed(1)}`;
    if (label === "AVG") return totalsValue();
    if (label === "LNG" || label === "RULNG" || label === "RELNG") return fmt(perGame(sum(c.raw)));
    return fmt(perGame(sum(c.raw)));
  };

  return (
    <Panel padded={false}>
      <PanelHeader title={title} aside={<span className="label-mono">{games} games · 2026</span>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="font-mono text-[10px] uppercase tracking-wider text-faint">
            <tr>
              {cols.map((c) => (
                <th key={`${c.group}-${c.label}`} title={c.title} className="px-2 py-2 text-right font-normal first:pl-4 last:pr-4">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line/5">
              {cols.map((c) => (
                <td key={`${c.group}-${c.label}`} className="px-2 py-3 text-right font-mono tabular-nums first:pl-4 last:pr-4">
                  {valueFor(c)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function GameLog({
  log,
  loading,
  position,
  college = false,
}: {
  college?: boolean;
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
  const cols = columnsFor(position, college).filter((c) => c.core || log.some((e) => c.raw(e.stats) !== 0));
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
                      to={gameRoute(e.gameId)}
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
