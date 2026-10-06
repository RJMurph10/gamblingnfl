import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { Team } from "@/data/teams";
import type { Game, TeamGameStats } from "@/data/games";
import { gameScore } from "@/data/games";
import { teamById, teamLogo } from "@/data/teams";

/* ---------- primitives ---------- */

export function Panel({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`glass min-w-0 ${padded ? "p-4" : "overflow-hidden"} ${className}`}>{children}</div>;
}

export function PanelHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line/10 px-4 py-3">
      <h2 className="mr-auto font-disp text-xl font-semibold uppercase tracking-tight">{title}</h2>
      {aside}
    </div>
  );
}

export function PageTitle({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p suppressHydrationWarning className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
          {eyebrow}
        </p>
        <h1 className="font-disp text-3xl font-bold uppercase leading-none tracking-tight sm:text-4xl">
          {title}
        </h1>
      </div>
      {aside}
    </div>
  );
}

export function SampleBadge({ label = "Sample data" }: { label?: string }) {
  return (
    <span className="rounded-lg bg-panel px-3 py-1 font-mono text-[11px] text-mute">{label}</span>
  );
}

export function StatCard({
  label,
  value,
  unit,
  note,
  tone = "mute",
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  tone?: "win" | "loss" | "mute";
}) {
  const toneClass = tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : "text-mute";
  return (
    <Panel>
      <p className="label-mono">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums sm:text-3xl">
        {value}
        {unit ? <span className="text-base text-mute">{unit}</span> : null}
      </p>
      {note ? <p className={`mt-1 text-xs ${toneClass}`}>{note}</p> : null}
    </Panel>
  );
}

/* ---------- team identity mark ---------- */

export function TeamMark({
  team,
  size = "md",
}: {
  team: Team;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const dims = size === "sm" ? "size-7" : size === "lg" ? "size-14" : "size-10";
  if (failed) {
    return (
      <span
        className={`glass grid ${dims} shrink-0 place-items-center rounded-xl font-disp text-[11px] font-bold uppercase`}
        style={{ boxShadow: `inset 0 0 0 1px ${team.color}55, 0 0 18px -8px ${team.color}` }}
      >
        {team.abbr}
      </span>
    );
  }
  return (
    <img
      src={teamLogo(team)}
      alt={`${team.city} ${team.name} logo`}
      className={`${dims} shrink-0 object-contain`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function TeamLogo({ team, className = "size-4" }: { team: Team; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="font-mono text-[10px] uppercase text-mute">{team.abbr}</span>;
  }
  return (
    <img
      src={teamLogo(team)}
      alt={`${team.city} ${team.name} logo`}
      className={`inline-block shrink-0 object-contain ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function TeamCard({ team }: { team: Team }) {
  return (
    <Link
      to="/teams/$teamId"
      params={{ teamId: team.id }}
      className="glass flex items-center gap-3 p-3 transition-shadow hover:glow"
    >
      <TeamMark team={team} />
      <span className="min-w-0">
        <span className="block truncate font-disp text-lg font-semibold uppercase leading-none tracking-tight">
          {team.name.toUpperCase()}
        </span>
      </span>
    </Link>
  );
}

/* ---------- Spread Badge with Logo ---------- */

export function SpreadBadge({
  spread,
  away,
  home,
  className = "",
}: {
  spread: string | undefined;
  away?: Team;
  home?: Team;
  className?: string;
}) {
  if (!spread || spread === "—") return <span>—</span>;
  if (spread === "PK" || spread === "EVEN") return <span>{spread}</span>;

  const match = spread.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
  if (!match) return <span>{spread}</span>;

  const [, favAbbr, ptsStr] = match;
  const favTeam =
    away && favAbbr.toUpperCase() === away.abbr.toUpperCase()
      ? away
      : home && favAbbr.toUpperCase() === home.abbr.toUpperCase()
        ? home
        : undefined;

  if (!favTeam) return <span>{spread}</span>;

  const formattedPts = ptsStr.startsWith("-") || ptsStr.startsWith("+") ? ptsStr : `-${ptsStr}`;

  return (
    <span className={`inline-flex items-center gap-1 font-mono tabular-nums ${className}`}>
      <TeamLogo team={favTeam} className="size-3.5" />
      <span>{formattedPts}</span>
    </span>
  );
}

/* ---------- game widgets ---------- */

export function LineScore({ game }: { game: Game }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  const score = gameScore(game);
  if (!away || !home) return null;

  const rows = [
    { team: away, quarters: game.quarters.away, total: score.away },
    { team: home, quarters: game.quarters.home, total: score.home },
  ];
  const winner = score.away === score.home ? null : score.away > score.home ? away.id : home.id;
  const isFinal = game.status === "final";
  const isLive = game.status === "live";

  // During a live game: only show quarters that have started or ended.
  // When final or scheduled: show 4 quarters (plus OT if played).
  const maxLiveQuarters = Math.max(game.quarters?.away?.length ?? 0, game.quarters?.home?.length ?? 0);
  const quarterCount = isLive
    ? Math.max(1, maxLiveQuarters)
    : Math.max(4, maxLiveQuarters);

  const QUARTER_LABELS = ["1st", "2nd", "3rd", "4th", "OT"];
  const getQuarterHeader = (i: number) => {
    if (i < 4) return QUARTER_LABELS[i];
    if (i === 4) return "OT";
    return `OT${i - 3}`;
  };

  return (
    <table className="w-full text-center font-mono text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-faint">
          <th className="text-left font-normal">Team</th>
          {Array.from({ length: quarterCount }, (_, i) => (
            <th key={i} className="font-normal">
              {getQuarterHeader(i)}
            </th>
          ))}
          {isFinal && <th className="text-right font-normal">Final</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5">
        {rows.map((row) => (
          <tr key={row.team.id}>
            <td className="py-2 text-left font-medium">{row.team.name}</td>
            {Array.from({ length: quarterCount }, (_, i) => (
              <td key={i} className="py-2 tabular-nums text-mute">
                {row.quarters[i] !== undefined ? row.quarters[i] : 0}
              </td>
            ))}
            {isFinal && (
              <td
                className={`py-2 text-right font-semibold tabular-nums ${
                  winner === row.team.id ? "text-acc" : ""
                }`}
              >
                {row.total}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const driveTone: Record<string, string> = {
  TD: "bg-win",
  FG: "bg-acc",
  PUNT: "bg-faint",
  TO: "bg-loss",
  DOWNS: "bg-loss",
  EOH: "bg-faint",
  EOG: "bg-faint",
};

export function DriveRail({ game, teamId }: { game: Game; teamId: string }) {
  const drives = game.drives.filter((d) => d.teamId === teamId);
  if (drives.length === 0) {
    return <p className="font-mono text-[11px] text-faint">No drive data yet.</p>;
  }
  return (
    <div className="flex gap-1">
      {drives.map((d) => (
        <span
          key={d.index}
          title={`Q${d.quarter} · ${d.plays} plays, ${d.yards} yds → ${d.result}`}
          className={`h-2 rounded-sm ${driveTone[d.result] ?? "bg-faint"}`}
          style={{ width: `${Math.max(16, Math.min(60, d.yards))}px` }}
        />
      ))}
    </div>
  );
}

export function DriveTable({ game }: { game: Game }) {
  if (game.drives.length === 0) {
    return (
      <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
        Drive chart populates once play-by-play data is imported.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal">#</th>
            <th className="px-2 py-2 font-normal">Team</th>
            <th className="px-2 py-2 font-normal">Qtr</th>
            <th className="px-2 py-2 text-right font-normal">Plays</th>
            <th className="px-2 py-2 text-right font-normal">Yards</th>
            <th className="px-2 py-2 text-right font-normal">TOP</th>
            <th className="px-2 py-2 font-normal">Start</th>
            <th className="px-4 py-2 text-right font-normal">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {game.drives.map((d) => {
            const team = teamById(d.teamId);
            return (
              <tr key={d.index} className="hover:bg-line/5">
                <td className="px-4 py-2.5 font-mono text-mute tabular-nums">{d.index}</td>
                <td className="px-2 py-2.5 font-mono text-mute">{team?.abbr}</td>
                <td className="px-2 py-2.5 font-mono text-mute tabular-nums">Q{d.quarter}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums">{d.plays}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums">{d.yards}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                  {d.timeOfPossession}
                </td>
                <td className="px-2 py-2.5 font-mono text-mute">{d.startAt}</td>
                <td className="px-4 py-2.5 text-right">
                  <span
                    className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] uppercase ${
                      d.result === "TD"
                        ? "bg-win/15 text-win"
                        : d.result === "TO" || d.result === "DOWNS"
                          ? "bg-loss/15 text-loss"
                          : d.result === "FG"
                            ? "bg-acc/15 text-acc"
                            : "bg-panel2 text-mute"
                    }`}
                  >
                    {d.result}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const comparisonRows: { key: keyof TeamGameStats; label: string }[] = [
  { key: "totalYards", label: "Total yds" },
  { key: "passYards", label: "Pass yds" },
  { key: "rushYards", label: "Rush yds" },
  { key: "firstDowns", label: "First downs" },
  { key: "thirdDownPct", label: "3rd down %" },
  { key: "turnovers", label: "Turnovers" },
  { key: "penalties", label: "Penalties" },
];

export function StatComparison({ game }: { game: Game }) {
  return (
    <div className="space-y-3 text-sm">
      {comparisonRows.map((row) => {
        const a = Number(game.stats.away[row.key]);
        const h = Number(game.stats.home[row.key]);
        const max = Math.max(a, h, 1);
        return (
          <div key={row.key}>
            <div className="mb-1 flex justify-between font-mono text-[11px]">
              <span className="tabular-nums">{a}</span>
              <span className="text-faint">{row.label}</span>
              <span className="tabular-nums">{h}</span>
            </div>
            <div className="flex gap-1">
              <div className="flex h-1.5 flex-1 justify-end rounded-full bg-panel2">
                <div
                  className="h-1.5 rounded-full bg-acc/70"
                  style={{ width: `${(a / max) * 100}%` }}
                />
              </div>
              <div className="h-1.5 flex-1 rounded-full bg-panel2">
                <div
                  className="h-1.5 rounded-full bg-acc/70"
                  style={{ width: `${(h / max) * 100}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] text-faint">
        <span>Possession</span>
        <span className="tabular-nums text-ink">{game.stats.away.timeOfPossession}</span>
        <span>/</span>
        <span className="tabular-nums text-ink">{game.stats.home.timeOfPossession}</span>
      </div>
    </div>
  );
}

export function FootballIcon({ isRedZone = false }: { isRedZone?: boolean }) {
  if (isRedZone) {
    return (
      <svg
        viewBox="0 0 22 24"
        className="size-3.5 animate-pulse text-rose-500 drop-shadow-[0_0_6px_rgba(244,63,94,0.9)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M2 12C5.5 6.5 16.5 6.5 20 12Z" fill="currentColor" stroke="#fda4af" strokeWidth="1.2" />
        <path d="M6.5 12H15.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M8.5 9.5V14.5M11 9V15M13.5 9.5V14.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 22 24"
      className="size-3.5 text-amber-500"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 12C5.5 6.5 16.5 6.5 20 12Z" fill="currentColor" stroke="#f59e0b" strokeWidth="1.2" />
      <path d="M6.5 12H15.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8.5 9.5V14.5M11 9V15M13.5 9.5V14.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function GameRow({
  game,
  showMarket = true,
}: {
  game: Game;
  showMarket?: boolean;
}) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  const score = gameScore(game);
  if (!away || !home) return null;

  const isOT =
    (game.quarters?.away?.length ?? 0) > 4 ||
    (game.quarters?.home?.length ?? 0) > 4 ||
    Boolean(game.clock?.toUpperCase().includes("OT"));

  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{game.date}</td>
      <td suppressHydrationWarning className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">
        {game.kickoffIso
          ? new Date(game.kickoffIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : (game.time ?? game.kickoff.replace(/^\w+\s+/, "")).replace(/\s*(ET|EDT|EST)$/i, "")}
      </td>
      <td className="px-2 py-2.5 text-center">
        <Link
          to="/games/$gameId"
          params={{ gameId: game.id }}
          className="inline-flex items-center justify-center gap-1.5 font-mono tabular-nums font-semibold hover:text-acc"
        >
          <span className="inline-flex w-4 items-center justify-center">
            {game.status === "live" && game.possession === "away" ? (
              <FootballIcon isRedZone={game.isRedZone} />
            ) : null}
          </span>
          <span className="w-6 text-right">
            {game.status !== "scheduled" ? score.away : ""}
          </span>
          <TeamLogo team={away} />
          <span className="font-sans font-normal text-mute">@</span>
          <TeamLogo team={home} />
          <span className="w-6 text-left">
            {game.status !== "scheduled" ? score.home : ""}
          </span>
          {isOT && game.status !== "scheduled" && (
            <span className="-ml-1 font-mono text-[10px] font-normal text-mute">
              (OT)
            </span>
          )}
          <span className="inline-flex w-4 items-center justify-center">
            {game.status === "live" && game.possession === "home" ? (
              <FootballIcon isRedZone={game.isRedZone} />
            ) : null}
          </span>
        </Link>
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">
        {game.status === "live" ? (game.clock ?? "Live") : game.location}
      </td>
      {showMarket ? (() => {
        // Spread cover evaluation
        let spreadClass = "text-mute";
        if (game.status !== "scheduled" && game.spread && game.spread !== "—" && game.spread !== "PK" && game.spread !== "EVEN") {
          const match = game.spread.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
          if (match) {
            const [, favAbbr, ptsStr] = match;
            const pts = Math.abs(parseFloat(ptsStr));
            const isAwayFav = favAbbr.toUpperCase() === away.abbr.toUpperCase();
            const isHomeFav = favAbbr.toUpperCase() === home.abbr.toUpperCase();
            if (isAwayFav || isHomeFav) {
              const diff = isAwayFav ? (score.away - score.home) : (score.home - score.away);
              if (diff > pts) spreadClass = "text-emerald-400 font-semibold";
              else if (diff < pts) spreadClass = "text-rose-500 font-semibold";
            }
          }
        }

        // Total over/under evaluation
        let totalClass = "text-mute";
        if (game.status !== "scheduled" && game.total && game.total > 0) {
          const totalPoints = score.away + score.home;
          if (totalPoints > game.total) {
            totalClass = "text-emerald-400 font-semibold"; // Over hit
          } else if (game.status === "final" && totalPoints < game.total) {
            totalClass = "text-rose-500 font-semibold"; // Under hit
          }
        }

        return (
          <>
            <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${spreadClass}`}>
              <div className="flex items-center justify-end">
                <SpreadBadge spread={game.spread} away={away} home={home} />
              </div>
            </td>
            <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${totalClass}`}>{game.total || "—"}</td>
          </>
        );
      })() : null}
    </tr>
  );
}
