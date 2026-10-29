/**
 * ESPN-style probability graph (moneyline / cover / total over the course of a game), shared by the
 * NFL / college game page and the NBA game page. Moved out of GameDetail.tsx; the football
 * behaviour is unchanged (FOOTBALL_CLOCK is the default).
 */
import { useId, useRef, useState, type ReactNode } from "react";
import type { GameProbabilityPoint } from "@/data/shared/games";

export type ProbabilityKey = "homeWinProbability" | "homeCoverProbability" | "overProbability";

/** Game clock for the x axis: football (15-minute quarters) or basketball (12-minute quarters). */
export interface GraphClock {
  periodSeconds: number;
  periods: number;
  otSeconds: number;
  /**
   * Most points both teams can still add in overtime; when even that can't reach the total, the
   * Under is locked. Football only (NFL overtime scoring is capped); undefined = never lock early.
   */
  otUnderLockPoints?: number;
}
export const FOOTBALL_CLOCK: GraphClock = {
  periodSeconds: 900,
  periods: 4,
  otSeconds: 600,
  otUnderLockPoints: 24,
};
export const BASKETBALL_CLOCK: GraphClock = { periodSeconds: 720, periods: 4, otSeconds: 300 };

/** Quarter label: 1st…4th, then OT, 2OT… */
const periodLabel = (q: number | undefined, gc: GraphClock) => {
  if (!q) return "";
  if (q <= gc.periods) return ["1st", "2nd", "3rd", "4th"][q - 1] ?? `${q}th`;
  const ot = q - gc.periods;
  return ot === 1 ? "OT" : `${ot}OT`;
};

function clockToSeconds(clock?: string): number | undefined {
  if (!clock) return undefined;
  const match = clock.match(/^(\d+):(\d{2})/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const seconds = Number(clock);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Seconds of game time elapsed at a probability sample (overtime continues past regulation). */
function elapsedGameSeconds(point: GameProbabilityPoint, gc: GraphClock): number | undefined {
  const regulation = gc.periods * gc.periodSeconds;
  const clock = clockToSeconds(point.clock);
  if (point.quarter && clock !== undefined) {
    if (point.quarter <= gc.periods)
      return (
        (point.quarter - 1) * gc.periodSeconds + (gc.periodSeconds - Math.min(clock, gc.periodSeconds))
      );
    return (
      regulation +
      (point.quarter - gc.periods - 1) * gc.otSeconds +
      (gc.otSeconds - Math.min(clock, gc.otSeconds))
    );
  }
  if (typeof point.secondsLeft === "number") return Math.max(0, regulation - point.secondsLeft);
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
export function ProbabilityGraph<T extends { abbr: string; color: string }>({
  points,
  probabilityKey,
  away,
  home,
  unavailableText,
  totalLine,
  logo,
  clock: gc = FOOTBALL_CLOCK,
}: {
  points: GameProbabilityPoint[];
  probabilityKey: ProbabilityKey;
  away: T;
  home: T;
  unavailableText: string;
  totalLine?: number;
  /** The team logo shown next to its percentage (win/cover graphs). */
  logo?: (team: T) => ReactNode;
  clock?: GraphClock;
}) {
  const regulation = gc.periods * gc.periodSeconds;
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
    const otLock = gc.otUnderLockPoints;
    const underLockedIndex = totalLine === undefined || otLock === undefined ? -1 : usable.findIndex((entry) => {
      const quarter = entry.point.quarter ?? 0;
      const awayScore = entry.point.awayScore;
      const homeScore = entry.point.homeScore;
      if (quarter <= gc.periods || typeof awayScore !== "number" || typeof homeScore !== "number") return false;
      return awayScore + homeScore + otLock < totalLine;
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
    const raw = elapsedGameSeconds(entry.point, gc);
    const fallback = (i / Math.max(1, usable.length - 1)) * regulation;
    running = Math.max(running, raw ?? fallback);
    return running;
  });
  const domain = Math.max(regulation, elapsed[elapsed.length - 1] || regulation);
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
  const quarterTicks = Array.from({ length: gc.periods }, (_, q) => q)
    .map((q) => ({ label: periodLabel(q + 1, gc), x: xFor(q * gc.periodSeconds) }))
    .filter((tick) => tick.x <= graphRight);
  const hasOvertime = domain > regulation;
  if (hasOvertime) {
    const overtimeTick = { label: "OT", x: xFor(regulation) };
    if (overtimeTick.x <= graphRight) quarterTicks.push(overtimeTick);
  }
  // Interior quarter dividers only; the outer edge is the border. The 4th/OT divider appears only in overtime games.
  const quarterLines = Array.from(
    { length: hasOvertime ? gc.periods : gc.periods - 1 },
    (_, i) => i + 1,
  )
    .map((q) => xFor(q * gc.periodSeconds))
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
          {isTotal || !logo ? null : logo(team)}
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
          <text key={tick.label} x={tick.x} y={plotBottom + 18} textAnchor={tick.label === periodLabel(1, gc) ? "start" : "middle"} fontSize="12" fill="currentColor" opacity="0.7">
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
                  {selected.clock ?? "—"} - {periodLabel(selected.quarter, gc)}
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
