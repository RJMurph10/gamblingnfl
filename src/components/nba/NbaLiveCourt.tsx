/**
 * Live NBA scoreboard with a court, the basketball version of the NFL page's live field:
 * timeout dots by each logo, the clock with a status badge (timeout, end of a quarter, halftime),
 * the latest made basket on the court, the last play and any scoring run.
 */
import { Link } from "@tanstack/react-router";
import { NbaLogo } from "@/components/nba/NbaBits";
import { Panel, TimeoutDots } from "@/components/shared/booth";
import type { NbaGame, NbaPlay, NbaTeamRef } from "@/lib/nba/nba";
import {
  currentRun,
  isBreak,
  latestMadeShot,
  liveBadge,
  nbaTimeoutsLeft,
} from "@/lib/nba/nba-live";

/** A flat, top-down court in true NBA proportions (94 × 50 ft, 10 svg units per foot). */
const W = 940;
const VH = 500;
const MID = VH / 2;
const PAINT_LEN = 190; // 19 ft
const PAINT_HALF = 80; // 16 ft wide
const FT_RADIUS = 60; // 6 ft
const HOOP_X = 52.5; // 5.25 ft from the baseline
const ARC_RADIUS = 237.5; // 23.75 ft from the hoop
const CORNER_OFF = 220; // corner threes: 22 ft from the hoop, 3 ft inside the sideline
const CORNER_LEN = HOOP_X + Math.sqrt(ARC_RADIUS ** 2 - CORNER_OFF ** 2); // where the arc starts
const LINE = {
  stroke: "currentColor",
  strokeOpacity: 0.3,
  strokeWidth: 1.5,
  fill: "none",
  vectorEffect: "non-scaling-stroke",
} as const;

/** Is a point (distance from the baseline, offset from the middle) inside the 3-point line? */
function insideArc(depth: number, off: number): boolean {
  if (depth <= CORNER_LEN) return Math.abs(off) <= CORNER_OFF;
  return Math.hypot(depth - HOOP_X, off) <= ARC_RADIUS;
}

/**
 * Map an ESPN shot spot (feet across 0–50, feet from the baseline) onto the court. ESPN's spots
 * are rounded, so a three right on the line is nudged just outside it and a two just inside.
 */
function shotPoint(x: number, y: number, value: number): { depth: number; off: number } {
  let depth = Math.min(460, Math.max(10, (y + 5) * 10));
  let off = Math.min(MID - 14, Math.max(-(MID - 14), (x - 25) * 10));
  const inside = insideArc(depth, off);
  if ((value === 3 && inside) || (value === 2 && !inside)) {
    const out = value === 3 ? 12 : -12;
    if (depth <= CORNER_LEN) off = Math.sign(off || 1) * Math.min(MID - 14, CORNER_OFF + out);
    else {
      const a = Math.atan2(off, depth - HOOP_X);
      depth = HOOP_X + Math.cos(a) * (ARC_RADIUS + out);
      off = Math.sin(a) * (ARC_RADIUS + out);
    }
  }
  return { depth, off };
}

const periodName = (p: number) =>
  p > 4 ? (p === 5 ? "OT" : `${p - 4}OT`) : (["1st", "2nd", "3rd", "4th"][p - 1] ?? "");

/** Team colors on a dark court: lift very dark brand colors so they stay visible. */
function courtColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "var(--acc)";
  const n = parseInt(m[1], 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum >= 0.35) return `#${m[1]}`;
  const t = Math.min(0.6, 0.35 - lum + 0.25);
  const mix = rgb.map((c) => Math.round(c + (255 - c) * t));
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function Basket({ side, color }: { side: "left" | "right"; color: string }) {
  const left = side === "left";
  const at = (d: number) => (left ? d : W - d); // distance from this baseline → x
  const sweep = left ? 1 : 0;
  return (
    <g>
      <rect
        x={left ? 0 : W - PAINT_LEN}
        y={MID - PAINT_HALF}
        width={PAINT_LEN}
        height={PAINT_HALF * 2}
        fill={color}
        fillOpacity={0.28}
      />
      <rect
        x={left ? 0 : W - PAINT_LEN}
        y={MID - PAINT_HALF}
        width={PAINT_LEN}
        height={PAINT_HALF * 2}
        {...LINE}
      />
      <circle cx={at(PAINT_LEN)} cy={MID} r={FT_RADIUS} {...LINE} />
      <path
        d={`M ${at(0)} ${MID - CORNER_OFF} L ${at(CORNER_LEN)} ${MID - CORNER_OFF} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 ${sweep} ${at(CORNER_LEN)} ${MID + CORNER_OFF} L ${at(0)} ${MID + CORNER_OFF}`}
        {...LINE}
      />
      <line
        x1={at(40)}
        x2={at(40)}
        y1={MID - 30}
        y2={MID + 30}
        stroke="currentColor"
        strokeOpacity={0.6}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={at(HOOP_X)}
        cy={MID}
        r={7.5}
        stroke="var(--court-rim)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
    </g>
  );
}

export function NbaLiveScoreboard({ game, plays }: { game: NbaGame; plays: NbaPlay[] }) {
  const { away, home } = game;
  const timeouts = nbaTimeoutsLeft(plays, game);
  const badge = liveBadge(plays, game);
  const onBreak = isBreak(game);
  const shot = onBreak ? undefined : latestMadeShot(plays);
  const run = currentRun(plays);
  const last = [...plays].reverse().find((p) => p.text.trim());
  const teamFor = (id?: string): NbaTeamRef | undefined =>
    id === away.team.id ? away.team : id === home.team.id ? home.team : undefined;
  const awayColor = courtColor(away.team.color);
  const homeColor = courtColor(home.team.color);
  const clockText = /half/i.test(game.statusDetail)
    ? "Halftime"
    : onBreak
      ? game.statusDetail
      : `${periodName(game.period)} ${game.clock}`.trim();
  const spread = game.odds?.spread;
  const favorite = spread == null || spread === 0 ? null : spread < 0 ? home.team : away.team;
  const spreadLabel =
    spread == null
      ? "—"
      : spread === 0
        ? "PK"
        : `-${Math.abs(spread).toFixed(1).replace(/\.0$/, "")}`;

  // Away shoots at the right basket, home at the left (like the NFL field's drive arrow).
  let marker: { x: number; y: number; color: string; value: number } | undefined;
  if (shot) {
    const { depth, off } = shotPoint(shot.x, shot.y, shot.value);
    marker =
      shot.teamId === away.team.id
        ? { x: W - depth, y: MID + off, color: awayColor, value: shot.value }
        : { x: depth, y: MID - off, color: homeColor, value: shot.value };
  }
  const lastTeam = teamFor(last?.teamId);
  const runTeam = teamFor(run?.teamId);

  // Same sizes as the NFL live scoreboard and the NBA final header.
  const side = (s: typeof away, i: number) => (
    <div className={`flex items-center gap-3 sm:gap-6 ${i === 1 ? "flex-row-reverse" : ""}`}>
      <TimeoutDots remaining={i === 0 ? timeouts.away : timeouts.home} total={7} />
      <Link
        to="/nba/teams/$teamId"
        params={{ teamId: s.team.id }}
        className="group flex flex-col items-center gap-1 text-center"
      >
        <NbaLogo
          team={s.team}
          className="size-10 transition-transform group-hover:scale-105 sm:size-14"
        />
        <span className="font-mono text-xs text-mute group-hover:text-acc">{s.record ?? ""}</span>
      </Link>
      <span className="font-mono text-3xl font-bold tabular-nums sm:text-5xl">{s.score ?? 0}</span>
    </div>
  );

  return (
    <Panel className="mb-6">
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        {side(away, 0)}
        <div className="flex flex-col items-center justify-center gap-1.5 px-2 text-center">
          {badge ? (
            <span className="whitespace-nowrap rounded border border-win/30 bg-win/10 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-win">
              {badge}
            </span>
          ) : null}
          <span
            className="flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wider text-win sm:text-sm"
            suppressHydrationWarning
          >
            <span className="size-2 animate-pulse rounded-full bg-win" />
            {clockText}
          </span>
        </div>
        {side(home, 1)}
      </div>

      <div
        className="mx-auto mt-4 max-w-2xl overflow-hidden rounded-lg border p-3"
        style={{
          borderColor: "var(--court-edge)",
          background: "color-mix(in oklch, var(--court) 70%, black)",
        }}
      >
        <div className="mb-2 flex flex-col gap-1 font-mono text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          {last ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {lastTeam ? <NbaLogo team={lastTeam} className="size-4 sm:size-5" /> : null}
              <span className="font-semibold text-foreground">Last play</span>
              <span className="text-mute">·</span>
              <span className="truncate text-foreground/90">{last.text}</span>
            </span>
          ) : (
            <span className="text-mute">Waiting for the first play</span>
          )}
          {run && runTeam ? (
            <span
              className="shrink-0 font-semibold uppercase tracking-wider"
              style={{ color: run.teamId === away.team.id ? awayColor : homeColor }}
            >
              {runTeam.abbr} {run.points}-0 run
            </span>
          ) : null}
        </div>

        <svg
          viewBox={`0 0 ${W} ${VH}`}
          className="block w-full text-foreground"
          role="img"
          aria-label="Court with the latest made basket"
        >
          <rect width={W} height={VH} rx={8} fill="var(--court)" />
          <Basket side="left" color={homeColor} />
          <Basket side="right" color={awayColor} />
          <line x1={W / 2} x2={W / 2} y1={0} y2={VH} {...LINE} />
          <circle cx={W / 2} cy={MID} r={FT_RADIUS} {...LINE} />
          {!onBreak ? (
            <foreignObject x={W / 2 - 36} y={MID - 36} width={72} height={72}>
              <NbaLogo team={home.team} className="size-full opacity-85" />
            </foreignObject>
          ) : null}
          <rect x={1} y={1} width={W - 2} height={VH - 2} rx={8} {...LINE} />

          {marker ? (
            <g>
              <circle
                cx={marker.x}
                cy={marker.y}
                r={14}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.5}
                strokeWidth={2}
              >
                <animate attributeName="r" values="14;30;14" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle
                cx={marker.x}
                cy={marker.y}
                r={13}
                fill={marker.color}
                stroke="currentColor"
                strokeOpacity={0.9}
                strokeWidth={2.5}
              />
              <text
                x={marker.x + (marker.x > W / 2 ? -22 : 22)}
                y={marker.y + 10}
                textAnchor={marker.x > W / 2 ? "end" : "start"}
                fontSize={30}
                fontWeight={800}
                fill="currentColor"
                className="font-disp"
              >
                +{marker.value}
              </text>
            </g>
          ) : null}

          {onBreak ? (
            <g>
              <rect width={W} height={VH} rx={8} fill="var(--bg)" fillOpacity={0.55} />
              <text
                x={W / 2}
                y={MID + 26}
                textAnchor="middle"
                fontSize={78}
                fontWeight={800}
                letterSpacing={6}
                fill="currentColor"
                className="font-disp uppercase"
              >
                {/half/i.test(game.statusDetail) ? "Halftime" : (badge ?? "Break")}
              </text>
            </g>
          ) : null}
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
        <span>Spread:</span>
        {favorite ? (
          <span className="inline-flex items-center gap-1">
            <NbaLogo team={favorite} className="size-4" />
            <span className="font-semibold text-foreground">{spreadLabel}</span>
          </span>
        ) : (
          <span className="font-semibold text-foreground">{spreadLabel}</span>
        )}
        <span>·</span>
        <span>
          O/U: <span className="font-semibold text-foreground">{game.odds?.total ?? "—"}</span>
        </span>
        {game.broadcast ? (
          <>
            <span>·</span>
            <span>{game.broadcast}</span>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
