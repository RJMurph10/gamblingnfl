

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
