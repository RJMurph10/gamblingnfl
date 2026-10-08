import { getStadiumForGame } from "./stadiums";

export interface GameWeather {
  isIndoor: boolean;
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
  capturedAt: string;
}

/*
 * Completed-game weather cache.
 *
 * Once a completed game's historical weather is found,
 * it is frozen and never replaced with current weather.
 */
const completedGamesWeather = new Map<string, GameWeather>();

/*
 * Current weather cache for upcoming/live games.
 */
interface LiveCacheEntry {
  data: GameWeather;
  timestamp: number;
}

const liveWeatherCache = new Map<string, LiveCacheEntry>();

const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Convert Open-Meteo WMO weather codes into the
 * three-line weather-card condition + emoji.
 */
function mapWmoCode(
  code: number,
  isDay: boolean,
  windSpeedMph: number,
): {
  condition: string;
  emoji: string;
} {
  if (windSpeedMph >= 25 && code <= 3) {
    return {
      condition: "Windy",
      emoji: "💨",
    };
  }

  if (windSpeedMph >= 18 && code <= 3) {
    return {
      condition: "Breezy",
      emoji: "🌬️",
    };
  }

  switch (code) {
    case 0:
      return isDay
        ? {
            condition: "Sunny",
            emoji: "☀️",
          }
        : {
            condition: "Clear",
            emoji: "🌙",
          };

    case 1:
      return isDay
        ? {
            condition: "Mainly Clear",
            emoji: "🌤️",
          }
        : {
            condition: "Clear",
            emoji: "🌙",
          };

    case 2:
      return isDay
        ? {
            condition: "Partly Cloudy",
            emoji: "🌤️",
          }
        : {
            condition: "Partly Cloudy",
            emoji: "☁️",
          };

    case 3:
      return {
        condition: "Cloudy",
        emoji: "☁️",
      };

    case 45:
    case 48:
      return {
        condition: "Foggy",
        emoji: "🌫️",
      };

    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return {
        condition: "Drizzle",
        emoji: "🌦️",
      };

    case 61:
    case 63:
    case 65:
      return {
        condition: "Rain",
        emoji: "🌧️",
      };

    case 66:
    case 67:
      return {
        condition: "Freezing Rain",
        emoji: "🌧️",
      };

    case 71:
    case 73:
    case 75:
    case 77:
      return {
        condition: "Snow",
        emoji: "🌨️",
      };

    case 80:
    case 81:
    case 82:
      return {
        condition: "Showers",
        emoji: "🌦️",
      };

    case 85:
    case 86:
      return {
        condition: "Snow Showers",
        emoji: "🌨️",
      };

    case 95:
    case 96:
    case 99:
      return {
        condition: "Thunderstorms",
        emoji: "⛈️",
      };

    default:
      return isDay
        ? {
            condition: "Clear",
            emoji: "☀️",
          }
        : {
            condition: "Clear",
            emoji: "🌙",
          };
  }
}

/**
 * Get the best available timestamp for when an ESPN game ended.
 *
 * ESPN's summary feed contains play-level wallclock timestamps.
 * The final play is used as the completion time.
 */
async function getGameCompletionTime(
  gameId: string,
): Promise<Date | null> {
  const eventId = gameId.replace(/^espn-/, "");

  try {
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "GamblingNFL/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(
        `ESPN summary HTTP ${response.status}`,
      );
    }

    const data = await response.json();

    const plays = Array.isArray(data?.plays)
      ? data.plays
      : [];

    /*
     * Work backward through the plays.
     * The last wallclock timestamp is the closest
     * available representation of game completion.
     */
    for (let i = plays.length - 1; i >= 0; i -= 1) {
      const wallclock = plays[i]?.wallclock;

      if (typeof wallclock !== "string") {
        continue;
      }

      const date = new Date(wallclock);

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    /*
     * Fallback to ESPN's competition timestamp if no
     * play-level timestamp exists.
     */
    const competitionDate =
      data?.header?.competitions?.[0]?.date ??
      data?.header?.competitions?.[0]?.startDate;

    if (typeof competitionDate === "string") {
      const date = new Date(competitionDate);

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  } catch (error) {
    console.warn(
      "Could not determine ESPN game completion time:",
      error,
    );

    return null;
  }
}

/**
 * Get historical weather around the time the game ended.
 */
async function fetchHistoricalGameWeather(params: {
  gameId: string;
  lat: number;
  lon: number;
}): Promise<GameWeather> {
  const completionTime =
    await getGameCompletionTime(params.gameId);

  const targetTime =
    completionTime ?? new Date();

  const year = targetTime.getUTCFullYear();

  const month = String(
    targetTime.getUTCMonth() + 1,
  ).padStart(2, "0");

  const day = String(
    targetTime.getUTCDate(),
  ).padStart(2, "0");

  const dateString =
    `${year}-${month}-${day}`;

  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${encodeURIComponent(params.lat)}` +
    `&longitude=${encodeURIComponent(params.lon)}` +
    `&start_date=${dateString}` +
    `&end_date=${dateString}` +
    `&hourly=temperature_2m,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&timezone=auto`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "GamblingNFL/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Open-Meteo archive HTTP ${response.status}`,
    );
  }

  const data = await response.json();

  const times: string[] =
    Array.isArray(data?.hourly?.time)
      ? data.hourly.time
      : [];

  const temperatures: number[] =
    Array.isArray(
      data?.hourly?.temperature_2m,
    )
      ? data.hourly.temperature_2m
      : [];

  const weatherCodes: number[] =
    Array.isArray(
      data?.hourly?.weather_code,
    )
      ? data.hourly.weather_code
      : [];

  const windSpeeds: number[] =
    Array.isArray(
      data?.hourly?.wind_speed_10m,
    )
      ? data.hourly.wind_speed_10m
      : [];

  if (times.length === 0) {
    throw new Error(
      "Open-Meteo archive returned no hourly data",
    );
  }

  /*
   * Find the hourly observation closest to the
   * game's actual completion time.
   */
  let bestIndex = 0;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let i = 0; i < times.length; i += 1) {
    const observationTime =
      new Date(times[i]);

    if (
      Number.isNaN(
        observationTime.getTime(),
      )
    ) {
      continue;
    }

    const difference = Math.abs(
      observationTime.getTime() -
        targetTime.getTime(),
    );

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  const temperature = Math.round(
    Number(
      temperatures[bestIndex] ?? 65,
    ),
  );

  const weatherCode = Number(
    weatherCodes[bestIndex] ?? 0,
  );

  const windSpeed = Number(
    windSpeeds[bestIndex] ?? 0,
  );

  const observationTime =
    new Date(times[bestIndex]);

  /*
   * The archive response is localized to the stadium's
   * timezone because timezone=auto was requested.
   */
  const hour =
    observationTime.getHours();

  const isDay =
    hour >= 7 && hour < 19;

  const {
    condition,
    emoji,
  } = mapWmoCode(
    weatherCode,
    isDay,
    windSpeed,
  );

  const high = Math.round(
    Number(
      data?.daily?.temperature_2m_max?.[0] ??
        temperature,
    ),
  );

  const low = Math.round(
    Number(
      data?.daily?.temperature_2m_min?.[0] ??
        temperature,
    ),
  );

  return {
    isIndoor: false,
    temperature,
    condition,
    emoji,
    high,
    low,

    /*
     * This represents the weather observation itself,
     * not the time the page was opened.
     */
    capturedAt:
      observationTime.toISOString(),
  };
}

/**
 * Get current weather for upcoming/live games.
 */
async function fetchCurrentGameWeather(params: {
  lat: number;
  lon: number;
}): Promise<GameWeather> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(params.lat)}` +
    `&longitude=${encodeURIComponent(params.lon)}` +
    `&current=temperature_2m,weather_code,is_day,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph` +
    `&timezone=auto`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "GamblingNFL/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Open-Meteo HTTP ${response.status}`,
    );
  }

  const data = await response.json();

  const temperature = Math.round(
    Number(
      data?.current?.temperature_2m ?? 65,
    ),
  );

  const weatherCode = Number(
    data?.current?.weather_code ?? 0,
  );

  const isDay =
    Number(
      data?.current?.is_day ?? 1,
    ) === 1;

  const windSpeed = Number(
    data?.current?.wind_speed_10m ?? 0,
  );

  const high = Math.round(
    Number(
      data?.daily?.temperature_2m_max?.[0] ??
        temperature,
    ),
  );

  const low = Math.round(
    Number(
      data?.daily?.temperature_2m_min?.[0] ??
        temperature,
    ),
  );

  const {
    condition,
    emoji,
  } = mapWmoCode(
    weatherCode,
    isDay,
    windSpeed,
  );

  return {
    isIndoor: false,
    temperature,
    condition,
    emoji,
    high,
    low,
    capturedAt:
      new Date().toISOString(),
  };
}

export async function fetchGameWeather(params: {
  gameId: string;
  homeTeamId: string;
  venue?: string;
  status: string;
}): Promise<GameWeather> {
  const stadium = getStadiumForGame(
    params.homeTeamId,
    params.venue,
  );

  /*
   * Indoor stadiums don't use outdoor weather.
   */
  if (stadium.isIndoor) {
    return {
      isIndoor: true,
      temperature: null,
      condition: "Indoor",
      emoji: "🏟️",
      high: null,
      low: null,
      capturedAt:
        new Date().toISOString(),
    };
  }

  const normalizedStatus =
    params.status
      .toLowerCase()
      .trim();

  const isFinal =
    normalizedStatus === "final" ||
    normalizedStatus === "completed";

  /*
   * COMPLETED GAME
   *
   * Never request current weather.
   * Instead request historical weather around
   * the actual completion time.
   */
  if (isFinal) {
    const cached =
      completedGamesWeather.get(
        params.gameId,
      );

    if (cached) {
      return cached;
    }

    try {
      const historicalWeather =
        await fetchHistoricalGameWeather({
          gameId: params.gameId,
          lat: stadium.lat,
          lon: stadium.lon,
        });

      /*
       * Freeze the result.
       */
      completedGamesWeather.set(
        params.gameId,
        historicalWeather,
      );

      return historicalWeather;
    } catch (error) {
      console.warn(
        "Historical weather fetch failed:",
        error,
      );

      /*
       * Don't pretend current weather is the
       * weather from the completed game.
       */
      return {
        isIndoor: false,
        temperature: null,
        condition: "Weather Unavailable",
        emoji: "🌡️",
        high: null,
        low: null,
        capturedAt:
          new Date().toISOString(),
      };
    }
  }

  /*
   * UPCOMING / LIVE GAME
   *
   * Current weather at the exact stadium location.
   */
  const cached =
    liveWeatherCache.get(
      params.gameId,
    );

  if (
    cached &&
    Date.now() - cached.timestamp <
      CACHE_TTL_MS
  ) {
    return cached.data;
  }

  try {
    const currentWeather =
      await fetchCurrentGameWeather({
        lat: stadium.lat,
        lon: stadium.lon,
      });

    liveWeatherCache.set(
      params.gameId,
      {
        data: currentWeather,
        timestamp: Date.now(),
      },
    );

    return currentWeather;
  } catch (error) {
    console.warn(
      "Current weather fetch failed:",
      error,
    );

    return {
      isIndoor: false,
      temperature: null,
      condition: "Weather Unavailable",
      emoji: "🌡️",
      high: null,
      low: null,
      capturedAt:
        new Date().toISOString(),
    };
  }
}
