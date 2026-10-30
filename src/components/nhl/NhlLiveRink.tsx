/**
 * Live NHL scoreboard with a rink, the hockey version of the NFL field and the NBA court: a timeout
 * dot by each logo (one a game), the clock with a badge (power play and its time left, end of a
 * period, timeout), the latest goal on the rink, the last play and shots on goal.
 */
import { Link } from "@tanstack/react-router";
import { NhlLogo } from "@/components/nhl/NhlBits";
import { Panel, TimeoutDots } from "@/components/shared/booth";
import type { NhlGame, NhlPlay, NhlTeamRef } from "@/lib/nhl/nhl";
import {
  clockDisplay,
  isBreak,
  latestGoal,
  liveBadge,
  nhlTimeoutsLeft,
  shotsOnGoal,
} from "@/lib/nhl/nhl-live";

/** A flat, top-down rink in true proportions (200 × 85 ft, 4 svg units per foot). */
const F = 4;
const W = 200 * F;
const H = 85 * F;
const MID = H / 2;
const RED = { stroke: "var(--rink-red)", strokeOpacity: 0.75 } as const;
const BLUE = { stroke: "var(--rink-blue)", strokeOpacity: 0.85 } as const;

const periodName = (p: number) =>
  p > 3 ? (p === 4 ? "OT" : `${p - 3}OT`) : (["1st", "2nd", "3rd"][p - 1] ?? "");

/** Team colors on dark ice: lift very dark brand colors so they stay visible. */
function iceColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "var(--acc)";
  const n = parseInt(m[1], 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum >= 0.35) return `#${m[1]}`;
  const t = Math.min(0.6, 0.35 - lum + 0.25);
  return `#${rgb
    .map((c) =>
      Math.round(c + (255 - c) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function EndZone({ side }: { side: "left" | "right" }) {
  const left = side === "left";
  const at = (ft: number) => (left ? ft * F : W - ft * F);
  return (
    <g>
      <line x1={at(11)} x2={at(11)} y1={8 * F} y2={H - 8 * F} {...RED} strokeWidth={2} />
      <path
        d={`M ${at(11)} ${MID - 6 * F} A ${6 * F} ${6 * F} 0 0 ${left ? 1 : 0} ${at(11)} ${MID + 6 * F}`}
        fill="var(--rink-blue)"
        fillOpacity={0.3}
        {...RED}
        strokeWidth={1.5}
      />
      <rect
        x={left ? at(11) - 4 * F : at(11)}
        y={MID - 3 * F}
        width={4 * F}
        height={6 * F}
        fill="none"
        {...RED}
        strokeWidth={2}
      />
      {[MID - 22 * F, MID + 22 * F].map((y) => (
        <g key={y}>
          <circle cx={at(31)} cy={y} r={15 * F} fill="none" {...RED} strokeWidth={1.5} />
          <circle cx={at(31)} cy={y} r={4} fill="var(--rink-red)" fillOpacity={0.8} />
          <circle cx={at(80)} cy={y} r={4} fill="var(--rink-red)" fillOpacity={0.8} />
        </g>
      ))}
      <line x1={at(75)} x2={at(75)} y1={2} y2={H - 2} {...BLUE} strokeWidth={5} />
    </g>
  );
}

export function NhlLiveScoreboard({ game, plays }: { game: NhlGame; plays: NhlPlay[] }) {
  const { away, home } = game;
  const timeouts = nhlTimeoutsLeft(plays, game);
  const badge = liveBadge(plays, game);
  const onBreak = isBreak(game);
  const goal = onBreak ? undefined : latestGoal(plays, game);
  const sog = shotsOnGoal(plays, game);
  const last = [...plays].reverse().find((p) => p.text.trim());
  const teamFor = (id?: string): NhlTeamRef | undefined =>
    id === away.team.id ? away.team : id === home.team.id ? home.team : undefined;
  const awayColor = iceColor(away.team.color);
  const homeColor = iceColor(home.team.color);
  const clockText = /intermission/i.test(game.statusDetail)
    ? game.statusDetail
    : onBreak
      ? game.statusDetail
      : `${periodName(game.period)} ${clockDisplay(game.clock)}`.trim();
  const spread = game.odds?.spread;
  const favorite = spread == null || spread === 0 ? null : spread < 0 ? home.team : away.team;
  const spreadLabel = spread == null ? "—" : `-${Math.abs(spread).toFixed(1).replace(/\.0$/, "")}`;

  // Away team's goals at the right net, home team's at the left (like the NFL field and NBA court).
  let marker: { x: number; y: number; color: string } | undefined;
  if (goal?.spot) {
    const toRight = goal.teamId === away.team.id;
    const flip = toRight ? goal.spot.x < 0 : goal.spot.x > 0;
    const x = flip ? -goal.spot.x : goal.spot.x;
    const y = flip ? -goal.spot.y : goal.spot.y;
    marker = { x: (100 + x) * F, y: (42.5 - y) * F, color: toRight ? awayColor : homeColor };
  }
  const lastTeam = teamFor(last?.teamId);
  const goalTeam = teamFor(goal?.teamId);

  // Same sizes as the NFL live scoreboard and the NBA scoreboard.
  const side = (s: typeof away, i: number) => (
    <div className={`flex items-center gap-3 sm:gap-6 ${i === 1 ? "flex-row-reverse" : ""}`}>
      <TimeoutDots remaining={i === 0 ? timeouts.away : timeouts.home} total={1} />
      <Link
        to="/nhl/teams/$teamId"
        params={{ teamId: s.team.id }}
        className="group flex flex-col items-center gap-1 text-center"
      >
        <NhlLogo
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
            <span
              className={`whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider ${
                badge.tone === "pp"
                  ? "border-loss/30 bg-loss/10 text-loss"
                  : "border-win/30 bg-win/10 text-win"
              }`}
            >
              {badge.text}
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
          borderColor: "var(--rink-edge)",
          background: "color-mix(in oklch, var(--rink) 60%, black)",
        }}
      >
        <div className="mb-2 flex flex-col gap-1 font-mono text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          {last ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {lastTeam ? <NhlLogo team={lastTeam} className="size-4 sm:size-5" /> : null}
              <span className="font-semibold text-foreground">Last play</span>
              <span className="text-mute">·</span>
              <span className="truncate text-foreground/90">{last.text}</span>
            </span>
          ) : (
            <span className="text-mute">Waiting for the opening faceoff</span>
          )}
          {sog ? (
            <span className="shrink-0 tracking-wider text-mute">
              SOG{" "}
              <span className="font-semibold" style={{ color: awayColor }}>
                {away.team.abbr} {sog.awayTotal}
              </span>{" "}
              ·{" "}
              <span className="font-semibold" style={{ color: homeColor }}>
                {home.team.abbr} {sog.homeTotal}
              </span>
            </span>
          ) : null}
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full text-foreground"
          role="img"
          aria-label="Rink with the latest goal"
        >
          <rect x={1} y={1} width={W - 2} height={H - 2} rx={28 * F} fill="var(--rink)" />
          <EndZone side="left" />
          <EndZone side="right" />
          <line x1={W / 2} x2={W / 2} y1={2} y2={H - 2} {...RED} strokeWidth={5} />
          <circle cx={W / 2} cy={MID} r={15 * F} fill="none" {...BLUE} strokeWidth={1.5} />
          {!onBreak ? (
            <foreignObject x={W / 2 - 40} y={MID - 40} width={80} height={80}>
              <NhlLogo team={home.team} className="size-full opacity-85" />
            </foreignObject>
          ) : null}
          <rect
            x={1}
            y={1}
            width={W - 2}
            height={H - 2}
            rx={28 * F}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.45}
            strokeWidth={2}
          />

          {marker ? (
            <g>
              <circle
                cx={marker.x}
                cy={marker.y}
                r={10}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.5}
                strokeWidth={2}
              >
                <animate attributeName="r" values="10;22;10" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle
                cx={marker.x}
                cy={marker.y}
                r={9}
                fill={marker.color}
                stroke="currentColor"
                strokeWidth={2.5}
              />
              <text
                x={marker.x + (marker.x > W / 2 ? -20 : 20)}
                y={marker.y + 8}
                textAnchor={marker.x > W / 2 ? "end" : "start"}
                fontSize={24}
                fontWeight={800}
                fill="currentColor"
                className="font-disp"
              >
                GOAL
              </text>
            </g>
          ) : null}

          {onBreak ? (
            <g>
              <rect
                x={1}
                y={1}
                width={W - 2}
                height={H - 2}
                rx={28 * F}
                fill="var(--bg)"
                fillOpacity={0.55}
              />
              <text
                x={W / 2}
                y={MID + 20}
                textAnchor="middle"
                fontSize={58}
                fontWeight={800}
                letterSpacing={5}
                fill="currentColor"
                className="font-disp uppercase"
              >
                Intermission
              </text>
            </g>
          ) : null}
        </svg>

        {goal && goalTeam ? (
          <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-mute">
            <NhlLogo team={goalTeam} className="size-4" />
            <span className="truncate">
              Last goal: {goal.text}
              {goal.strength && !/even/i.test(goal.strength) ? ` · ${goal.strength}` : ""} ·{" "}
              {periodName(goal.period)} {clockDisplay(goal.clock)}
            </span>
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
        <span>Puck line:</span>
        {favorite ? (
          <span className="inline-flex items-center gap-1">
            <NhlLogo team={favorite} className="size-4" />
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
