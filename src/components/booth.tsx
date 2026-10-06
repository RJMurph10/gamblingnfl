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
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">{eyebrow}</p>
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

  return (
    <table className="w-full text-center font-mono text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-faint">
          <th className="text-left font-normal">Team</th>
          <th className="font-normal">Q1</th>
          <th className="font-normal">Q2</th>
          <th className="font-normal">Q3</th>
          <th className="font-normal">Q4</th>
          <th className="text-right font-normal">T</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5">
        {rows.map((row) => (
          <tr key={row.team.id}>
            <td className="py-2 text-left font-medium">{row.team.name}</td>
            {row.quarters.map((q, i) => (
              <td key={i} className="py-2 tabular-nums text-mute">
                {q}
              </td>
            ))}
            <td
              className={`py-2 text-right font-semibold tabular-nums ${
                winner === row.team.id ? "text-acc" : ""
              }`}
            >
              {row.total}
            </td>
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

/* ---------- team statistics comparison ---------- */

interface StatDef {
  label: string;
  /** Number used for the bar and for deciding whether the stat happened. */
  value: (s: TeamGameStats) => number;
  /** Text shown at the edges (defaults to the number). */
  text?: (s: TeamGameStats) => string;
  /** True when this team recorded the stat. Defaults to value !== 0. */
  happened?: (s: TeamGameStats) => boolean;
  /** Bars scale to 100 (percentages) instead of the larger of the two teams. */
  percent?: boolean;
}

const num = (v: number | undefined) => v ?? 0;

/** made/attempts stat shown as a percentage, e.g. "42% (5/12)". */
function pctStat(
  label: string,
  made: (s: TeamGameStats) => number,
  att: (s: TeamGameStats) => number,
  fallbackPct?: (s: TeamGameStats) => number,
): StatDef {
  const pct = (s: TeamGameStats) =>
    att(s) > 0 ? Math.round((made(s) / att(s)) * 100) : fallbackPct ? fallbackPct(s) : 0;
  const happened = (s: TeamGameStats) => att(s) > 0 || (fallbackPct ? fallbackPct(s) > 0 : false);
  return {
    label,
    percent: true,
    value: pct,
    happened,
    text: (s) =>
      att(s) > 0 ? `${pct(s)}% (${made(s)}/${att(s)})` : happened(s) ? `${pct(s)}%` : "—",
  };
}

// Order matters: this is the order the rows appear in.
const statDefs: StatDef[] = [
  {
    label: "Touchdowns",
    value: (s) =>
      s.touchdowns ??
      num(s.passingTouchdowns) + num(s.rushingTouchdowns) + num(s.defensiveTouchdowns),
  },
  { label: "Passing TDs", value: (s) => num(s.passingTouchdowns) },
  { label: "Rushing TDs", value: (s) => num(s.rushingTouchdowns) },
  {
    label: "Field goals",
    value: (s) => num(s.fieldGoalsMade),
    happened: (s) => num(s.fieldGoalAttempts) > 0 || num(s.fieldGoalsMade) > 0,
    text: (s) =>
      num(s.fieldGoalAttempts) > 0
        ? `${num(s.fieldGoalsMade)}/${num(s.fieldGoalAttempts)}`
        : String(num(s.fieldGoalsMade)),
  },
  { label: "Total yards", value: (s) => s.totalYards },
  { label: "Passing yards", value: (s) => s.passYards },
  { label: "Rushing yards", value: (s) => s.rushYards },
  { label: "First downs", value: (s) => s.firstDowns },
  pctStat("3rd down %", (s) => num(s.thirdDownMade), (s) => num(s.thirdDownAtt), (s) => s.thirdDownPct),
  pctStat("4th down %", (s) => num(s.fourthDownMade), (s) => num(s.fourthDownAtt)),
  pctStat("Red zone %", (s) => num(s.redZoneMade), (s) => num(s.redZoneAtt)),
  pctStat("Extra point %", (s) => num(s.extraPointsMade), (s) => num(s.extraPointAttempts)),
  { label: "Turnovers", value: (s) => s.turnovers },
  { label: "Penalties", value: (s) => s.penalties },
  { label: "Penalty yards", value: (s) => num(s.penaltyYards) },
  { label: "Sacks", value: (s) => num(s.sacks) },
  { label: "Defensive TDs", value: (s) => num(s.defensiveTouchdowns) },
  { label: "Interceptions", value: (s) => num(s.interceptions) },
  { label: "Forced fumbles", value: (s) => num(s.forcedFumbles) },
  { label: "Tackles for loss", value: (s) => num(s.tacklesForLoss) },
  { label: "Passes defended", value: (s) => num(s.passesDefended) },
  { label: "QB hits", value: (s) => num(s.qbHits) },
];

/** Only the stats at least one team actually recorded. */
function visibleStats(away: TeamGameStats, home: TeamGameStats): StatDef[] {
  return statDefs.filter((def) => {
    const happened = def.happened ?? ((s: TeamGameStats) => def.value(s) !== 0);
    return happened(away) || happened(home);
  });
}

/* team-color helpers: keep bars visible on the dark UI and apart from each other */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function mixWhite(rgb: [number, number, number], amt: number): [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * amt),
    Math.round(rgb[1] + (255 - rgb[1]) * amt),
    Math.round(rgb[2] + (255 - rgb[2]) * amt),
  ];
}

const toCss = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

function distance(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Team colors for the two bars: lightened if too dark, separated if too similar. */
function pickBarColors(awayHex: string, homeHex: string): [string, string] {
  const brighten = (hex: string) => {
    let rgb = hexToRgb(hex);
    for (let i = 0; i < 8 && luminance(rgb) < 0.06; i++) rgb = mixWhite(rgb, 0.18);
    return rgb;
  };
  const away = brighten(awayHex);
  let home = brighten(homeHex);
  if (distance(away, home) < 80) home = mixWhite(home, 0.45);
  return [toCss(away), toCss(home)];
}

export function StatComparison({ game }: { game: Game }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  if (!away || !home) return null;

  const rows = visibleStats(game.stats.away, game.stats.home);
  const [awayColor, homeColor] = pickBarColors(away.color, home.color);
  const showPossession =
    !/^0?0:00$/.test(game.stats.away.timeOfPossession) ||
    !/^0?0:00$/.test(game.stats.home.timeOfPossession);

  return (
    <div className="text-sm">
      {/* logos sit at 1/3 and 2/3 of the width */}
      <div className="relative mb-5 h-[4.25rem]">
        {[
          { team: away, left: "33.3333%" },
          { team: home, left: "66.6667%" },
        ].map(({ team, left }) => (
          <div
            key={team.id}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1"
            style={{ left }}
          >
            <TeamLogo team={team} className="size-11" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
              {team.abbr}
            </span>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
          Team stats appear once the game is under way
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const a = row.value(game.stats.away);
            const h = row.value(game.stats.home);
            const max = row.percent ? 100 : Math.max(a, h, 1);
            const width = (v: number) => `${Math.min(100, Math.max(v > 0 ? 3 : 0, (v / max) * 100))}%`;
            const fmt = (s: TeamGameStats, v: number) => (row.text ? row.text(s) : String(v));
            return (
              <div key={row.label}>
                <div className="mb-1 grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 font-mono text-[11px]">
                  <span className="text-left tabular-nums">{fmt(game.stats.away, a)}</span>
                  <span className="text-center text-faint">{row.label}</span>
                  <span className="text-right tabular-nums">{fmt(game.stats.home, h)}</span>
                </div>
                <div className="flex gap-1">
                  <div className="flex h-2 flex-1 justify-end overflow-hidden rounded-full bg-panel2">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: width(a), backgroundColor: awayColor }}
                    />
                  </div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: width(h), backgroundColor: homeColor }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showPossession ? (
        <div className="flex flex-wrap items-center gap-2 pt-4 font-mono text-[11px] text-faint">
          <span>Possession</span>
          <span className="tabular-nums text-ink">{game.stats.away.timeOfPossession}</span>
          <span>/</span>
          <span className="tabular-nums text-ink">{game.stats.home.timeOfPossession}</span>
        </div>
      ) : null}
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
        <path d="M2 12C5.5 6.5 16.5 6.5 20 12C16.5 17.5 5.5 17.5 2 12Z" fill="currentColor" stroke="#fda4af" strokeWidth="1.2" />
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
      <path d="M2 12C5.5 6.5 16.5 6.5 20 12C16.5 17.5 5.5 17.5 2 12Z" fill="currentColor" stroke="#f59e0b" strokeWidth="1.2" />
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
            <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${spreadClass}`}>{game.spread}</td>
            <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${totalClass}`}>{game.total || "—"}</td>
          </>
        );
      })() : null}

    </tr>
  );
}
