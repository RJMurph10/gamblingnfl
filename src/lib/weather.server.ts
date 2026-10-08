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

const completedGamesWeather = new Map<string, GameWeather>();

interface LiveCacheEntry {
  data: GameWeather;
  timestamp: number;
}

const liveWeatherCache = new Map<string, LiveCacheEntry>();

const LIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;

const DEFAULT_INDOOR_TEMPERATURE = 72;

/**
 * Fetch with a timeout so a weather provider that is slow or
 * unreachable cannot hang the server function indefinitely.
 */
async function fetchWithTimeout(
  url: string,
): Promise<Response> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert WMO weather codes into a simple condition + emoji.
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
        ? { condition: "Sunny", emoji: "☀️" }
        : { condition: "Clear", emoji: "🌙" };

    case 1:
      return isDay
        ? { condition: "Mainly Clear", emoji: "🌤️" }
        : { condition: "Clear", emoji: "🌙" };

    case 2:
      return {
        condition: "Partly Cloudy",
        emoji: "🌤️",
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
        ? { condition: "Clear", emoji: "☀️" }
        : { condition: "Clear", emoji: "🌙" };
  }
}

/**
 * Get the actual end time of a completed ESPN game.
 */
async function getGameCompletionTime(
  gameId: string,
): Promise<Date | null> {
  const eventId = gameId.replace(/^espn-/, "");

  try {
    const url =
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary" +
      `?event=${encodeURIComponent(eventId)}`;

    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(
        `ESPN summary returned HTTP ${response.status}`,
      );
    }

    const data = await response.json();

    const plays = Array.isArray(data?.plays)
      ? data.plays
      : [];

    /*
     * The final play's wallclock is the best approximation
     * of when the game actually ended.
     */
    for (let i = plays.length - 1; i >= 0; i -= 1) {
      const wallclock = plays[i]?.wallclock;

      if (typeof wallclock !== "string") {
        continue;
      }

      const parsed = new Date(wallclock);

      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    const competitionDate =
      data?.header?.competitions?.[0]?.date ??
      data?.header?.competitions?.[0]?.startDate;

    if (typeof competitionDate === "string") {
      const parsed = new Date(competitionDate);

      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return null;
  } catch (error) {
    console.warn(
      "[Weather] Could not determine game completion time:",
      error,
    );

    return null;
  }
}

/**
 * Get historical weather for a completed game.
 *
 * We request the complete local day, then select the hourly
 * observation closest to the actual game completion time.
 */
async function fetchHistoricalGameWeather(params: {
  gameId: string;
  lat: number;
  lon: number;
}): Promise<GameWeather> {
  const completionTime =
    await getGameCompletionTime(params.gameId);

  if (!completionTime) {
    throw new Error(
      "Could not determine completed game time",
    );
  }

  const year =
    completionTime.getUTCFullYear();

  const month = String(
    completionTime.getUTCMonth() + 1,
  ).padStart(2, "0");

  const day = String(
    completionTime.getUTCDate(),
  ).padStart(2, "0");

  const dateString =
    `${year}-${month}-${day}`;

  const url = new URL(
    "https://archive-api.open-meteo.com/v1/archive",
  );

  url.searchParams.set(
    "latitude",
    String(params.lat),
  );

  url.searchParams.set(
    "longitude",
    String(params.lon),
  );

  url.searchParams.set(
    "start_date",
    dateString,
  );

  url.searchParams.set(
    "end_date",
    dateString,
  );

  url.searchParams.set(
    "hourly",
    "temperature_2m,weather_code,wind_speed_10m",
  );

  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min",
  );

  url.searchParams.set(
    "temperature_unit",
    "fahrenheit",
  );

  url.searchParams.set(
    "wind_speed_unit",
    "mph",
  );

  url.searchParams.set(
    "timezone",
    "auto",
  );

  const response =
    await fetchWithTimeout(url.toString());

  if (!response.ok) {
    throw new Error(
      `Open-Meteo archive returned HTTP ${response.status}`,
    );
  }

  const data = await response.json();

  const times =
    Array.isArray(data?.hourly?.time)
      ? data.hourly.time
      : [];

  const temperatures =
    Array.isArray(
      data?.hourly?.temperature_2m,
    )
      ? data.hourly.temperature_2m
      : [];

  const weatherCodes =
    Array.isArray(
      data?.hourly?.weather_code,
    )
      ? data.hourly.weather_code
      : [];

  const windSpeeds =
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

  let bestIndex = -1;
  let smallestDifference =
    Number.POSITIVE_INFINITY;

  for (
    let i = 0;
    i < times.length;
    i += 1
  ) {
    const observation =
      new Date(times[i]);

    if (
      Number.isNaN(
        observation.getTime(),
      )
    ) {
      continue;
    }

    const difference =
      Math.abs(
        observation.getTime() -
          completionTime.getTime(),
      );

    if (difference < smallestDifference) {
      smallestDifference = difference;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) {
    throw new Error(
      "Could not match historical weather observation",
    );
  }

  const temperatureValue =
    Number(
      temperatures[bestIndex],
    );

  if (!Number.isFinite(temperatureValue)) {
    throw new Error(
      "Historical temperature was invalid",
    );
  }

  const temperature =
    Math.round(temperatureValue);

  const weatherCode =
    Number(
      weatherCodes[bestIndex] ?? 0,
    );

  const windSpeed =
    Number(
      windSpeeds[bestIndex] ?? 0,
    );

  const observationTime =
    new Date(times[bestIndex]);

  const hour =
    observationTime.getHours();

  const isDay =
    hour >= 7 && hour < 19;

  const mapped =
    mapWmoCode(
      weatherCode,
      isDay,
      windSpeed,
    );

  const highValue =
    Number(
      data?.daily
        ?.temperature_2m_max?.[0],
    );

  const lowValue =
    Number(
      data?.daily
        ?.temperature_2m_min?.[0],
    );

  return {
    isIndoor: false,
    temperature,
    condition: mapped.condition,
    emoji: mapped.emoji,
    high: Number.isFinite(highValue)
      ? Math.round(highValue)
      : temperature,
    low: Number.isFinite(lowValue)
      ? Math.round(lowValue)
      : temperature,
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
  const url = new URL(
    "https://api.open-meteo.com/v1/forecast",
  );

  url.searchParams.set(
    "latitude",
    String(params.lat),
  );

  url.searchParams.set(
    "longitude",
    String(params.lon),
  );

  url.searchParams.set(
    "current",
    "temperature_2m,weather_code,is_day,wind_speed_10m",
  );

  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min",
  );

  url.searchParams.set(
    "temperature_unit",
    "fahrenheit",
  );

  url.searchParams.set(
    "wind_speed_unit",
    "mph",
  );

  url.searchParams.set(
    "timezone",
    "auto",
  );

  const response =
    await fetchWithTimeout(url.toString());

  if (!response.ok) {
    throw new Error(
      `Open-Meteo forecast returned HTTP ${response.status}`,
    );
  }

  const data = await response.json();

  if (!data?.current) {
    throw new Error(
      "Open-Meteo forecast returned no current data",
    );
  }

  const temperatureValue =
    Number(
      data.current.temperature_2m,
    );

  if (!Number.isFinite(temperatureValue)) {
    throw new Error(
      "Current temperature was invalid",
    );
  }

  const temperature =
    Math.round(temperatureValue);

  const weatherCode =
    Number(
      data.current.weather_code ?? 0,
    );

  const isDay =
    Number(
      data.current.is_day ?? 1,
    ) === 1;

  const windSpeed =
    Number(
      data.current.wind_speed_10m ?? 0,
    );

  const highValue =
    Number(
      data?.daily
        ?.temperature_2m_max?.[0],
    );

  const lowValue =
    Number(
      data?.daily
        ?.temperature_2m_min?.[0],
    );

  const mapped =
    mapWmoCode(
      weatherCode,
      isDay,
      windSpeed,
    );

  return {
    isIndoor: false,
    temperature,
    condition: mapped.condition,
    emoji: mapped.emoji,
    high: Number.isFinite(highValue)
      ? Math.round(highValue)
      : temperature,
    low: Number.isFinite(lowValue)
      ? Math.round(lowValue)
      : temperature,
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
  const stadium =
    getStadiumForGame(
      params.homeTeamId,
      params.venue,
    );

  /*
   * Indoor stadiums never contact Open-Meteo.
   */
  if (stadium.isIndoor) {
    return {
      isIndoor: true,
      temperature:
        DEFAULT_INDOOR_TEMPERATURE,
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
   * Fetch historical weather once and keep it cached.
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
      const weather =
        await fetchHistoricalGameWeather({
          gameId: params.gameId,
          lat: stadium.lat,
          lon: stadium.lon,
        });

      completedGamesWeather.set(
        params.gameId,
        weather,
      );

      return weather;
    } catch (error) {
      console.warn(
        `[Weather] Historical weather failed for ${params.gameId}:`,
        error,
      );

      return {
        isIndoor: false,
        temperature: null,
        condition:
          "Weather Unavailable",
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
   * Reuse the current weather for 10 minutes.
   * The page itself refreshes this every 12 minutes.
   */
  const cached =
    liveWeatherCache.get(
      params.gameId,
    );

  if (
    cached &&
    Date.now() - cached.timestamp <
      LIVE_CACHE_TTL_MS
  ) {
    return cached.data;
  }

  try {
    const weather =
      await fetchCurrentGameWeather({
        lat: stadium.lat,
        lon: stadium.lon,
      });

    liveWeatherCache.set(
      params.gameId,
      {
        data: weather,
        timestamp: Date.now(),
      },
    );

    return weather;
  } catch (error) {
    console.warn(
      `[Weather] Current weather failed for ${params.gameId}:`,
      error,
    );

    return {
      isIndoor: false,
      temperature: null,
      condition:
        "Weather Unavailable",
      emoji: "🌡️",
      high: null,
      low: null,
      capturedAt:
        new Date().toISOString(),
    };
  }
}
