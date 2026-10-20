import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Link } from "@tanstack/react-router";
import type { Team } from "@/data/teams";
import type { Game, PlayByPlayItem, SeasonLeader, TeamGameStats } from "@/data/games";
import { gameScore } from "@/data/games";
import { teamByAbbr, teamById, teamLogo, teamLogoFallback } from "@/data/teams";
import { useRunningGameClock } from "@/lib/use-running-game-clock";


/* ---------- primitives ---------- */

/** Stadium photo that tries each candidate URL in order and hides itself if none load. */
function VenueImage({ urls, alt }: { urls: string[]; alt: string }) {
  const [index, setIndex] = useState(0);
  if (index >= urls.length) return null;
  return (
    <img
      key={urls[index]}
      src={urls[index]}
      alt={alt}
      loading="lazy"
      className="block h-auto w-full"
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

/** Information tab: stadium photo, kickoff, venue, location, TV, attendance, officials. */
export function GameInformation({ game, away, home }: { game: Game; away: Team; home: Team }) {
  const info = game.info;
  const isScheduled = game.status === "scheduled";
  const isFinal = game.status === "final";
  const rows: { label: string; value: ReactNode }[] = [];

  // e.g. "October 12, 7:15 PM" — shown in the viewer's own time zone.
  let when = "";
  if (game.kickoffIso) {
    const kickoff = new Date(game.kickoffIso);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = kickoff.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone });
    const time = kickoff.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
    when = `${day}, ${time}`;
  } else {
    when = [game.date, (game.time ?? "").replace(/\s*(ET|EDT|EST)$/i, "")].filter(Boolean).join(", ");
  }
  if (when) rows.push({ label: "Date", value: when });
  if (game.venue && game.venue !== "TBD") rows.push({ label: "Venue", value: game.venue });
  if (game.location && game.location !== "TBD") rows.push({ label: "Location", value: game.location });
  if (info?.capacity) rows.push({ label: "Capacity", value: info.capacity.toLocaleString() });
  if (info?.broadcast) rows.push({ label: "TV", value: info.broadcast });
  if (isFinal && info?.attendance) rows.push({ label: "Attendance", value: info.attendance.toLocaleString() });
  return (
    <Panel padded={false}>
      <div className="border-b border-line/10 px-4 py-3">
        <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Game information</h2>
        <div className="mt-2 flex items-center gap-2">
          <TeamLogo team={away} className="size-7" />
          <span className="font-mono text-sm text-mute">@</span>
          <TeamLogo team={home} className="size-7" />
        </div>
      </div>
      {info?.venueImages?.length ? <VenueImage urls={info.venueImages} alt={game.venue} /> : null}
      <dl className="divide-y divide-line/10 px-4 sm:px-5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 py-3 text-sm">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-faint">{row.label}</dt>
            <dd suppressHydrationWarning className="text-right font-semibold text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {info?.officials?.length ? (
        <div className="border-t border-line/10 px-4 py-3 sm:px-5">
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-faint">Officials</h3>
          <ul className="mt-2 grid grid-cols-1 gap-1.5 text-sm">
            {info.officials.map((official) => (
              <li key={`${official.role}-${official.name}`} className="flex justify-between gap-3">
                <span className="text-mute">{official.role ?? "Official"}</span>
                <span className="text-right font-semibold text-foreground">{official.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

/** Pregame "Season leaders": same look as Game leaders, but cumulative season stats. */
export function SeasonLeaders({ game, away, home }: { game: Game; away: Team; home: Team }) {
  const rows = game.seasonLeaders ?? [];
  const playerCell = (leader: SeasonLeader | undefined, side: "away" | "home") => {
    const isHome = side === "home";
    const alignment = isHome ? "justify-end text-right" : "justify-start text-left";
    if (!leader) return <div className="py-4" aria-hidden="true" />;
    const content = (
      <div className={`flex min-w-0 items-center gap-2.5 ${isHome ? "flex-row-reverse" : ""}`}>
        <img
          src={
            leader.headshot ??
            (leader.playerId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${leader.playerId}.png` : "")
          }
          alt=""
          loading="lazy"
          className="size-11 shrink-0 rounded-full bg-line/10 object-cover ring-1 ring-line/15 sm:size-12"
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
        <div className={`min-w-0 ${isHome ? "text-right" : "text-left"}`}>
          <div className="truncate text-sm font-semibold text-foreground group-hover:text-acc">{leader.name}</div>
          {leader.position ? <div className="mt-0.5 text-[11px] text-mute">{leader.position}</div> : null}
          <div className="mt-1 font-mono text-sm font-bold tabular-nums text-acc">
            {leader.value}
            {leader.unit ? ` ${leader.unit.toLowerCase()}` : ""}
          </div>
        </div>
      </div>
    );
    return (
      <div className={`flex min-w-0 items-center py-3 ${alignment}`}>
        {leader.playerId ? (
          <Link
            to="/players/$playerId"
            params={{ playerId: leader.playerId }}
            className="group block min-w-0 rounded-md p-1 transition-colors hover:bg-line/5"
          >
            {content}
          </Link>
        ) : (
          <div className="min-w-0 p-1">{content}</div>
        )}
      </div>
    );
  };
  return (
    <Panel padded={false}>
      <div className="border-b border-line/10 px-4 py-3">
        <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Season leaders</h2>
      </div>
      <div className="px-3 sm:px-5">
        <div className="grid grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-center gap-2 border-b border-line/10 py-3 font-mono text-[10px] uppercase tracking-wider text-faint sm:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
          <div className="flex items-center gap-2">
            <TeamLogo team={away} className="size-5" />
            <span>{away.name}</span>
          </div>
          <div className="text-center">Category</div>
          <div className="flex items-center justify-end gap-2 text-right">
            <span>{home.name}</span>
            <TeamLogo team={home} className="size-5" />
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
            Season leaders aren&apos;t available for this game yet
          </p>
        ) : (
          <div className="divide-y divide-line/10">
            {rows.map((row) => (
              <div
                key={row.category}
                className="grid grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]"
              >
                {playerCell(row.away, "away")}
                <div className="px-1 text-center">
                  <div className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-mute sm:text-xs">
                    {row.category}
                  </div>
                </div>
                {playerCell(row.home, "home")}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** ESPN-style pregame "Matchup Predictor": donut with both logos, win % in the top corners. */
export function MatchupPredictor({ game, away, home }: { game: Game; away: Team; home: Team }) {
  // Pregame only: ESPN's matchup predictor (the page refreshes it every few minutes before kickoff).
  const predictor = game.predictor;
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const gap = 1.2;
  // ESPN's numbers are shown as-is; they can sum to slightly under 100 (the rest is a tie).
  const arc = (pct: number) => Math.max(0, (pct / 100) * circumference - gap);
  const swatch = (team: Team) => (
    <span className="inline-block size-3.5 shrink-0 rounded-[3px]" style={{ backgroundColor: team.color }} />
  );
  const corner = (team: Team, pct: number, align: "left" | "right") => (
    <div className={`flex flex-col ${align === "left" ? "items-start text-left" : "items-end text-right"}`}>
      <span className="font-disp text-3xl font-bold leading-none tabular-nums sm:text-4xl">{pct.toFixed(1)}%</span>
      <div className="mt-1.5 flex items-center gap-1.5">
        {align === "left" ? swatch(team) : null}
        <span className="text-sm text-mute">{team.abbr}</span>
        {align === "right" ? swatch(team) : null}
      </div>
    </div>
  );
  return (
    <Panel>
      <h2 className="border-b border-line/15 pb-3 font-disp text-xl font-bold uppercase tracking-tight">
        Matchup Predictor
      </h2>
      {predictor ? (
        <>
          <div className="relative mt-4 flex justify-center">
            <div className="absolute left-0 top-0">{corner(away, predictor.away, "left")}</div>
            <div className="absolute right-0 top-0">{corner(home, predictor.home, "right")}</div>
            <div className="relative mt-6 size-48 shrink-0 sm:size-64">
              <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label="Matchup predictor">
                <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="9" className="stroke-panel2" />
                {/* Home team first, clockwise from the top. */}
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  strokeWidth="9"
                  stroke={home.color}
                  strokeDasharray={`${arc(predictor.home)} ${circumference}`}
                  strokeDashoffset={-gap / 2}
                />
                {/* Away team follows, ending back at the top. */}
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  strokeWidth="9"
                  stroke={away.color}
                  strokeDasharray={`${arc(predictor.away)} ${circumference}`}
                  strokeDashoffset={-((predictor.home / 100) * circumference + gap / 2)}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex w-1/2 justify-center">
                  <TeamLogo team={away} className="size-12 sm:size-16" />
                </div>
                <div className="w-1/2" aria-hidden />
                <div className="absolute inset-y-[22%] left-1/2 border-l border-dashed border-line/30" />
                <div className="absolute inset-y-0 right-0 flex w-1/2 items-center justify-center">
                  <TeamLogo team={home} className="size-12 sm:size-16" />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
          Matchup predictor isn&apos;t available for this game yet
        </p>
      )}
    </Panel>
  );
}

/** Three vertical dots showing a team's timeouts: white = remaining, darker shade of the same dot = used. */
export function TimeoutDots({ remaining }: { remaining: number }) {
  return (
    <div className="flex flex-col items-center gap-1" aria-label={`${remaining} timeouts remaining`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`size-1.5 rounded-full sm:size-2 ${i < remaining ? "bg-foreground" : "bg-foreground/35"}`}
        />
      ))}
    </div>
  );
}

/** On a logo load error, try the team's backup logo once before giving up. */
function onLogoError(e: SyntheticEvent<HTMLImageElement>, team: Team, onFail?: () => void) {
  const fallback = teamLogoFallback(team);
  if (fallback && !e.currentTarget.src.endsWith(fallback)) {
    e.currentTarget.src = fallback;
  } else {
    onFail?.();
  }
}

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

export function PanelHeader({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
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
        {eyebrow ? (
          <p suppressHydrationWarning className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
            {eyebrow}
          </p>
        ) : null}
        {title ? (
          <h1 className="font-disp text-3xl font-bold uppercase leading-none tracking-tight sm:text-4xl">
            {title}
          </h1>
        ) : null}
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
      onError={(e) => onLogoError(e, team, () => setFailed(true))}
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
      onError={(e) => onLogoError(e, team, () => setFailed(true))}
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
  perspectiveTeam,
  className = "",
}: {
  spread: string | undefined;
  away?: Team;
  home?: Team;
  perspectiveTeam?: Team;
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

  let formattedPts = ptsStr.startsWith("-") || ptsStr.startsWith("+") ? ptsStr : `-${ptsStr}`;
  if (perspectiveTeam && favTeam) {
    const isFavorite = perspectiveTeam.id === favTeam.id;
    const numericPts = Math.abs(Number(ptsStr));
    formattedPts = isFavorite ? `-${numericPts}` : `+${numericPts}`;
    if (numericPts === 0) formattedPts = "PK";
  }

  return (
    <span className={`inline-flex items-center gap-1 font-mono tabular-nums ${className}`}>
      <TeamLogo team={perspectiveTeam ?? favTeam} className="size-3.5" />
      <span className="market-line">{formattedPts}</span>
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
  INT: "bg-loss",
  FUM: "bg-loss",
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
  const [selectedTeamId, setSelectedTeamId] = useState<string>(game.awayTeamId);
  const selectedDrives = game.drives.filter((d) => d.teamId === selectedTeamId);
  const selectedTeam = teamById(selectedTeamId);
  const awayTeam = teamById(game.awayTeamId);
  const homeTeam = teamById(game.homeTeamId);

  if (game.drives.length === 0) {
    return (
      <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
        Drive chart populates once play-by-play data is imported.
      </p>
    );
  }

  return (
    <div>
      {/* One tab per team — show only that team's drives. */}
      <div className="grid grid-cols-2 border-b border-line/10">
        {[awayTeam, homeTeam].map((team, index) => {
          if (!team) return null;
          const active = selectedTeamId === team.id;
          const count = game.drives.filter((d) => d.teamId === team.id).length;
          return (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeamId(team.id)}
              className={`flex items-center justify-center gap-2 px-4 py-3 font-disp text-sm font-semibold uppercase tracking-tight transition-colors ${
                index === 0 ? "border-r border-line/10" : ""
              } ${
                active
                  ? "bg-acc/10 text-foreground shadow-[inset_0_-2px_0_var(--accent)]"
                  : "text-mute hover:bg-line/5 hover:text-foreground"
              }`}
            >
              <img
                src={teamLogo(team)}
                alt=""
                aria-hidden="true"
                className="size-6 object-contain"
                onError={(e) => onLogoError(e, team)}
              />
              <span>{team.id === awayTeam?.id && team.city === "Atlanta" ? "Atlanta" : team.name}</span>
              <span className="font-mono text-[10px] text-faint">{count}</span>
            </button>
          );
        })}
      </div>

      {selectedDrives.length === 0 ? (
        <p className="px-4 py-8 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
          No drives recorded for {selectedTeam?.name ?? "this team"}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Result</th>
                <th className="px-2 py-2 font-normal">Qtr</th>
                <th className="px-2 py-2 text-right font-normal">Plays</th>
                <th className="px-2 py-2 text-right font-normal">Yards</th>
                <th className="px-2 py-2 text-right font-normal">TOP</th>
                <th className="px-2 py-2 font-normal">Start</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {selectedDrives.map((d) => {
                // ESPN occasionally omits a drive's time of possession. Keep the
                // missing value visibly estimated instead of displaying an impossible 0:00.
                const rawTop = String(d.timeOfPossession ?? "").trim();
                const hasValidTop = rawTop !== "" && !/^0?:?0:00$/.test(rawTop);
                const estimatedSeconds = Math.max(30, Number(d.plays || 0) * 25);
                const estimatedTop = `${Math.floor(estimatedSeconds / 60)}:${String(estimatedSeconds % 60).padStart(2, "0")}`;
                const displayTop = hasValidTop ? rawTop : Number(d.plays || 0) > 0 ? estimatedTop : "—";
                const startText = String(d.startAt ?? "").trim();
                const startParts = startText.split(/\s+/);
                const startTeam = startParts.length > 1 ? teamByAbbr(startParts[0]) : undefined;
                const startYardLine = startTeam ? startParts.slice(1).join(" ") : startText;
                const rawResult = String(d.result ?? "").trim();
                const normalizedResult = rawResult.toUpperCase();
                // Some feed records label the outcome only as TO. Search all
                // available drive fields for the underlying turnover type before
                // falling back to the generic label.
                const driveText = Object.values(d as unknown as Record<string, unknown>)
                  .filter((value): value is string => typeof value === "string")
                  .join(" ")
                  .toUpperCase();
                const resultLabel = /INTERCEPTION|\bINT\b/.test(driveText)
                  ? "INT"
                  : /FUMBLE|\bFUM\b/.test(driveText)
                    ? "FUM"
                    : normalizedResult === "EOH"
                      ? "Half"
                      : normalizedResult === "EOG"
                        ? "Game"
                        : normalizedResult;
                return (
                  <tr key={d.index} className="hover:bg-line/5">
                    <td className="px-4 py-2.5 text-left">
                      <span
                        className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] uppercase ${
                          resultLabel === "TD"
                            ? "bg-win/15 text-win"
                            : resultLabel === "TO" || resultLabel === "DOWNS" || resultLabel === "INT" || resultLabel === "FUM"
                              ? "bg-loss/15 text-loss"
                              : resultLabel === "FG"
                                ? "bg-acc/15 text-acc"
                                : "bg-panel2 text-mute"
                        }`}
                      >
                        {resultLabel}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-mute tabular-nums">
                      {d.quarter === 1
                        ? "1st"
                        : d.quarter === 2
                          ? "2nd"
                          : d.quarter === 3
                            ? "3rd"
                            : d.quarter === 4
                              ? "4th"
                              : "OT"}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{d.plays}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{d.yards}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                      <span title={hasValidTop ? "Time of possession" : "Estimated from play count because the source supplied no usable duration"}>
                        {displayTop}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="inline-flex items-center gap-1.5 font-mono text-mute">
                        {startTeam ? (
                          <img
                            src={teamLogo(startTeam)}
                            alt={`${startTeam.city} ${startTeam.name}`}
                            title={`${startTeam.city} ${startTeam.name}`}
                            className="size-5 shrink-0 object-contain"
                            loading="lazy"
                            onError={(e) => onLogoError(e, startTeam)}
                          />
                        ) : null}
                        <span>{startYardLine}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
const formatStatNumber = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(1);

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
      att(s) > 0 ? `${pct(s)}% (${formatStatNumber(made(s))}/${formatStatNumber(att(s))})` : happened(s) ? `${pct(s)}%` : "—",
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
        ? `${formatStatNumber(num(s.fieldGoalsMade))}/${formatStatNumber(num(s.fieldGoalAttempts))}`
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
  { label: "Interceptions", value: (s) => num(s.interceptions), happened: () => true },
  { label: "Forced fumbles", value: (s) => num(s.forcedFumbles), happened: () => true },
  { label: "Penalties", value: (s) => s.penalties },
  { label: "Penalty yards", value: (s) => num(s.penaltyYards) },
  { label: "Sacks", value: (s) => num(s.sacks) },
  { label: "Defensive TDs", value: (s) => num(s.defensiveTouchdowns) },
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

  // Keep the Team Stats display accurate even when ESPN omits forced-fumble
  // player totals: each FUM-ending drive is credited to the opposing defense.
  // This is a display-only fallback; the drive table and other stats are unchanged.
  const awayForcedFumblesFromDrives = game.drives.filter(
    (drive) => drive.result === "FUM" && drive.teamId === game.homeTeamId,
  ).length;
  const homeForcedFumblesFromDrives = game.drives.filter(
    (drive) => drive.result === "FUM" && drive.teamId === game.awayTeamId,
  ).length;
  const awayStats = {
    ...game.stats.away,
    forcedFumbles: Math.max(game.stats.away.forcedFumbles ?? 0, awayForcedFumblesFromDrives),
  };
  const homeStats = {
    ...game.stats.home,
    forcedFumbles: Math.max(game.stats.home.forcedFumbles ?? 0, homeForcedFumblesFromDrives),
  };
  const rows = visibleStats(awayStats, homeStats);
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
            const a = row.value(awayStats);
            const h = row.value(homeStats);
            const max = row.percent ? 100 : Math.max(a, h, 1);
            const width = (v: number) => `${Math.min(100, Math.max(v > 0 ? 3 : 0, (v / max) * 100))}%`;
            const fmt = (s: TeamGameStats, v: number) => (row.text ? row.text(s) : formatStatNumber(v));
            return (
              <div key={row.label}>
                <div className="mb-1 grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 font-mono text-[11px]">
                  <span className="text-left tabular-nums">{fmt(awayStats, a)}</span>
                  <span className="text-center text-faint">{row.label}</span>
                  <span className="text-right tabular-nums">{fmt(homeStats, h)}</span>
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

export function marketResultClass(
  game: Game,
  away: Team,
  home: Team,
  perspectiveTeam?: Team,
): { spread: string; total: string } {
  const neutral = "text-mute";
  const win = "text-green-500 font-semibold";
  const loss = "text-red-500 font-semibold";
  const isLive = game.status === "live";
  // Live games: exactly on the line counts as "not covering" / "not over" (red).
  // Final games keep the yellow push color.
  const push = isLive ? loss : "text-yellow-400 font-semibold";
  if (game.status !== "final" && !isLive) return { spread: neutral, total: neutral };

  let spread = neutral;
  const m = game.spread?.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
  if (m) {
    const pts = Math.abs(Number(m[2]));
    const awayFav = m[1].toUpperCase() === away.abbr.toUpperCase();
    const homeFav = m[1].toUpperCase() === home.abbr.toUpperCase();
    const score = gameScore(game);
    if (awayFav || homeFav) {
      const team = perspectiveTeam ?? (awayFav ? away : home);
      const teamDiff = team.id === away.id ? score.away - score.home : score.home - score.away;
      const teamSpread = team.id === (awayFav ? away.id : home.id) ? -pts : pts;
      const marginAgainstLine = teamDiff + teamSpread;
      if (marginAgainstLine > 0) spread = win;
      else if (marginAgainstLine < 0) spread = loss;
      else spread = push;
    }
  }

  let total = neutral;
  if (game.total > 0) {
    const score = gameScore(game);
    const points = score.away + score.home;
    if (points > game.total) total = win;
    else if (points < game.total) total = loss;
    else total = push;
  }
  return { spread, total };
}

/** Replace field-position text like "BAL 25" or "LA 5" with the team's logo + yard line. */
function withFieldLogos(text: string): ReactNode {
  const alias: Record<string, string> = { LA: "LAR", WAS: "WSH", JAC: "JAX", OAK: "LV" };
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\b([A-Z]{2,4})\s+(\d{1,2})\b/g)) {
    const team = teamByAbbr(alias[m[1]] ?? m[1]);
    if (!team) continue;
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <span key={start} className="inline-flex items-center gap-1 align-middle">
        <TeamLogo team={team} className="size-4" />
        {m[2]}
      </span>,
    );
    last = start + m[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Splits a play description into the main line and the tackler/defender
 * parenthetical, e.g. "... for 5 yards (C.Gardner-Johnson; A.Kendall)." ->
 * main "... for 5 yards." and detail "(C.Gardner-Johnson; A.Kendall)".
 */
function splitPlayDetail(text: string): { main: string; detail?: string } {
  for (const m of text.matchAll(/\(([^()]+)\)/g)) {
    const start = m.index ?? 0;
    if (start === 0) continue; // leading tags like "(No Huddle)"
    if (/no huddle|shotgun|timeout|kick|conversion|attempt|pass failed|run failed|good|no good/i.test(m[1])) continue;
    const before = text.slice(0, start).trimEnd();
    const after = text.slice(start + m[0].length).trim();
    const main = (after.startsWith(".") || after.startsWith(",") ? before + after : `${before} ${after}`).trim();
    return { main, detail: m[0] };
  }
  return { main: text };
}

/** ESPN-style live play-by-play list (newest play first). */
export function PlayByPlay({ plays }: { plays: PlayByPlayItem[] }) {
  return (
    <Panel padded={false} className="mt-6">
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
            Play-by-play
          </span>
        }
      />
      {plays.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-mute">Waiting for the first play…</div>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-line/5 overflow-y-auto">
          {plays.map((play, i) => {
            const team = play.teamId ? teamById(play.teamId) : undefined;
            const isNewest = i === 0;
            return (
              <li
                key={play.id}
                className={`flex items-start gap-3 px-4 py-3 ${play.scoring ? "bg-emerald-400/10" : isNewest ? "bg-line/5" : ""}`}
              >
                <div className="flex w-12 shrink-0 flex-col items-center gap-1 pt-0.5">
                  {team ? <TeamLogo team={team} className="size-6" /> : null}
                  <span className="font-mono text-[10px] text-mute">
                    {play.quarter ? `Q${play.quarter}` : ""} {play.clock ?? ""}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  {play.header ? (
                    <div className="font-mono text-xs font-semibold text-foreground">{withFieldLogos(play.header)}</div>
                  ) : null}
                  {(() => {
                    const { main, detail } = splitPlayDetail(play.text);
                    return (
                      <>
                        <div className={`text-sm ${play.scoring ? "font-semibold" : "text-mute"} whitespace-pre-line`}>{main}</div>
                        {detail ? <div className="text-xs text-faint">{detail}</div> : null}
                      </>
                    );
                  })()}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Sep 13" / "Sun, Sep 13" -> "9/13" (month number / day number). Leaves anything else untouched. */
export function formatNumericDate(date: string | undefined): string {
  if (!date) return "";
  const match = date.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/);
  if (!match) return date;
  const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
  if (month === -1) return date;
  return `${month + 1}/${Number(match[2])}`;
}

/**
 * Matchup link used in game tables. A 3-column grid (1fr / @ / 1fr) keeps the
 * "@" in the exact center of the cell on every row, regardless of score width,
 * OT tags, or possession footballs (which are positioned outside the grid flow).
 */
export function MatchupLink({
  game,
  away,
  home,
  awayScore,
  homeScore,
  showOT = false,
  showPossession = false,
}: {
  game: Game;
  away: Team;
  home: Team;
  awayScore: number | string;
  homeScore: number | string;
  showOT?: boolean;
  showPossession?: boolean;
}) {
  const awayBall = showPossession && game.possession === "away";
  const homeBall = showPossession && game.possession === "home";
  return (
    <Link
      to="/games/$gameId"
      params={{ gameId: game.id }}
      className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-mono tabular-nums font-semibold hover:text-acc"
    >
      <span className="flex justify-end">
        <span className="relative inline-flex items-center gap-1.5">
          {awayBall ? (
            <span className="absolute right-full top-1/2 mr-1.5 -translate-y-1/2">
              <FootballIcon isRedZone={game.isRedZone} />
            </span>
          ) : null}
          <span className="w-6 text-right">{awayScore}</span>
          <TeamLogo team={away} />
        </span>
      </span>
      <span className="text-center font-sans font-normal text-mute">@</span>
      <span className="flex justify-start">
        <span className="relative inline-flex items-center gap-1.5">
          <TeamLogo team={home} />
          <span className="w-6 text-left">{homeScore}</span>
          {showOT || homeBall ? (
            <span className="absolute left-full top-1/2 ml-1.5 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap">
              {showOT ? (
                <span className="font-mono text-[10px] font-normal text-mute">(OT)</span>
              ) : null}
              {homeBall ? <FootballIcon isRedZone={game.isRedZone} /> : null}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

export function GameRow({
  game,
  showMarket = true,
  perspectiveTeamId,
}: {
  game: Game;
  showMarket?: boolean;
  perspectiveTeamId?: string;
}) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  const score = gameScore(game);
  const perspectiveTeam = perspectiveTeamId ? teamById(perspectiveTeamId) : undefined;
  if (!away || !home) return null;

  const isOT =
    (game.quarters?.away?.length ?? 0) > 4 ||
    (game.quarters?.home?.length ?? 0) > 4 ||
    Boolean(game.clock?.toUpperCase().includes("OT"));
  const showOT = isOT && game.status !== "scheduled";

  const runningClock = useRunningGameClock({
    clock: game.clock,
    status: game.status,
  });

  return (
    <tr className="hover:bg-line/5">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-mute">{formatNumericDate(game.date)}</td>
      <td suppressHydrationWarning className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">
        {game.kickoffIso
          ? new Date(game.kickoffIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : (game.time ?? game.kickoff.replace(/^\w+\s+/, "")).replace(/\s*(ET|EDT|EST)$/i, "")}
      </td>
      <td className="px-2 py-2.5 text-center">
        <MatchupLink
          game={game}
          away={away}
          home={home}
          awayScore={game.status !== "scheduled" ? score.away : ""}
          homeScore={game.status !== "scheduled" ? score.home : ""}
          showOT={showOT}
          showPossession={game.status === "live"}
        />
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-mute">
        {game.status === "live" ? (runningClock || "Live") : game.location}
      </td>

      {showMarket ? (() => {
        const { spread: spreadClass, total: totalClass } = marketResultClass(game, away, home, perspectiveTeam);
        return (
          <>
            <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${spreadClass}`}>
              <div className="flex items-center justify-end">
                <SpreadBadge spread={game.spread} away={away} home={home} perspectiveTeam={perspectiveTeam} />
              </div>
            </td>
            <td className={`whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums ${totalClass}`}>{game.total || "—"}</td>
          </>
        );
      })() : null}
    </tr>
  );
}
