import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchGameDetail,
  fetchGameProps,
  fetchSchedule,
  fetchTeamDepthChart,
  fetchTeamRosterForPage,
  fetchTeamSeasonStats,
  fetchTeamOverviewStats,
  fetchTeamSeasonAverages,
  fetchLeagueTeamOverviewStats,
  fetchPlayerProfile,
} from "./espn.server";
import {
  fetchLeaguePlayers,
  fetchPlayerGameLog,
} from "./league-players.server";
import { fetchGameWeather } from "./weather.server";

export const getLiveSchedule = createServerFn({
  method: "GET",
}).handler(async () => {
  return fetchSchedule();
});

export const getLiveGame = createServerFn({
  method: "GET",
})
  .inputValidator((data) =>
    z
      .object({
        eventId: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    return fetchGameDetail(
      data.eventId,
    );
  });

export const getTeamOverviewStats = createServerFn({
  method: "GET",
})
  .inputValidator((data) => z.object({ teamId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchTeamOverviewStats(data.teamId));

export const getTeamSeasonAverages = createServerFn({
  method: "GET",
})
  .inputValidator((data) => z.object({ awayTeamId: z.string(), homeTeamId: z.string() }).parse(data))
  .handler(async ({ data }) => fetchTeamSeasonAverages(data.awayTeamId, data.homeTeamId));

export const getLeagueTeamOverviewStats = createServerFn({
  method: "GET",
}).handler(async () => fetchLeagueTeamOverviewStats());

export const getTeamSeasonStats = createServerFn({
  method: "GET",
})
  .inputValidator((data) =>
    z
      .object({
        teamAbbr: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    fetchTeamSeasonStats(
      data.teamAbbr,
    ),
  );

export const getTeamRoster = createServerFn({
  method: "GET",
})
  .inputValidator((data) =>
    z
      .object({
        teamAbbr: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    fetchTeamRosterForPage(
      data.teamAbbr,
    ),
  );

export const getTeamDepthChart = createServerFn({
  method: "GET",
})
  .inputValidator((data) =>
    z
      .object({
        teamAbbr: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    fetchTeamDepthChart(
      data.teamAbbr,
    ),
  );

export const getPlayerProfile = createServerFn({
  method: "GET",
})
  .inputValidator((data) =>
    z
      .object({
        playerId: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    fetchPlayerProfile(
      data.playerId,
    ),
  );

export const getLeaguePlayers = createServerFn({
  method: "GET",
}).handler(async () => {
  return fetchLeaguePlayers();
});

export const getPlayerGameLog = createServerFn({
  method: "GET",
})
  .inputValidator((data) =>
    z
      .object({
        playerId: z.string(),
        teamId: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    fetchPlayerGameLog(
      data.playerId,
      data.teamId,
    ),
  );

export const getGameWeather = createServerFn({
  method: "GET",
})
  .inputValidator((data) =>
    z
      .object({
        gameId: z.string(),
        homeTeamId: z.string(),
        venue: z.string().optional(),
        status: z.string(),
        gameTime: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    return fetchGameWeather(
      data,
    );
  });

export const getGameProps = createServerFn({
  method: "GET",
})
  .inputValidator((data) =>
    z
      .object({
        eventId: z.string(),
        awayAbbr: z.string(),
        homeAbbr: z.string(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => fetchGameProps(data.eventId, data.awayAbbr, data.homeAbbr));
