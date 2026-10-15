import { useEffect, useId, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  DriveTable,
  FootballIcon,
  LineScore,
  PageTitle,
  Panel,
  GameInformation,
  MatchupPredictor,
  SeasonLeaders,
  PlayByPlay,
  StatComparison,
  TeamLogo,
  TimeoutDots,
  SpreadBadge,
  marketResultClass,
} from "@/components/booth";
import { gameScore, type BoxScoreLine, type Game, type GameProbabilityPoint } from "@/data/games";
import { teamById, type Team } from "@/data/teams";
import { getGameWeather, getLiveGame, getTeamSeasonAverages } from "@/lib/espn.functions";
import { GameWeatherCard } from "@/components/GameWeatherCard";
import { showGameStatistics } from "@/lib/game-visibility";
import { DraftKingsPropsBoard } from "@/components/DraftKingsPropsBoard";

export const Route = createFileRoute("/games/$gameId")({
  loader: () => {
    // Every game on GamblingNFL comes directly from the ESPN NFL feed.
    // There are no local/sample games.
    return { game: null };
  },

  head: ({ params }) => {
    return {
      meta: [
        { title: "Game — GamblingNFL" },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        {
          name: "description",
          content:
            "NFL game detail: quarter-by-quarter line score, drive chart, team statistics, and box score.",
        },
        { property: "og:title", content: "Game — GamblingNFL" },
        {
          property: "og:description",
          content:
            "NFL game breakdown with line score, drives, team stats, and box score.",
        },
      ],
    };
  },

  component: GamePage,
});

/* ---------- Interactive 100-Yard Field Visualizer ---------- */

function LiveFieldTrack({
  game,
  away,
  home,
}: {
  game: Game;
  away: Team;
  home: Team;
}) {
  if (game.status !== "live") return null;
  // At halftime the field is shown plain: no ball, line of scrimmage, first-down line or down banner.
  const isHalftime = /half/i.test(game.clock ?? "");
  if (!isHalftime && !game.possession) return null;

  const isAwayPossession = game.possession === "away";
  const possessingTeam = isAwayPossession ? away : home;
  const text = (game.possessionText ?? "").trim().toUpperCase();
  const spotMatch = text.match(/^([A-Z]{2,4})\s+(\d{1,2})$/);
  const isMidfield = text === "50" || (!!spotMatch && Number(spotMatch[2]) === 50);

  // Calculate ball yard on 0-100 scale
  // 0 = Away endzone, 100 = Home endzone
  let ballYard = 50;

  if (text === "50") {
    ballYard = 50;
  } else {
    const m = text.match(/^([A-Z]{2,4})\s+(\d{1,2})$/);

    if (m) {
      const side = m[1];
      const yd = parseInt(m[2], 10);

      if (side === away.abbr.toUpperCase()) {
        ballYard = yd;
      } else if (side === home.abbr.toUpperCase()) {
        ballYard = 100 - yd;
      }
    }
  }

  const dist =
    typeof game.distance === "number" && game.distance > 0
      ? game.distance
      : 10;

  const firstDownYard = isAwayPossession
    ? Math.min(100, ballYard + dist)
    : Math.max(0, ballYard - dist);

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-emerald-500/20 bg-[#091b11] p-3 shadow-inner">
      {!isHalftime ? (
        <>
        {/* Field status banner */}
        <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-emerald-400">
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <FootballIcon isRedZone={game.isRedZone} />
            <span>{game.downDistance ?? "1st & 10"}</span>
            <span className="text-mute">·</span>
            <span className="inline-flex items-center gap-1">
              {isMidfield ? "50" : spotMatch ? <><TeamLogo team={teamById(spotMatch[1] === away.abbr ? away.id : home.id) ?? (spotMatch[1] === away.abbr ? away : home)} className="size-4" />{spotMatch[2]}</> : game.possessionText ?? "50"}
            </span>
          </span>

          <span className="flex items-center gap-1 text-acc font-semibold">
            <span>Drive</span>
            <span>{isAwayPossession ? "→" : "←"}</span>
          </span>
        </div>

        </>
      ) : null}

      {/* Field surface */}
      <div className="relative flex h-14 sm:h-16 w-full select-none overflow-hidden rounded border border-emerald-600/30 bg-[#0e2c1a]">
        {/* Away End Zone */}
        <div
          className="flex w-[10%] shrink-0 items-center justify-center border-r border-emerald-500/30 text-center font-disp text-xs sm:text-sm font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: `${away.color}cc` }}
        >
          <TeamLogo team={away} className="size-7 sm:size-9 drop-shadow-sm" />
        </div>

        {/* 100-Yard Field */}
        <div className="relative h-full w-[80%] shrink-0">
          <div className="absolute inset-0 flex justify-between pointer-events-none">
            {[10, 20, 30, 40, 50, 40, 30, 20, 10].map(
              (yd, idx) => (
                <div
                  key={idx}
                  className="relative flex h-full flex-col justify-between border-l border-white/15 px-0.5 text-center"
                  style={{ width: "10%" }}
                >
                  <span className="font-mono text-[8px] sm:text-[9px] text-white/40">
                    {yd}
                  </span>
                  <span className="font-mono text-[8px] sm:text-[9px] text-white/40">
                    {yd}
                  </span>
                </div>
              ),
            )}
          </div>

          {/* 50 Yard Midfield Line */}
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/35" />

          {!isHalftime ? (
            <>
              {/* Yellow First Down Line */}
              <div
                className="absolute top-0 z-10 h-full w-[2px] bg-amber-300 drop-shadow-[0_0_4px_rgba(250,204,21,0.9)]"
                style={{ left: `${firstDownYard}%` }}
              >
                <div className="absolute -top-0.5 -translate-x-1/2 rounded bg-amber-400 px-1 font-mono text-[7px] font-bold text-black uppercase">
                  1st
                </div>
              </div>

              {/* Line of Scrimmage */}
              <div
                className="absolute top-0 z-20 h-full w-[2px] drop-shadow-[0_0_6px_rgba(0,0,0,0.9)]"
                style={{
                  left: `${ballYard}%`,
                  backgroundColor:
                    possessingTeam.color ?? "#ffffff",
                }}
              >
                <div
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full p-0.5 shadow-[0_0_8px_rgba(0,0,0,0.8)]"
                  style={{
                    backgroundColor:
                      possessingTeam.color ?? "#38bdf8",
                  }}
                >
                  <FootballIcon isRedZone={game.isRedZone} />
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Home End Zone */}
        <div
          className="flex w-[10%] shrink-0 items-center justify-center border-l border-emerald-500/30 text-center font-disp text-xs sm:text-sm font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: `${home.color}cc` }}
        >
          <TeamLogo team={home} className="size-7 sm:size-9 drop-shadow-sm" />
        </div>
      </div>
    </div>
  );
}

type ProbabilityKey = "homeWinProbability" | "homeCoverProbability" | "overProbability";

const QUARTER_LABELS = ["", "1st", "2nd", "3rd", "4th", "OT"];

function clockToSeconds(clock?: string): number | undefined {
  if (!clock) return undefined;
  const match = clock.match(/^(\d+):(\d{2})/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const seconds = Number(clock);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Seconds of game time elapsed at a probability sample (overtime continues past 3600). */
function elapsedGameSeconds(point: GameProbabilityPoint): number | undefined {
  const clock = clockToSeconds(point.clock);
  if (point.quarter && clock !== undefined) {
    if (point.quarter <= 4) return (point.quarter - 1) * 900 + (900 - Math.min(clock, 900));
    return 3600 + (point.quarter - 5) * 600 + (600 - Math.min(clock, 600));
  }
  if (typeof point.secondsLeft === "number") return Math.max(0, 3600 - point.secondsLeft);
  return undefined;
}

/**
 * Smooth monotone cubic curve through the points (no overshoot), like ESPN's graphs,
 * instead of straight segments between every play.
 */
function smoothSegments(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n < 2) return "";
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const w = points[i + 1].x - points[i].x;
    dx.push(w);
    slope.push(w === 0 ? 0 : (points[i + 1].y - points[i].y) / w);
  }
  const tangent: number[] = new Array(n).fill(0);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const sum = a * a + b * b;
    if (sum > 9) {
      const tau = 3 / Math.sqrt(sum);
      tangent[i] = tau * a * slope[i];
      tangent[i + 1] = tau * b * slope[i];
    }
  }
  let d = "";
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const third = dx[i] / 3;
    d += ` C${(p0.x + third).toFixed(2)},${(p0.y + tangent[i] * third).toFixed(2)} ${(p1.x - third).toFixed(2)},${(p1.y - tangent[i + 1] * third).toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
  }
  return d;
}

/**
 * ESPN-style probability graph: away team on top, home team on the bottom, 50% in the middle.
 * The line is drawn in the away color while the away team is ahead and in the home
 * color while the home team is ahead. Hover/touch shows the play, score and clock.
 */
function ProbabilityGraph({
  points,
  probabilityKey,
  away,
  home,
  unavailableText,
  totalLine,
}: {
  points: GameProbabilityPoint[];
  probabilityKey: ProbabilityKey;
  away: Team;
  home: Team;
  unavailableText: string;
  totalLine?: number;
}) {
  // Win/cover graphs: away on top, home on the bottom. Total graph: Over on top, Under on the bottom.
  const isTotal = probabilityKey === "overProbability";
  // Total graph: Over is green (top), Under is red (bottom).
  const topColor = isTotal ? "#16a34a" : away.color;
  const bottomColor = isTotal ? "#dc2626" : home.color;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const uid = useId().replace(/:/g, "");

  const usable = points
    .map((point, index) => ({ point, index, raw: point[probabilityKey] }))
    .filter((entry): entry is { point: GameProbabilityPoint; index: number; raw: number } => typeof entry.raw === "number")
    // value = probability of the bottom side (home team, or Under for totals); 0 = top side certain.
    .map((entry) => ({ point: entry.point, index: entry.index, raw: entry.raw, value: isTotal ? 1 - entry.raw : entry.raw }));

  // Stop the Total graph at the first mathematically decisive point.
  // Over is locked once the actual combined score exceeds the total line.
  // Under can also be locked during NFL overtime when even a deliberately
  // generous upper bound of 24 additional OT points cannot reach the line.
  // (24 is the maximum under the current NFL OT scoring sequence: both teams
  // can each score a TD + 2, then the next score can be another TD + 2.)
  if (isTotal) {
    const overLockedIndex = usable.findIndex((entry) => {
      const score = (entry.point.awayScore ?? 0) + (entry.point.homeScore ?? 0);
      return score > (totalLine ?? Number.POSITIVE_INFINITY);
    });
    const underLockedIndex = totalLine === undefined ? -1 : usable.findIndex((entry) => {
      const quarter = entry.point.quarter ?? 0;
      const awayScore = entry.point.awayScore;
      const homeScore = entry.point.homeScore;
      if (quarter < 5 || typeof awayScore !== "number" || typeof homeScore !== "number") return false;
      return awayScore + homeScore + 24 < totalLine;
    });

    // Prefer whichever decisive condition occurs first. Force the endpoint to
    // the mathematically correct 100% side even if ESPN's probability is stale.
    const decisiveIndex = [overLockedIndex, underLockedIndex]
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    if (decisiveIndex !== undefined) {
      const decisive = usable[decisiveIndex];
      const score = (decisive.point.awayScore ?? 0) + (decisive.point.homeScore ?? 0);
      const overIsLocked = totalLine !== undefined && score > totalLine;
      decisive.raw = overIsLocked ? 1 : 0;
      decisive.value = overIsLocked ? 0 : 1;
      usable.splice(decisiveIndex + 1);
    }
  } else {
    // Moneyline and spread: once either side reaches exactly 100%, end the
    // plotted series there so the graph border finishes at the same point.
    const lockedIndex = usable.findIndex((entry) => entry.raw <= 0 || entry.raw >= 1);
    if (lockedIndex >= 0) usable.splice(lockedIndex + 1);
  }

  if (usable.length < 2) {
    return (
      <div className="mt-4 rounded-lg border border-line/10 bg-panel2/30 px-4 py-10 text-center">
        <p className="font-semibold">Not available yet</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-mute">{unavailableText}</p>
      </div>
    );
  }

  // Layout (viewBox units).
  const width = 640;
  const height = 240;
  const plotLeft = 0;
  const plotRight = 596;
  const plotTop = 10;
  const plotBottom = 206;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const midY = plotTop + plotHeight / 2;

  // X positions follow game time, so a live game fills in from the left like ESPN's.
  let running = 0;
  const elapsed = usable.map((entry, i) => {
    const raw = elapsedGameSeconds(entry.point);
    const fallback = (i / Math.max(1, usable.length - 1)) * 3600;
    running = Math.max(running, raw ?? fallback);
    return running;
  });
  const domain = Math.max(3600, elapsed[elapsed.length - 1] || 3600);
  const xFor = (seconds: number) => plotLeft + (seconds / domain) * plotWidth;
  // When any graph reaches a decisive 100% endpoint, end the border there
  // instead of leaving an empty bordered tail. Total can lock on Over (raw 1)
  // or Under (raw 0); moneyline/spread can lock for either team (raw 0 or 1).
  const finalRaw = usable[usable.length - 1]?.raw;
  const graphIsLocked = isTotal
    ? finalRaw === 0 || finalRaw >= 1
    : finalRaw <= 0 || finalRaw >= 1;
  const graphRight = graphIsLocked
    ? Math.max(plotLeft + 24, xFor(elapsed[elapsed.length - 1]))
    : plotRight;
  // value is the home probability: 0 = away certain (top), 1 = home certain (bottom).
  const yFor = (value: number) => plotTop + Math.max(0, Math.min(1, value)) * plotHeight;

  const coords = usable.map((entry, i) => ({ x: xFor(elapsed[i]), y: yFor(entry.value) }));
  const curve = smoothSegments(coords);
  const linePath = `M${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}${curve}`;
  const areaPath = `M${coords[0].x.toFixed(2)},${midY} L${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}${curve} L${coords[coords.length - 1].x.toFixed(2)},${midY} Z`;

  // Quarter labels sit on their starting boundaries: Q1 at the left border,
  // Q2/Q3/Q4 at the first three dotted dividers, and OT at the fourth divider.
  const quarterTicks = [0, 1, 2, 3]
    .map((q) => ({ label: QUARTER_LABELS[q + 1], x: xFor(q * 900) }))
    .filter((tick) => tick.x <= graphRight);
  const hasOvertime = domain > 3600;
  if (hasOvertime) {
    const overtimeTick = { label: "OT", x: xFor(3600) };
    if (overtimeTick.x <= graphRight) quarterTicks.push(overtimeTick);
  }
  // Interior quarter dividers only; the outer edge is the border. The 4th/OT divider appears only in overtime games.
  const quarterLines = (hasOvertime ? [1, 2, 3, 4] : [1, 2, 3])
    .map((q) => xFor(q * 900))
    .filter((x) => x < graphRight);

  const activeEntry = hoverIndex === null ? usable[usable.length - 1] : usable[hoverIndex];
  const homePct = Math.round(activeEntry.value * 100);
  const awayPct = 100 - homePct;
  const selected = hoverIndex === null ? null : usable[hoverIndex].point;

  const handleMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestDistance = Infinity;
    coords.forEach((c, i) => {
      const distance = Math.abs(c.x - px);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    setHoverIndex(best);
  };

  const ordinal = (n?: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n ? `${n}th` : "");
  const headerRow = (kind: "top" | "bottom", pct: number) => {
    const dotted = false;
    const color = kind === "top" ? topColor : bottomColor;
    const team = kind === "top" ? away : home;
    const label = isTotal ? (kind === "top" ? "Over" : "Under") : team.abbr;
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isTotal ? null : <TeamLogo team={team} className="size-8" />}
          <span className="font-mono text-sm font-semibold">{label}</span>
          <span
            className="inline-block h-0 w-6 border-t-2"
            style={{ borderColor: color, borderStyle: dotted ? "dotted" : "solid" }}
          />
        </div>
        <div className="flex items-center gap-2">
          {isTotal && totalLine ? (
            <span className="rounded border border-line/10 px-1.5 py-0.5 font-mono text-xs text-mute">
              {kind === "top" ? "o" : "u"}
              {totalLine}
            </span>
          ) : null}
          <span className="font-disp text-2xl font-bold tabular-nums">{pct}%</span>
        </div>
      </div>
    );
  };

  const estimatedMarket = probabilityKey === "overProbability" ? "over" : "cover";
  const estimated = probabilityKey !== "homeWinProbability" && points.some((p) => p.estimatedMarkets?.includes(estimatedMarket));

  return (
    <div className="mt-4">
      {headerRow("top", awayPct)}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="mt-1 block w-full touch-pan-y select-none"
        role="img"
        aria-label={probabilityKey === "homeWinProbability" ? "Win probability over the game" : probabilityKey === "homeCoverProbability" ? "Cover probability over the game" : "Total probability over the game"}
        onMouseMove={(event) => handleMove(event.clientX)}
        onMouseLeave={() => setHoverIndex(null)}
        onTouchStart={(event) => handleMove(event.touches[0].clientX)}
        onTouchMove={(event) => handleMove(event.touches[0].clientX)}
        onTouchEnd={() => setHoverIndex(null)}
      >
        <defs>
          <clipPath id={`${uid}-top`}>
            <rect x={plotLeft} y={plotTop} width={plotWidth} height={midY - plotTop} />
          </clipPath>
          <clipPath id={`${uid}-bottom`}>
            <rect x={plotLeft} y={midY} width={plotWidth} height={plotBottom - midY} />
          </clipPath>
        </defs>
        {/* Keep only the 50% horizontal reference line; retain quarter boundaries. */}
        {[0.5].map((t) => (
          <line key={t} x1={plotLeft} x2={graphRight} y1={plotTop + t * plotHeight} y2={plotTop + t * plotHeight} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="1 4" />
        ))}
        {quarterLines.map((x) => (
          <line key={x} x1={x} x2={x} y1={plotTop} y2={plotBottom} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="1 4" />
        ))}
        {/* Shaded area between the line and 50%: away color above, home color below. */}
        <path d={areaPath} fill={topColor} fillOpacity="0.16" clipPath={`url(#${uid}-top)`} />
        <path d={areaPath} fill={bottomColor} fillOpacity="0.16" clipPath={`url(#${uid}-bottom)`} />
        {/* Away team ahead: away color. Home team ahead: home color. */}
        <path d={linePath} fill="none" stroke={topColor} strokeWidth="2" clipPath={`url(#${uid}-top)`} />
        <path d={linePath} fill="none" stroke={bottomColor} strokeWidth="2" clipPath={`url(#${uid}-bottom)`} />
        {/* Border around the whole graph: same weight and shade as the tab bar border. */}
        <rect x={plotLeft} y={plotTop} width={graphRight - plotLeft} height={plotHeight} rx="8" fill="none" className="stroke-line/10" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {hoverIndex !== null ? (
          <g>
            <line x1={coords[hoverIndex].x} x2={coords[hoverIndex].x} y1={plotTop} y2={plotBottom} stroke="currentColor" strokeOpacity="0.5" />
            <circle cx={coords[hoverIndex].x} cy={coords[hoverIndex].y} r="4.5" fill={usable[hoverIndex].value < 0.5 ? topColor : bottomColor} stroke="currentColor" strokeWidth="1.5" />
          </g>
        ) : null}
        {/* Axis labels: 100 / 50 / 100 on the right, quarters along the bottom. */}
        {[
          { y: plotTop, label: "100" },
          { y: midY, label: "50" },
          { y: plotBottom, label: "100" },
        ].map((tick) => (
          <text key={`${tick.y}-${tick.label}`} x={graphRight + 8} y={tick.y} dy="0.35em" fontSize="12" fill="currentColor" opacity="0.6">
            {tick.label}
          </text>
        ))}
        {quarterTicks.map((tick) => (
          <text key={tick.label} x={tick.x} y={plotBottom + 18} textAnchor={tick.label === QUARTER_LABELS[1] ? "start" : "middle"} fontSize="12" fill="currentColor" opacity="0.7">
            {tick.label}
          </text>
        ))}
      </svg>
      {headerRow("bottom", homePct)}
      <div className="mt-3 min-h-16 rounded-lg border border-line/10 bg-panel2/20 p-3 text-sm">
        {selected ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {selected.down
                    ? `${ordinal(selected.down)} & ${selected.distance ?? "—"}${selected.yardLine ? ` at ${selected.yardLine}` : ""}`
                    : "Game event"}
                </p>
                <p className="font-mono text-xs text-mute">
                  {selected.clock ?? "—"} - {QUARTER_LABELS[selected.quarter ?? 0] ?? ""}
                </p>
              </div>
              <div className="flex gap-4 text-center font-mono">
                <div>
                  <p className="font-semibold">{selected.awayScore ?? "—"}</p>
                  <p className="text-xs text-mute">{away.abbr}</p>
                </div>
                <div>
                  <p className="font-semibold">{selected.homeScore ?? "—"}</p>
                  <p className="text-xs text-mute">{home.abbr}</p>
                </div>
              </div>
            </div>
            {selected.playText ? <p className="mt-2 text-mute">{selected.playText}</p> : null}
          </>
        ) : (
          <p className="text-xs text-mute">Hover or touch the graph to see each play.</p>
        )}
      </div>
      {estimated ? (
        <p className="mt-2 text-xs text-mute">
          {isTotal
            ? "Total probability is a model estimate from the score, the clock and the pregame over/under."
            : "Cover probability is a model estimate from ESPN's win probability, the score, the clock and the pregame spread."}
        </p>
      ) : null}
    </div>
  );
}

function MarketSpreadLabel({ spread, away, home }: { spread: string; away: Team; home: Team }) {
  const match = spread.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
  if (!match) return <span>{spread || "—"}</span>;
  const abbreviation = match[1].toUpperCase();
  const team = abbreviation === away.abbr.toUpperCase() ? away : abbreviation === home.abbr.toUpperCase() ? home : undefined;
  if (!team) return <span>{spread}</span>;
  const points = Number(match[2]);
  const formatted = points === 0 ? "PK" : `${points > 0 ? "+" : ""}${points}`;
  return <span className="inline-flex items-center gap-1.5"><TeamLogo team={team} className="size-5" /><span>{formatted}</span></span>;
}

function GamePage() {
  const { gameId } = Route.useParams();

  /*
   * Every game is an ESPN NFL game.
   *
   * URL format:
   * /games/espn-<ESPN_EVENT_ID>
   */
  const eventId = gameId.replace(/^espn-/, "");

  const { data: game, isLoading } = useQuery({
    queryKey: ["nfl-game", eventId],

    queryFn: () =>
      getLiveGame({
        data: {
          eventId,
        },
      }),

    enabled: Boolean(eventId),

    /*
     * Live games update frequently.
     * Upcoming games refresh every five minutes so newly released
     * betting lines can unlock the weather card automatically.
     */
    refetchInterval: (query) => {
      const currentGame = query.state.data;

      if (currentGame?.status === "live") {
        return 3500;
      }

      if (currentGame?.status === "scheduled") {
        return 5 * 60 * 1000;
      }

      return false;
    },

    staleTime: 2000,
    retry: 2,
  });

  const { data: seasonAverages } = useQuery({
    queryKey: ["team-season-averages", game?.awayTeamId, game?.homeTeamId],
    queryFn: () => getTeamSeasonAverages({
      data: { awayTeamId: game!.awayTeamId, homeTeamId: game!.homeTeamId },
    }),
    enabled: Boolean(game?.status === "scheduled" && game.awayTeamId && game.homeTeamId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  /*
   * Weather:
   *
   * scheduled → forecast weather, but only after both spread and total exist
   * live      → current stadium weather
   * final     → historical weather at game time
   */
  const weatherQuery = useQuery({
    queryKey: [
      "weather",
      game?.id,
      game?.status,
      game?.kickoffIso,
    ],

    queryFn: async () => {
      /*
       * Pass the actual ESPN kickoff time directly.
       * The weather server does not need a second ESPN request
       * just to determine the game time.
       */
      return getGameWeather({
        data: {
          gameId: game!.id,
          homeTeamId: game!.homeTeamId,
          venue: game?.venue,
          status: game?.status ?? "scheduled",
          gameTime: game!.kickoffIso,
        },
      });
    },

    enabled: Boolean(
      game?.id &&
        game?.homeTeamId &&
        game?.kickoffIso &&
        (game.status !== "scheduled" || (
          typeof game.spread === "string" &&
          game.spread.trim().length > 0 &&
          !["—", "-", "N/A", "NA"].includes(game.spread.trim().toUpperCase()) &&
          typeof game.total === "number" &&
          game.total > 0
        )),
    ),

    /*
     * Upcoming/live weather refreshes every 12 minutes.
     * Completed-game weather never refreshes.
     */
    refetchInterval:
      game?.status === "live" ||
      game?.status === "scheduled"
        ? 12 * 60 * 1000
        : false,

    retry: 1,
  });

  const [selectedTeam, setSelectedTeam] =
    useState<"away" | "home">("away");

  const [selectedTeamTab, setSelectedTeamTab] =
    useState<"offense" | "defense">("offense");
  const [activeGameTab, setActiveGameTab] =
    useState<"gamecast" | "stats" | "markets" | "props" | "information">("gamecast");

  // The Information tab isn't offered during live games; fall back to Gamecast if a game goes live.
  useEffect(() => {
    if (game?.status === "live" && activeGameTab === "information") setActiveGameTab("gamecast");
  }, [game?.status, activeGameTab]);
  const [activeMarketTab, setActiveMarketTab] =
    useState<"moneyline" | "cover" | "total">("moneyline");

  if (isLoading) {
    return (
      <PageTitle
        eyebrow="2026 Season · ESPN"
        title="Loading game…"
      />
    );
  }

  if (!game) {
    return (
      <PageTitle
        eyebrow="2026 Season · ESPN"
        title="Game unavailable"
        aside={
          <span className="label-mono">
            ESPN detail feed not reachable
          </span>
        }
      />
    );
  }

  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);

  const score = gameScore(game);

  if (!away || !home) return null;

  // Local user kickoff formatting
  const localKickoff = game.kickoffIso
    ? `${new Date(game.kickoffIso).toLocaleDateString([], {
        weekday: "short",
      })} ${new Date(game.kickoffIso).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : (game.kickoff ?? "").replace(
        /\s*(ET|EDT|EST)$/i,
        "",
      );

  const localTime = game.kickoffIso
    ? new Date(game.kickoffIso).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : (game.time ?? "").replace(
        /\s*(ET|EDT|EST)$/i,
        "",
      );

  // Offense vs Defense filtering
  const isOffense = (line: BoxScoreLine) =>
    line.category
      ? line.category === "offense"
      : [
          "QB",
          "RB",
          "FB",
          "WR",
          "TE",
          "PASSING",
          "RUSHING",
          "RECEIVING",
        ].includes(line.position.toUpperCase());

  const awayLines = game.boxScore.filter(
    (l) => l.teamId === away.id,
  );

  const homeLines = game.boxScore.filter(
    (l) => l.teamId === home.id,
  );

  const awayOffense = awayLines.filter(isOffense);
  const awayDefense = awayLines.filter(
    (l) => !isOffense(l),
  );

  const homeOffense = homeLines.filter(isOffense);
  const homeDefense = homeLines.filter(
    (l) => !isOffense(l),
  );

  const selectedTeamLines =
    selectedTeam === "away"
      ? selectedTeamTab === "offense"
        ? awayOffense
        : awayDefense
      : selectedTeamTab === "offense"
        ? homeOffense
        : homeDefense;

  const selectedTeamData =
    selectedTeam === "away" ? away : home;

  return (
    <>
      {weatherQuery.data && game.status !== "final" ? (
        <PageTitle eyebrow="" title="" aside={<GameWeatherCard weather={weatherQuery.data} />} />
      ) : null}

      {/* Traditional NFL Score Box */}
      <Panel className="p-4 sm:p-6">
        {(() => {
          const possessingTeam =
            game.possession === "away"
              ? away
              : game.possession === "home"
                ? home
                : null;

          const isHalftime =
            game.clock === "Halftime" ||
            Boolean(
              game.clock
                ?.toLowerCase()
                .includes("half"),
            );

          const isOT =
            (game.quarters?.away?.length ?? 0) > 4 ||
            (game.quarters?.home?.length ?? 0) > 4 ||
            Boolean(
              game.clock
                ?.toUpperCase()
                .includes("OT"),
            );

          const isFinal = game.status === "final";

          const awayWon =
            isFinal && score.away > score.home;

          const homeWon =
            isFinal && score.home > score.away;

          return (
            <div className="mx-auto flex max-w-2xl items-center justify-between">
              {/* Away Team */}
              <div className="flex items-center gap-3 sm:gap-6">
                {game.status === "live" && game.timeouts ? (
                  <TimeoutDots remaining={game.timeouts.away} />
                ) : null}
                <Link
                  to="/teams/$teamId"
                  params={{ teamId: away.id }}
                  className="group flex flex-col items-center gap-1 text-center"
                >
                  <TeamLogo
                    team={away}
                    className="size-10 sm:size-14 transition-transform group-hover:scale-105"
                  />

                  <span className="font-mono text-xs text-mute group-hover:text-acc">
                    {game.awayRecord ??
                      `${away.record.w}-${away.record.l}`}
                  </span>
                </Link>

                <span
                  className={`font-mono text-3xl sm:text-5xl font-bold tabular-nums ${
                    awayWon ? "text-acc" : ""
                  }`}
                >
                  {game.status !== "scheduled"
                    ? score.away
                    : ""}
                </span>
              </div>

              {/* Center Status Box */}
              <div className="flex flex-col items-center justify-center px-2 text-center">
                {game.status === "live" ? (
                  <div className="flex flex-col items-center gap-1.5">
                    {game.downDistance &&
                    !isHalftime ? (
                      <span
                        className="rounded px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider uppercase text-black"
                        style={{
                          backgroundColor:
                            possessingTeam?.color ??
                            "#38bdf8",
                        }}
                      >
                        {game.downDistance}
                      </span>
                    ) : null}

                    <span className="flex items-center gap-1.5 font-mono text-xs sm:text-sm font-semibold tracking-wider text-emerald-400">
                      <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                      {game.clock ?? "Live"}
                    </span>

                    {isHalftime && game.drives?.length
                      ? (() => {
                          // The team that received the opening kickoff (first drive)
                          // kicks off, so the other team starts the 2nd half with the ball.
                          const firstDriveTeamId = game.drives[0]?.teamId;
                          const secondHalfTeam =
                            firstDriveTeamId === away.id
                              ? home
                              : firstDriveTeamId === home.id
                                ? away
                                : null;
                          return secondHalfTeam ? (
                            <span className="flex items-center gap-1.5 font-mono text-[11px] text-mute">
                              <TeamLogo team={secondHalfTeam} className="size-4" />
                              <span>starts with ball in 2nd half</span>
                            </span>
                          ) : null;
                        })()
                      : null}
                  </div>
                ) : game.status === "final" ? (
                  <div className="flex flex-col items-center">
                    <span className="font-disp text-lg sm:text-xl font-bold tracking-wider text-acc">
                      {isOT ? "FINAL/OT" : "FINAL"}
                    </span>

                    <span className="font-mono text-[11px] text-mute">
                      {game.date}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="font-disp text-base sm:text-lg font-bold tracking-wider text-mute">
                      VS
                    </span>

                    <span className="font-mono text-[11px] text-mute">
                      {localTime || game.date}
                    </span>
                  </div>
                )}
              </div>

              {/* Home Team */}
              <div className="flex items-center gap-3 sm:gap-6">
                <span
                  className={`font-mono text-3xl sm:text-5xl font-bold tabular-nums ${
                    homeWon ? "text-acc" : ""
                  }`}
                >
                  {game.status !== "scheduled"
                    ? score.home
                    : ""}
                </span>

                <Link
                  to="/teams/$teamId"
                  params={{ teamId: home.id }}
                  className="group flex flex-col items-center gap-1 text-center"
                >
                  <TeamLogo
                    team={home}
                    className="size-10 sm:size-14 transition-transform group-hover:scale-105"
                  />

                  <span className="font-mono text-xs text-mute group-hover:text-acc">
                    {game.homeRecord ??
                      `${home.record.w}-${home.record.l}`}
                  </span>
                </Link>
                {game.status === "live" && game.timeouts ? (
                  <TimeoutDots remaining={game.timeouts.home} />
                ) : null}
              </div>
            </div>
          );
        })()}

        {/* Live Field Track */}
        <LiveFieldTrack
          game={game}
          away={away}
          home={home}
        />

        {/* Live spread and total line */}
        {(() => {
          const {
            spread: spreadClass,
            total: totalClass,
          } = marketResultClass(
            game,
            away,
            home,
          );

          return (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
              <span>Spread:</span>

              <span
                className={`inline-flex items-center ${spreadClass}`}
              >
                <SpreadBadge
                  spread={game.spread}
                  away={away}
                  home={home}
                />
              </span>

              <span className="text-mute">·</span>

              <span>O/U:</span>

              <span
                className={`font-semibold tabular-nums ${totalClass}`}
              >
                {game.total || "—"}
              </span>
            </div>
          );
        })()}
      </Panel>

      {game.status === "live" ? <PlayByPlay plays={game.playByPlay ?? []} /> : null}

      {showGameStatistics(game.status) ? (
        <>
          {showGameStatistics(game.status) ? (
            <nav
              className={`mt-6 grid border-b border-line/15 ${game.status === "live" ? "grid-cols-4" : "grid-cols-5"}`}
              aria-label="Game details tabs"
            >
              {([
                ["gamecast", "Gamecast"],
                ["stats", "Stats"],
                ["markets", "Markets"],
                ["props", "Props"],
                ...(game.status !== "live" ? ([["information", "Information"]] as const) : []),
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveGameTab(tab)}
                  aria-pressed={activeGameTab === tab}
                  className={`border-b-2 px-3 py-3 font-disp text-sm font-semibold uppercase tracking-wider transition-colors ${activeGameTab === tab ? "border-acc text-foreground" : "border-transparent text-mute hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </nav>
          ) : null}
          {/* Tab content only appears once the game is live or finished. */}
          {activeGameTab === "information" && game.status !== "live" ? (
            <section className="mt-6">
              <GameInformation game={game} away={away} home={home} />
            </section>
          ) : game.status !== "scheduled" ? (
            <>
          <div>
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <Panel className={`lg:col-span-5 ${showGameStatistics(game.status) && activeGameTab !== "gamecast" ? "hidden" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                  Box score
                </h2>

                <span className="label-mono">
                  scoring
                </span>
              </div>

              <div className="mt-3">
                <LineScore game={game} />
              </div>
            </Panel>

            <Panel className={`lg:col-span-7 ${showGameStatistics(game.status) && activeGameTab !== "stats" ? "hidden" : ""}`}>
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Team statistics
              </h2>

              <div className="mt-4">
                <StatComparison game={game.status === "scheduled" && seasonAverages ? { ...game, stats: { away: seasonAverages.away, home: seasonAverages.home } } : game} />
              </div>
            </Panel>
          </div>
          </div>

          {showGameStatistics(game.status) && activeGameTab === "gamecast" ? (
            <section className="mt-6">
              <Panel padded={false}>
                <div className="border-b border-line/10 px-4 py-3">
                  <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Game leaders</h2>
                  <p className="label-mono mt-1">Top individual performance for each team</p>
                </div>
                <div className="px-3 sm:px-5">
                  <div className="grid grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-center gap-2 border-b border-line/10 py-3 text-[10px] font-mono uppercase tracking-wider text-faint sm:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
                    <div className="flex items-center gap-2"><TeamLogo team={away} className="size-5" /><span>{away.name}</span></div>
                    <div className="text-center">Category</div>
                    <div className="flex items-center justify-end gap-2 text-right"><span>{home.name}</span><TeamLogo team={home} className="size-5" /></div>
                  </div>
                  <div className="divide-y divide-line/10">
                    {([
                      {
                        label: "Passing yards",
                        // Only use the yards attached to a completions/attempts passing line.
                        // Some ESPN box-score lines append rushing stats for the same QB.
                        pattern: /^\s*\d+\s*\/\s*\d+\s*,?\s*([0-9,]+)\s+yds/i,
                        matches: (line: BoxScoreLine) => /^\s*\d+\s*\/\s*\d+\b/.test(line.statLine),
                        suffix: " yds",
                      },
                      {
                        label: "Rushing yards",
                        // Capture the yardage immediately after the carries count, not the
                        // first "yds" in a combined passing-and-rushing stat line.
                        pattern: /\b\d+\s+car\b\s*,?\s*([0-9,]+)\s+yds/i,
                        matches: (line: BoxScoreLine) => /\b\d+\s+car\b/i.test(line.statLine),
                        suffix: " yds",
                      },
                      {
                        label: "Receiving yards",
                        pattern: /\b\d+\s+rec\b\s*,?\s*([0-9,]+)\s+yds/i,
                        matches: (line: BoxScoreLine) => /\b\d+\s+rec\b/i.test(line.statLine),
                        suffix: " yds",
                      },
                      { label: "Sacks", pattern: /([0-9]+(?:\.[0-9])?) sck/i, matches: (line: BoxScoreLine) => line.category === "defense" || line.position.toUpperCase() === "DEF", suffix: "" },
                      { label: "Tackles", pattern: /([0-9]+) tkl/i, matches: (line: BoxScoreLine) => line.category === "defense" || line.position.toUpperCase() === "DEF", suffix: "" },
                    ] as const).map((leader) => {
                      const getTop = (teamId: string) => game.boxScore
                        .filter((line) => line.teamId === teamId && leader.matches(line))
                        .map((line) => ({ line, value: Number(line.statLine.match(leader.pattern)?.[1]?.replace(/,/g, "") ?? -1) }))
                        .filter((item) => Number.isFinite(item.value) && item.value > 0)
                        .sort((a, b) => b.value - a.value)[0];
                      const awayLeader = getTop(away.id);
                      const homeLeader = getTop(home.id);
                      const playerCell = (leaderData: ReturnType<typeof getTop>, side: "away" | "home") => {
                        const isHome = side === "home";
                        const alignment = isHome ? "justify-end text-right" : "justify-start text-left";
                        if (!leaderData) return <div className="py-4" aria-hidden="true" />;
                        const playerContent = (
                          <>
                            <div className={`flex min-w-0 items-center gap-2.5 ${isHome ? "flex-row-reverse" : ""}`}>
                              <img
                                src={leaderData.line.playerId ? `https://a.espncdn.com/i/headshots/nfl/players/full/${leaderData.line.playerId}.png` : ""}
                                alt=""
                                loading="lazy"
                                className="size-11 shrink-0 rounded-full bg-line/10 object-cover ring-1 ring-line/15 sm:size-12"
                                onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
                              />
                              <div className={`min-w-0 ${isHome ? "text-right" : "text-left"}`}>
                                <div className="truncate text-sm font-semibold text-foreground group-hover:text-acc">{leaderData.line.name}</div>
                                <div className="mt-0.5 text-[11px] text-mute">{leaderData.line.position}</div>
                                <div className="mt-1 font-mono text-sm font-bold tabular-nums text-acc">{leaderData.value}{leader.suffix}</div>
                              </div>
                            </div>
                          </>
                        );
                        return (
                          <div className={`flex min-w-0 items-center py-3 ${alignment}`}>
                            {leaderData.line.playerId ? (
                              <Link to="/players/$playerId" params={{ playerId: leaderData.line.playerId }} className="group block min-w-0 rounded-md p-1 transition-colors hover:bg-line/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc">
                                {playerContent}
                              </Link>
                            ) : <div className="min-w-0 p-1">{playerContent}</div>}
                          </div>
                        );
                      };
                      // Hide the entire category when neither team has a positive stat value.
                      if (!awayLeader && !homeLeader) return null;
                      return (
                        <div key={leader.label} className="grid grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
                          {playerCell(awayLeader, "away")}
                          <div className="px-1 text-center">
                            <div className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-mute sm:text-xs">{leader.label}</div>
                          </div>
                          {playerCell(homeLeader, "home")}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Panel>
            </section>
          ) : null}

          {/* Drive by drive */}
          <section className={`mt-6 ${showGameStatistics(game.status) && activeGameTab !== "gamecast" ? "hidden" : ""}`}>
            <Panel padded={false}>
              <div className="flex items-center justify-between border-b border-line/10 px-4 py-3">
                <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                  Drive by drive
                </h2>

                <span className="label-mono">
                  {game.drives.length} drives
                </span>
              </div>

              {game.drives.length === 0 ? (
                <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
                  Drives populate once the game is played.
                </p>
              ) : (
                <DriveTable game={game} />
              )}
            </Panel>
          </section>

          {/* Team selector + player statistics */}
          <section className={`mt-6 ${showGameStatistics(game.status) && activeGameTab !== "stats" ? "hidden" : ""}`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Player statistics
              </h2>

              <span className="label-mono">
                box score
              </span>
            </div>

            <Panel padded={false}>
              {/* Team tabs */}
              <div className="grid grid-cols-2 border-b border-line/10">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTeam("away")
                  }
                  className={`flex items-center justify-center gap-2 border-r border-line/10 px-4 py-3 font-disp text-sm font-semibold uppercase tracking-tight transition-colors ${
                    selectedTeam === "away"
                      ? "bg-acc/10 text-foreground shadow-[inset_0_-2px_0_var(--accent)]"
                      : "text-mute hover:bg-line/5 hover:text-foreground"
                  }`}
                >
                  <TeamLogo
                    team={away}
                    className="size-6"
                  />

                  <span>{away.name}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSelectedTeam("home")
                  }
                  className={`flex items-center justify-center gap-2 px-4 py-3 font-disp text-sm font-semibold uppercase tracking-tight transition-colors ${
                    selectedTeam === "home"
                      ? "bg-acc/10 text-foreground shadow-[inset_0_-2px_0_var(--accent)]"
                      : "text-mute hover:bg-line/5 hover:text-foreground"
                  }`}
                >
                  <TeamLogo
                    team={home}
                    className="size-6"
                  />

                  <span>{home.name}</span>
                </button>
              </div>

              {/* Offense / Defense tabs */}
              <div className="flex items-center justify-between gap-3 border-b border-line/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <TeamLogo
                    team={selectedTeamData}
                    className="size-5"
                  />

                  <span className="font-disp text-base font-semibold uppercase tracking-tight">
                    {selectedTeamData.name}
                  </span>
                </div>

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedTeamTab("offense")
                    }
                    className={`rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors ${
                      selectedTeamTab === "offense"
                        ? "bg-acc text-black font-semibold"
                        : "bg-panel2 text-mute hover:bg-line/10 hover:text-foreground"
                    }`}
                  >
                    Offense (
                    {selectedTeam === "away"
                      ? awayOffense.length
                      : homeOffense.length}
                    )
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedTeamTab("defense")
                    }
                    className={`rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors ${
                      selectedTeamTab === "defense"
                        ? "bg-acc text-black font-semibold"
                        : "bg-panel2 text-mute hover:bg-line/10 hover:text-foreground"
                    }`}
                  >
                    Defense (
                    {selectedTeam === "away"
                      ? awayDefense.length
                      : homeDefense.length}
                    )
                  </button>
                </div>
              </div>

              {selectedTeamLines.length === 0 ? (
                <p className="px-4 py-8 text-center font-mono text-xs uppercase tracking-wider text-faint">
                  No {selectedTeamTab} stats recorded
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                        <th className="w-[42%] px-4 py-2 font-normal">
                          Player
                        </th>

                        <th className="w-[18%] px-2 py-2 font-normal">
                          Pos
                        </th>

                        <th className="w-[40%] px-4 py-2 font-normal">
                          Stat line
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-line/5">
                      {selectedTeamLines.map(
                        (line, idx) => (
                          <tr
                            key={`${line.name}-${line.position}-${idx}`}
                            className="hover:bg-line/5"
                          >
                            <td className="px-4 py-2.5 font-medium truncate max-w-[180px]">
                              {line.playerId ? (
                                <Link
                                  to="/players/$playerId"
                                  params={{
                                    playerId:
                                      line.playerId,
                                  }}
                                  className="hover:text-acc"
                                >
                                  {line.name}
                                </Link>
                              ) : (
                                line.name
                              )}
                            </td>

                            <td className="px-2 py-2.5 font-mono text-mute">
                              {line.position}
                            </td>

                            <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-mute">
                              {line.statLine}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </section>
          {showGameStatistics(game.status) && activeGameTab === "markets" ? (
            <section className="mt-6 space-y-4">
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Probabilities</h2>
                  <div className="text-right text-xs text-mute">
                    <div className="flex items-center justify-end gap-1.5">Spread: <span className="font-mono font-semibold text-foreground"><MarketSpreadLabel spread={game.spread} away={away} home={home} /></span></div>
                    <div className="mt-1">Total: <span className="font-mono font-semibold text-foreground">{game.total || "—"}</span></div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg border border-line/10 p-1" role="tablist" aria-label="Probability type">
                  {([["moneyline", "Moneyline"], ["cover", "Cover"], ["total", "Total"]] as const).map(([tab, label]) => (
                    <button key={tab} type="button" role="tab" aria-selected={activeMarketTab === tab} onClick={() => setActiveMarketTab(tab)} className={`rounded-md px-2 py-2.5 font-disp text-xs font-semibold uppercase tracking-wider transition-colors sm:text-sm ${activeMarketTab === tab ? "bg-acc text-black" : "text-mute hover:bg-line/5 hover:text-foreground"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {activeMarketTab === "total" ? (
                  <ProbabilityGraph
                    points={game.probabilities ?? []}
                    probabilityKey="overProbability"
                    away={away}
                    home={home}
                    totalLine={game.total || undefined}
                    unavailableText="Total probability needs the game's pregame over/under and play-by-play scores, which aren't available for this game."
                  />
                ) : activeMarketTab === "cover" ? (
                  <ProbabilityGraph
                    points={game.probabilities ?? []}
                    probabilityKey="homeCoverProbability"
                    away={away}
                    home={home}
                    unavailableText="Cover probability needs the game's pregame spread and play-by-play probabilities, which aren't available for this game."
                  />
                ) : (
                  <ProbabilityGraph
                    points={game.probabilities ?? []}
                    probabilityKey="homeWinProbability"
                    away={away}
                    home={home}
                    unavailableText="ESPN hasn't published win probabilities for this game yet."
                  />
                )}
              </Panel>
            </section>
          ) : null}
                    {/* Live / Finished games Props tab */}
          {activeGameTab === "props" ? (
            <section className="mt-6">
              <DraftKingsPropsBoard game={game} away={away} home={home} />
            </section>
          ) : null}
            </>
          ) : activeGameTab === "stats" ? (
            /* Upcoming games: use each team's season-to-date per-game averages. */
            <section className="mt-6">
              <div className="grid gap-6 lg:grid-cols-12">
                <Panel className="lg:col-span-7">
                  <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                    Team statistics
                  </h2>
                  <p className="label-mono mt-1">Season averages per game</p>
                  <div className="mt-4">
                    {seasonAverages ? (
                      <StatComparison
                        game={{ ...game, stats: { away: seasonAverages.away, home: seasonAverages.home } }}
                      />
                    ) : (
                      <p className="py-4 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
                        Loading season averages…
                      </p>
                    )}
                  </div>
                </Panel>
              </div>
            </section>
          ) : activeGameTab === "markets" ? (
            <section className="mt-6">
              <MatchupPredictor game={game} away={away} home={home} />
            </section>
          ) : activeGameTab === "props" ? (
            /* Upcoming / Scheduled games Props tab */
            <section className="mt-6">
              <DraftKingsPropsBoard game={game} away={away} home={home} />
            </section>
          ) : activeGameTab === "gamecast" ? (
            <section className="mt-6">
              <SeasonLeaders game={game} away={away} home={home} />
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
