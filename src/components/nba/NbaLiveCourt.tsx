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

const FT = 10; // svg units per foot; the court is 94 × 50 feet
const W = 94 * FT;
const H = 50 * FT;
/** The court is drawn squashed top to bottom, like a tilted TV view, to keep the card short. */
const K = 0.6;
const VH = H * K;

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
  const base = left ? 0 : W;
  const s = left ? 1 : -1;
  const hoop = base + s * 5.25 * FT;
  const arcX = hoop + s * Math.sqrt(23.75 ** 2 - 22 ** 2) * FT;
  const line = {
    stroke: "currentColor",
    strokeOpacity: 0.28,
    strokeWidth: 1.5,
    fill: "none",
    vectorEffect: "non-scaling-stroke",
  } as const;
  return (
    <g>
      <rect
        x={left ? 0 : W - 19 * FT}
        y={17 * FT}
        width={19 * FT}
        height={16 * FT}
        fill={color}
        fillOpacity={0.28}
      />
      <rect x={left ? 0 : W - 19 * FT} y={17 * FT} width={19 * FT} height={16 * FT} {...line} />
      <circle cx={base + s * 19 * FT} cy={H / 2} r={6 * FT} {...line} />
      <path
        d={`M ${base} ${3 * FT} L ${arcX} ${3 * FT} A ${23.75 * FT} ${23.75 * FT} 0 0 ${left ? 1 : 0} ${arcX} ${H - 3 * FT} L ${base} ${H - 3 * FT}`}
        {...line}
      />
      <line
        x1={base + s * 4 * FT}
        x2={base + s * 4 * FT}
        y1={H / 2 - 3 * FT}
        y2={H / 2 + 3 * FT}
        stroke="currentColor"
        strokeOpacity={0.6}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={hoop}
        cy={H / 2}
        r={0.75 * FT}
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
    const depth = Math.min(47, Math.max(0, shot.y + 5)) * FT;
    const across = Math.min(50, Math.max(0, shot.x)) * FT;
    marker =
      shot.teamId === away.team.id
        ? { x: W - depth, y: across * K, color: awayColor, value: shot.value }
        : { x: depth, y: (H - across) * K, color: homeColor, value: shot.value };
  }
  const lastTeam = teamFor(last?.teamId);
  const runTeam = teamFor(run?.teamId);

  const side = (s: typeof away, i: number) => (
    <div
      className={`flex min-w-0 items-center gap-2 sm:gap-4 ${i === 1 ? "flex-row-reverse" : ""}`}
    >
      <TimeoutDots remaining={i === 0 ? timeouts.away : timeouts.home} total={7} />
      <Link to="/nba/teams/$teamId" params={{ teamId: s.team.id }} className="shrink-0">
        <NbaLogo team={s.team} className="size-10 sm:size-14" />
      </Link>
      <div className="flex flex-col items-center">
        <span className="font-mono text-3xl font-bold tabular-nums sm:text-5xl">
          {s.score ?? 0}
        </span>
        <span className="font-mono text-[10px] text-mute sm:text-xs">{s.record ?? ""}</span>
      </div>
    </div>
  );

  return (
    <Panel className="mb-6">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
        {side(away, 0)}
        <div className="flex shrink-0 flex-col items-center gap-1.5 text-center">
          {badge ? (
            <span className="whitespace-nowrap rounded border border-win/30 bg-win/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-win sm:px-3 sm:text-xs">
              {badge}
            </span>
          ) : null}
          <span
            className="flex items-center gap-1.5 font-disp text-base font-bold tracking-wide text-win sm:text-2xl"
            suppressHydrationWarning
          >
            <span className="size-2 animate-pulse rounded-full bg-win sm:size-2.5" />
            {clockText}
          </span>
        </div>
        {side(home, 1)}
      </div>

      <div
        className="mx-auto mt-4 max-w-lg rounded-lg border p-2 sm:p-3"
        style={{
          borderColor: "var(--court-edge)",
          background: "color-mix(in oklch, var(--court) 70%, black)",
        }}
      >
        <div className="mb-2 flex flex-col gap-1 font-mono text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:text-xs">
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
          <rect width={W} height={VH} rx={10} fill="var(--court)" />
          <g transform={`scale(1 ${K})`}>
            <Basket side="left" color={homeColor} />
            <Basket side="right" color={awayColor} />
            <line
              x1={W / 2}
              x2={W / 2}
              y1={0}
              y2={H}
              stroke="currentColor"
              strokeOpacity={0.28}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={W / 2}
              cy={H / 2}
              r={6 * FT}
              stroke="currentColor"
              strokeOpacity={0.28}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <circle
              cx={W / 2}
              cy={H / 2}
              r={4.4 * FT}
              fill={homeColor}
              fillOpacity={0.15}
              stroke={homeColor}
              strokeOpacity={0.5}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          {!onBreak ? (
            <foreignObject
              x={W / 2 - 2.1 * FT}
              y={VH / 2 - 2.1 * FT}
              width={4.2 * FT}
              height={4.2 * FT}
            >
              <NbaLogo team={home.team} className="size-full opacity-85" />
            </foreignObject>
          ) : null}
          <rect
            x={1}
            y={1}
            width={W - 2}
            height={VH - 2}
            rx={10}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.28}
            strokeWidth={2}
          />

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
                strokeWidth={3}
              />
              <text
                x={marker.x + (marker.x > W / 2 ? 18 : -18)}
                y={marker.y < 60 ? marker.y + 44 : marker.y - 24}
                textAnchor={marker.x > W / 2 ? "start" : "end"}
                fontSize={26}
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
              <rect width={W} height={VH} rx={10} fill="var(--bg)" fillOpacity={0.55} />
              <text
                x={W / 2}
                y={VH / 2 + 24}
                textAnchor="middle"
                fontSize={70}
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
