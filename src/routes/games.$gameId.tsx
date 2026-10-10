
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  DriveTable,
  FootballIcon,
  LineScore,
  PageTitle,
  Panel,
  StatComparison,
  TeamLogo,
  SpreadBadge,
  marketResultClass,
} from "@/components/booth";
import { gameScore, type BoxScoreLine, type Game, type GameProbabilityPoint } from "@/data/games";
import { teamById, type Team } from "@/data/teams";
import { getGameWeather, getLiveGame } from "@/lib/espn.functions";
import { GameWeatherCard } from "@/components/GameWeatherCard";
import { showGameStatistics } from "@/lib/game-visibility";

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
  if (game.status !== "live" || !game.possession) return null;

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
      {/* Field status banner */}
      <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-emerald-400">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <FootballIcon isRedZone={game.isRedZone} />
          <span>{game.downDistance ?? "1st & 10"}</span>
          <span className="text-mute">·</span>
          <span className="inline-flex items-center gap-1">
            Ball on {isMidfield ? "50" : spotMatch ? <><TeamLogo team={teamById(spotMatch[1] === away.abbr ? away.id : home.id) ?? (spotMatch[1] === away.abbr ? away : home)} className="size-4" />{spotMatch[2]}</> : game.possessionText ?? "50"}
          </span>
        </span>

        <span className="flex items-center gap-1 text-acc font-semibold">
          <span>Drive</span>
          <span>{isAwayPossession ? "→" : "←"}</span>
        </span>
      </div>

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

function ProbabilityGraph({
  points,
  probabilityKey,
  values,
  highColor,
  lowColor,
  highLabel,
  lowLabel,
  away,
  home,
  favoriteSide = "home",
}: {
  points: GameProbabilityPoint[];
  probabilityKey: ProbabilityKey;
  values: Array<number | undefined>;
  highColor: string;
  lowColor: string;
  highLabel: string;
  lowLabel: string;
  away?: Team;
  home?: Team;
  favoriteSide?: "home" | "away";
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // ESPN stores win/cover probability from the home team's perspective.
  // Normalize team markets to the pregame favorite's perspective exactly once.
  const graphValues = probabilityKey === "overProbability"
    ? values
    : values.map((value) => typeof value === "number"
      ? (favoriteSide === "home" ? value : 1 - value)
      : undefined);
  const graphHighColor = probabilityKey === "overProbability" ? highColor : (favoriteSide === "home" ? highColor : lowColor);
  const graphLowColor = probabilityKey === "overProbability" ? lowColor : (favoriteSide === "home" ? lowColor : highColor);
  const graphHighLabel = probabilityKey === "overProbability" ? highLabel : `${favoriteSide === "home" ? home?.name : away?.name}${probabilityKey === "homeCoverProbability" ? " Cover" : ""}`;
  const graphLowLabel = probabilityKey === "overProbability" ? lowLabel : `${favoriteSide === "home" ? away?.name : home?.name}${probabilityKey === "homeCoverProbability" ? " Cover" : ""}`;
  const graphHighTeam = favoriteSide === "home" ? home : away;
  const graphLowTeam = favoriteSide === "home" ? away : home;
  const valid = graphValues.map((v, i) => typeof v === "number" ? i : -1).filter((i) => i >= 0);
  if (!valid.length) {
    return (
      <div className="mt-4 rounded-lg border border-line/10 bg-panel2/30 px-4 py-10 text-center">
        <p className="font-semibold">Probability history unavailable</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-mute">
          ESPN did not return this probability series for the game. No estimated or fabricated values are shown.
        </p>
      </div>
    );
  }

  const width = 1000;
  const height = 320;
  const left = 62;
  const right = 18;
  const top = 20;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xFor = (index: number) => left + (graphValues.length <= 1 ? plotWidth / 2 : (index / (graphValues.length - 1)) * plotWidth);
  const yFor = (value: number) => top + (1 - Math.max(0, Math.min(1, value))) * plotHeight;
  const baseline = yFor(0.5);
  const segments = graphValues.slice(0, -1).map((value, index) => {
    const next = graphValues[index + 1];
    if (typeof value !== "number" || typeof next !== "number") return null;
    return { index, value, next, color: (value + next) / 2 >= 0.5 ? graphHighColor : graphLowColor };
  }).filter((segment): segment is { index: number; value: number; next: number; color: string } => segment !== null);
  const selected = hoverIndex === null ? null : points[hoverIndex];
  const selectedValue = hoverIndex === null ? undefined : graphValues[hoverIndex];
  // Keep the hover context's probability badge identical across all market tabs.
  // On the Total chart, show the same team win-probability badge as Moneyline/Spread,
  // rather than replacing it with an Over/Under label.
  const selectedBadgeValue = probabilityKey === "overProbability"
    ? (typeof selected?.homeWinProbability === "number"
      ? (favoriteSide === "home" ? selected.homeWinProbability : 1 - selected.homeWinProbability)
      : undefined)
    : selectedValue;
  const selectedBadgeTeam = typeof selectedBadgeValue === "number"
    ? (selectedBadgeValue >= 0.5 ? graphHighTeam : graphLowTeam)
    : undefined;
  const pointClock = selected?.clock ? ` ${selected.clock}` : "";

  return (
    <div className="mt-4 rounded-lg border border-line/10 bg-panel2/20 p-2 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
          {away && <span className="inline-flex items-center gap-1.5"><TeamLogo team={graphLowTeam ?? away} className="size-5" /><span className="inline-block h-0.5 w-5" style={{ backgroundColor: graphLowColor }} />{probabilityKey === "overProbability" ? graphLowLabel : ""}</span>}
          {home && <span className="inline-flex items-center gap-1.5"><TeamLogo team={graphHighTeam ?? home} className="size-5" /><span className="inline-block h-0.5 w-5" style={{ backgroundColor: graphHighColor }} />{probabilityKey === "overProbability" ? graphHighLabel : ""}</span>}
          {!away && <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: graphHighColor }} />{highLabel}</span>}
          {!home && <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: graphLowColor }} />{lowLabel}</span>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 font-mono text-xs tabular-nums">
          {(() => {
            const latest = graphValues[graphValues.length - 1] ?? 0;
            const showHigh = latest >= 0.5;
            const probability = Math.round(Math.max(latest, 1 - latest) * 100);
            const team = showHigh ? graphHighTeam : graphLowTeam;
            return (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold text-white"
                style={{ backgroundColor: probabilityKey === "overProbability" ? (showHigh ? "#16a34a" : "#dc2626") : (showHigh ? graphHighColor : graphLowColor) }}
              >
                {probabilityKey === "overProbability" ? (
                  <span>{showHigh ? "Over" : "Under"}</span>
                ) : team ? <TeamLogo team={team} className="size-5" /> : null}
                <span>{probability}%</span>
              </span>
            );
          })()}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="block w-full touch-pan-x" role="img" aria-label={`${probabilityKey} probability over the game`} onMouseLeave={() => setHoverIndex(null)}>
        {[0, 0.5, 1].map((tick) => {
          const y = yFor(tick);
          return <g key={tick}><line x1={left} x2={width - right} y1={y} y2={y} stroke="currentColor" strokeOpacity={tick === 0.5 ? 0.35 : 0.12} strokeDasharray={tick === 0.5 ? "5 4" : "4 5"} /><text x={left - 12} y={y + 4} textAnchor="end" fontSize="14" fill="currentColor" opacity="0.65">{Math.round(tick * 100)}%</text></g>;
        })}
        <line x1={left} x2={left} y1={top} y2={height - bottom} stroke="currentColor" strokeOpacity="0.2" />
        <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} stroke="currentColor" strokeOpacity="0.2" />
        {segments.map(({ index, value, next, color }) => {
          const x1 = xFor(index), x2 = xFor(index + 1), y1 = yFor(value), y2 = yFor(next);
          const area = `${x1},${baseline} ${x1},${y1} ${x2},${y2} ${x2},${baseline}`;
          return <g key={index}><polygon points={area} fill={color} fillOpacity="0.14" /><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="4" strokeLinecap="round" /></g>;
        })}
        {hoverIndex !== null && typeof graphValues[hoverIndex] === "number" ? <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={top} y2={height - bottom} stroke="currentColor" strokeOpacity="0.45" strokeDasharray="3 4" /> : null}
        {graphValues.map((value, index) => typeof value === "number" ? <circle key={index} cx={xFor(index)} cy={yFor(value)} r={hoverIndex === index ? 6 : 2.4} fill={(value >= 0.5 ? graphHighColor : graphLowColor)} stroke="currentColor" strokeOpacity={hoverIndex === index ? 0.7 : 0} strokeWidth="1.5" onMouseEnter={() => setHoverIndex(index)} onFocus={() => setHoverIndex(index)} tabIndex={0} role="button" aria-label={`Play ${index + 1}, ${Math.round(value * 100)} percent`} /> : null)}
        {[1, 2, 3, 4].map((quarter) => {
          const quarterIndexes = points.map((point, index) => point.quarter === quarter ? index : -1).filter((index) => index >= 0);
          if (!quarterIndexes.length) return null;
          const centerIndex = (quarterIndexes[0] + quarterIndexes[quarterIndexes.length - 1]) / 2;
          return <text key={quarter} x={xFor(centerIndex)} y={height - 12} textAnchor="middle" fontSize="14" fill="currentColor" opacity="0.75">{["", "1st", "2nd", "3rd", "4th"][quarter]}</text>;
        })}
        <text x={left} y={height - 28} fontSize="11" fill="currentColor" opacity="0.55">Kickoff</text>
        <text x={width - right} y={height - 28} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.55">Final</text>
      </svg>
      {selected ? (
        <div className="mt-2 rounded-lg border border-line/10 bg-panel p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-mute">
            <span className="inline-flex items-center gap-1.5">
              {away && <span className="inline-flex items-center gap-1"><TeamLogo team={away} className="size-5" /><span>{selected?.awayScore ?? "—"}</span></span>}
              <span className="text-faint">—</span>
              <span className="whitespace-nowrap text-foreground">
                {selected.quarter ? `${["", "1st", "2nd", "3rd", "4th", "OT"][selected.quarter] ?? `Q${selected.quarter}`} ` : ""}
                {selected.clock ?? "—"}
              </span>
              <span className="text-faint">—</span>
              {home && <span className="inline-flex items-center gap-1"><span>{selected?.homeScore ?? "—"}</span><TeamLogo team={home} className="size-5" /></span>}
            </span>
            {typeof selectedBadgeValue === "number" ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-semibold text-foreground"
                aria-live="polite"
              >
                {selectedBadgeTeam ? <TeamLogo team={selectedBadgeTeam} className="size-5" /> : null}
                <span>{Math.round(Math.max(selectedBadgeValue, 1 - selectedBadgeValue) * 100)}%</span>
              </span>
            ) : null}
          </div>
          {(selected.down || selected.distance || selected.yardLine) ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span>{selected.down ? `${selected.down}${selected.down === 1 ? "st" : selected.down === 2 ? "nd" : selected.down === 3 ? "rd" : "th"} & ${selected.distance ?? "—"}` : "Down and distance"}</span>
              {selected.yardLine ? (() => {
                const rawSpot = String(selected.yardLine).trim();
                const teamSpot = rawSpot.match(/^([A-Za-z]{2,4})\s+(?:at\s*)?(\d{1,2})$/i);
                const numberSpot = rawSpot.match(/^(?:at\s*)?(\d{1,3})$/i);
                const abbr = teamSpot?.[1]?.toUpperCase();
                const rawYard = Number(teamSpot?.[2] ?? numberSpot?.[1]);
                const spotTeam = abbr
                  ? (away?.abbr.toUpperCase() === abbr ? away : home?.abbr.toUpperCase() === abbr ? home : undefined)
                  : undefined;
                if (rawYard === 50) return <span className="font-medium text-mute">Ball is on 50</span>;
                if (spotTeam && Number.isFinite(rawYard)) {
                  const ownYard = rawYard > 50 ? 100 - rawYard : rawYard;
                  return <span className="inline-flex items-center gap-1.5"><TeamLogo team={spotTeam} className="size-5" /><span>{ownYard}</span></span>;
                }
                // ESPN sometimes provides a field-wide 0–100 spot without a team abbreviation.
                // Convert the far-half coordinate to its own-side yard number, but don't guess a logo.
                if (numberSpot && Number.isFinite(rawYard)) {
                  const ownYard = rawYard > 50 ? 100 - rawYard : rawYard;
                  return <span className="font-medium text-mute">Ball at {ownYard}</span>;
                }
                return <span className="font-medium text-mute">Ball at {rawSpot.replace(/^at\s*/i, "")}</span>;
              })() : null}
            </div>
          ) : null}
          <p className="mt-1 text-sm leading-relaxed">{selected.playText || `Play-level probability sample ${hoverIndex! + 1}. ESPN did not provide a play description for this point.`}</p>
        </div>
      ) : <p className="mt-2 text-[11px] text-mute">Hover or focus a point to inspect the play and probability. {points.length} ESPN data points.</p>}
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

function favoriteSideFromSpread(spread: string, away: Team, home: Team): "home" | "away" {
  const match = spread.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
  if (!match) return "home";
  const abbreviation = match[1].toUpperCase();
  if (abbreviation === away.abbr.toUpperCase()) return "away";
  if (abbreviation === home.abbr.toUpperCase()) return "home";
  return "home";
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
    useState<"gamecast" | "stats" | "markets">("gamecast");
  const [activeMarketTab, setActiveMarketTab] =
    useState<"moneyline" | "spread" | "total">("moneyline");

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
      <PageTitle
        eyebrow={`Week ${game.week} · ${game.venue} · ${localKickoff}`}
        title={`${away.abbr} @ ${home.abbr}`}
        aside={
          weatherQuery.data ? (
            <GameWeatherCard weather={weatherQuery.data} />
          ) : undefined
        }
      />

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

      {showGameStatistics(game.status) ? (
        <>
          {game.status === "final" ? (
            <nav className="mt-6 grid grid-cols-3 border-b border-line/15" aria-label="Game details tabs">
              {([ ["gamecast", "Gamecast"], ["stats", "Stats"], ["markets", "Markets"] ] as const).map(([tab, label]) => (
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
          <div>
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <Panel className={`lg:col-span-5 ${game.status === "final" && activeGameTab !== "gamecast" ? "hidden" : ""}`}>
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

            <Panel className={`lg:col-span-7 ${game.status === "final" && activeGameTab !== "stats" ? "hidden" : ""}`}>
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Team statistics
              </h2>

              <p className="label-mono">
                {away.abbr} left · {home.abbr} right
              </p>

              <div className="mt-4">
                <StatComparison game={game} />
              </div>
            </Panel>
          </div>
          </div>

          {game.status === "final" && activeGameTab === "gamecast" ? (
            <section className="mt-6">
              <Panel padded={false}>
                <div className="border-b border-line/10 px-4 py-3">
                  <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Game leaders</h2>
                  <p className="label-mono mt-1">Top individual performance for each team</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-line/10 text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                        <th className="w-[26%] px-4 py-3 font-normal">Category</th>
                        <th className="w-[37%] px-4 py-3 font-normal"><span className="flex items-center gap-2"><TeamLogo team={away} className="size-5" />{away.abbr}</span></th>
                        <th className="w-[37%] px-4 py-3 font-normal"><span className="flex items-center gap-2"><TeamLogo team={home} className="size-5" />{home.abbr}</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/5">
                      {([
                        { label: "Passing yards", pattern: /([0-9,]+) yds/i, matches: (line: BoxScoreLine) => /\bpass/i.test(line.statLine) || line.position.toUpperCase() === "QB" || line.statLine.includes("INT"), suffix: " yds" },
                        { label: "Rushing yards", pattern: /([0-9,]+) yds/i, matches: (line: BoxScoreLine) => /\bcar\b/i.test(line.statLine), suffix: " yds" },
                        { label: "Receiving yards", pattern: /([0-9,]+) yds/i, matches: (line: BoxScoreLine) => /\brec\b/i.test(line.statLine), suffix: " yds" },
                        { label: "Sacks", pattern: /([0-9]+(?:\.[0-9])?) sck/i, matches: (line: BoxScoreLine) => line.category === "defense" || line.position.toUpperCase() === "DEF", suffix: "" },
                        { label: "Tackles", pattern: /([0-9]+) tkl/i, matches: (line: BoxScoreLine) => line.category === "defense" || line.position.toUpperCase() === "DEF", suffix: "" },
                      ] as const).map((leader) => {
                        const getTop = (teamId: string) => game.boxScore
                          .filter((line) => line.teamId === teamId && leader.matches(line))
                          .map((line) => ({ line, value: Number(line.statLine.match(leader.pattern)?.[1]?.replace(/,/g, "") ?? -1) }))
                          .filter((item) => Number.isFinite(item.value) && item.value >= 0)
                          .sort((a, b) => b.value - a.value)[0];
                        const awayLeader = getTop(away.id);
                        const homeLeader = getTop(home.id);
                        const cell = (leaderData: ReturnType<typeof getTop>) => leaderData ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0"><div className="truncate font-semibold">{leaderData.line.name}</div><div className="text-xs text-mute">{leaderData.line.position}</div></div>
                            <div className="shrink-0 font-mono font-bold tabular-nums text-acc">{leaderData.value}{leader.suffix}</div>
                          </div>
                        ) : <span className="text-mute">No data</span>;
                        return <tr key={leader.label} className="hover:bg-line/5"><th className="px-4 py-3 text-left font-medium">{leader.label}</th><td className="px-4 py-3">{cell(awayLeader)}</td><td className="px-4 py-3">{cell(homeLeader)}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </section>
          ) : null}

          {/* Drive by drive */}
          <section className={`mt-6 ${game.status === "final" && activeGameTab !== "gamecast" ? "hidden" : ""}`}>

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
          <section className={`mt-6 ${game.status === "final" && activeGameTab !== "stats" ? "hidden" : ""}`}>
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
          {game.status === "final" && activeGameTab === "markets" ? (
            <section className="mt-6 space-y-4">
              <Panel>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Market probabilities</h2>
                    <p className="label-mono mt-1">Play-by-play probability trends · ESPN data</p>
                  </div>
                  <div className="text-right text-xs text-mute">
                    <div className="flex items-center justify-end gap-1.5">Spread: <span className="font-mono font-semibold text-foreground"><MarketSpreadLabel spread={game.spread} away={away} home={home} /></span></div>
                    <div className="mt-1">Total: <span className="font-mono font-semibold text-foreground">{game.total || "—"}</span></div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 rounded-lg border border-line/10 p-1" role="tablist" aria-label="Market probability type">
                  {([ ["moneyline", "Moneyline"], ["spread", "Spread"], ["total", "Total"] ] as const).map(([tab, label]) => (
                    <button key={tab} type="button" role="tab" aria-selected={activeMarketTab === tab} onClick={() => setActiveMarketTab(tab)} className={`rounded-md px-2 py-2.5 font-disp text-xs font-semibold uppercase tracking-wider transition-colors sm:text-sm ${activeMarketTab === tab ? "bg-acc text-black" : "text-mute hover:bg-line/5 hover:text-foreground"}`}>
                      {tab === "moneyline" ? "MoneyLine" : label}
                    </button>
                  ))}
                </div>
                {activeMarketTab === "moneyline" ? (
                  <ProbabilityGraph
                    points={game.probabilities ?? []}
                    probabilityKey="homeWinProbability"
                    values={(game.probabilities ?? []).map((point) => point.homeWinProbability)}
                    highColor={home.color}
                    lowColor={away.color}
                    highLabel={home.name}
                    lowLabel={away.name}
                    favoriteSide={favoriteSideFromSpread(game.spread, away, home)}
                    away={away}
                    home={home}
                  />
                ) : activeMarketTab === "spread" ? (
                  <ProbabilityGraph
                    points={game.probabilities ?? []}
                    probabilityKey="homeCoverProbability"
                    values={(game.probabilities ?? []).map((point) => point.homeCoverProbability)}
                    highColor={home.color}
                    lowColor={away.color}
                    highLabel={`${home.name} Cover`}
                    lowLabel={`${away.name} Cover`}
                    favoriteSide={favoriteSideFromSpread(game.spread, away, home)}
                    away={away}
                    home={home}
                  />
                ) : (
                  <ProbabilityGraph
                    points={game.probabilities ?? []}
                    probabilityKey="overProbability"
                    values={(game.probabilities ?? []).map((point) => point.overProbability)}
                    highColor="#22c55e"
                    lowColor="#ef4444"
                    highLabel="Over"
                    lowLabel="Under"
                  />
                )}
              </Panel>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
