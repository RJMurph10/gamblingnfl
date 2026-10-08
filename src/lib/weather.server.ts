import { getStadiumForGame, type StadiumInfo } from "./stadiums";

export interface GameWeather {
  isIndoor: boolean;
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
}

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    weather_code?: number[];
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
  };
  error?: boolean;
  reason?: string;
}

function isCompleted(status: string): boolean {
  const s = status.toLowerCase();

  return (
    s === "post" ||
    s === "final" ||
    s === "completed" ||
    s === "complete" ||
    s.includes("final") ||
    s.includes("post")
  );
}

function weatherCodeToCondition(
  code: number | null | undefined,
): {
  condition: string;
  emoji: string;
} {
  if (code == null) {
    return {
      condition: "Clear",
      emoji: "☀️",
    };
  }

  if (code === 0) return { condition: "Clear", emoji: "☀️" };
  if (code === 1) return { condition: "Mostly clear", emoji: "🌤️" };
  if (code === 2) return { condition: "Partly cloudy", emoji: "⛅" };
  if (code === 3) return { condition: "Overcast", emoji: "☁️" };

  if (code === 45 || code === 48) {
    return { condition: "Foggy", emoji: "🌫️" };
  }

  if (code >= 51 && code <= 57) {
    return { condition: "Drizzle", emoji: "🌦️" };
  }

  if (code >= 61 && code <= 67) {
    return { condition: "Rain", emoji: "🌧️" };
  }

  if (code >= 71 && code <= 77) {
    return { condition: "Snow", emoji: "🌨️" };
  }

  if (code >= 80 && code <= 82) {
    return { condition: "Rain showers", emoji: "🌦️" };
  }

  if (code >= 85 && code <= 86) {
    return { condition: "Snow showers", emoji: "🌨️" };
  }

  if (code >= 95 && code <= 99) {
    return { condition: "Thunderstorms", emoji: "⛈️" };
  }

  return {
    condition: "Cloudy",
    emoji: "☁️",
  };
}

function localDateString(
  iso: string,
  timezone: string,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function localHour(
  iso: string,
  timezone: string,
): number {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    },
  ).formatToParts(new Date(iso));

  const value = Number(
    parts.find((p) => p.type === "hour")?.value ?? 0,
  );

  return value === 24 ? 0 : value;
}

function dayNightEmoji(
  gameTime: string,
  timezone: string,
): string {
  const hour = localHour(
    gameTime,
    timezone,
  );

  return hour >= 6 && hour < 18
    ? "☀️"
    : "🌙";
}

function closestIndex(
  times: string[],
  targetIso: string,
): number {
  const target =
    new Date(targetIso).getTime();

  let bestIndex = -1;
  let bestDifference = Infinity;

  for (let i = 0; i < times.length; i++) {
    const timestamp =
      new Date(times[i]).getTime();

    if (!Number.isFinite(timestamp)) {
      continue;
    }

    const difference = Math.abs(
      timestamp - target,
    );

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function buildWeatherResult(
  json: OpenMeteoResponse,
  stadium: StadiumInfo,
  gameTime: string,
): WeatherResult | null {
  const hourlyTimes =
    json.hourly?.time ?? [];

  const hourlyTemperatures =
    json.hourly?.temperature_2m ?? [];

  const hourlyCodes =
    json.hourly?.weather_code ?? [];

  if (!hourlyTimes.length) {
    return null;
  }

  const index = closestIndex(
    hourlyTimes,
    gameTime,
  );

  if (index < 0) {
    return null;
  }

  const temperature =
    hourlyTemperatures[index];

  if (temperature == null) {
    return null;
  }

  const code =
    hourlyCodes[index] ?? null;

  const weather =
    weatherCodeToCondition(code);

  const date = localDateString(
    gameTime,
    stadium.timezone,
  );

  const dailyTimes =
    json.daily?.time ?? [];

  const dailyHighs =
    json.daily?.temperature_2m_max ?? [];

  const dailyLows =
    json.daily?.temperature_2m_min ?? [];

  const dailyIndex =
    dailyTimes.findIndex(
      (value) => value === date,
    );

  const high =
    dailyIndex >= 0 &&
    dailyHighs[dailyIndex] != null
      ? Math.round(
          dailyHighs[dailyIndex]!,
        )
      : null;

  const low =
    dailyIndex >= 0 &&
    dailyLows[dailyIndex] != null
      ? Math.round(
          dailyLows[dailyIndex]!,
        )
      : null;

  return {
    temperature: Math.round(
      temperature,
    ),
    condition: weather.condition,
    emoji:
      code == null
        ? dayNightEmoji(
            gameTime,
            stadium.timezone,
          )
        : weather.emoji,
    high,
    low,
  };
}

type WeatherResult = {
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
};

/**
 * Normal Open-Meteo forecast endpoint.
 *
 * Important:
 * `past_days` lets this endpoint return recently
 * archived weather without touching the separate
 * Historical Forecast API.
 */
async function fetchRecentWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(stadium.lat)}` +
    `&longitude=${encodeURIComponent(stadium.lon)}` +
    `&hourly=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&temperature_unit=fahrenheit` +
    `&timezone=${encodeURIComponent(stadium.timezone)}` +
    `&past_days=16` +
    `&forecast_days=16`;

  console.log(
    "[WEATHER] Recent Open-Meteo request:",
    url,
  );

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] Recent Open-Meteo HTTP error:",
        response.status,
      );

      return null;
    }

    const json =
      (await response.json()) as OpenMeteoResponse;

    return buildWeatherResult(
      json,
      stadium,
      gameTime,
    );
  } catch (error) {
    console.error(
      "[WEATHER] Recent Open-Meteo error:",
      error,
    );

    return null;
  }
}

/**
 * Long-term historical fallback.
 *
 * This is useful for older completed games.
 */
async function fetchHistoricalWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  const date = localDateString(
    gameTime,
    stadium.timezone,
  );

  const url =
    "https://archive-api.open-meteo.com/v1/archive" +
    `?latitude=${encodeURIComponent(stadium.lat)}` +
    `&longitude=${encodeURIComponent(stadium.lon)}` +
    `&start_date=${date}` +
    `&end_date=${date}` +
    `&hourly=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&temperature_unit=fahrenheit` +
    `&timezone=${encodeURIComponent(stadium.timezone)}`;

  console.log(
    "[WEATHER] Historical Archive request:",
    url,
  );

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] Historical Archive HTTP error:",
        response.status,
      );

      return null;
    }

    const json =
      (await response.json()) as OpenMeteoResponse;

    return buildWeatherResult(
      json,
      stadium,
      gameTime,
    );
  } catch (error) {
    console.error(
      "[WEATHER] Historical Archive error:",
      error,
    );

    return null;
  }
}

async function fetchNwsWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const headers = {
      "User-Agent":
        "GamblingNFL/1.0",
    };

    const pointsUrl =
      `https://api.weather.gov/points/${stadium.lat},${stadium.lon}`;

    const pointsResponse =
      await fetch(pointsUrl, {
        headers,
      });

    if (!pointsResponse.ok) {
      return null;
    }

    const points =
      (await pointsResponse.json()) as {
        properties?: {
          forecastHourly?: string;
        };
      };

    const forecastUrl =
      points.properties?.forecastHourly;

    if (!forecastUrl) {
      return null;
    }

    const forecastResponse =
      await fetch(forecastUrl, {
        headers,
      });

    if (!forecastResponse.ok) {
      return null;
    }

    const forecast =
      (await forecastResponse.json()) as {
        properties?: {
          periods?: Array<{
            startTime?: string;
            temperature?: number;
            shortForecast?: string;
            isDaytime?: boolean;
          }>;
        };
      };

    const periods =
      forecast.properties?.periods ?? [];

    if (!periods.length) {
      return null;
    }

    const target =
      new Date(gameTime).getTime();

    let best =
      periods[0];

    let bestDifference =
      Infinity;

    for (const period of periods) {
      if (!period.startTime) {
        continue;
      }

      const difference =
        Math.abs(
          new Date(
            period.startTime,
          ).getTime() - target,
        );

      if (
        difference <
        bestDifference
      ) {
        bestDifference =
          difference;

        best = period;
      }
    }

    if (best.temperature == null) {
      return null;
    }

    const description =
      best.shortForecast ??
      "Unknown";

    const lower =
      description.toLowerCase();

    let emoji = "☀️";

    if (
      lower.includes("thunder") ||
      lower.includes("storm")
    ) {
      emoji = "⛈️";
    } else if (
      lower.includes("snow") ||
      lower.includes("sleet")
    ) {
      emoji = "🌨️";
    } else if (
      lower.includes("rain") ||
      lower.includes("shower")
    ) {
      emoji = "🌧️";
    } else if (
      lower.includes("cloud") ||
      lower.includes("overcast")
    ) {
      emoji = "☁️";
    } else if (
      lower.includes("partly") ||
      lower.includes("mostly")
    ) {
      emoji = "🌤️";
    } else if (
      best.isDaytime === false
    ) {
      emoji = "🌙";
    }

    return {
      temperature: Math.round(
        best.temperature,
      ),
      condition: description,
      emoji,
      high: null,
      low: null,
    };
  } catch (error) {
    console.error(
      "[WEATHER] NWS error:",
      error,
    );

    return null;
  }
}

export async function fetchGameWeather({
  gameId,
  homeTeamId,
  venue,
  status,
  gameTime,
}: {
  gameId: string;
  homeTeamId: string;
  venue?: string;
  status: string;
  gameTime: string;
}): Promise<GameWeather | null> {
  const stadium =
    getStadiumForGame(
      homeTeamId,
      venue,
    );

  console.log(
    "[WEATHER]",
    {
      gameId,
      status,
      gameTime,
      stadium: stadium.name,
      lat: stadium.lat,
      lon: stadium.lon,
      timezone: stadium.timezone,
      indoor: stadium.isIndoor,
    },
  );

  /*
   * INDOOR
   */
  if (stadium.isIndoor) {
    const weather =
      await fetchRecentWeather(
        stadium,
        gameTime,
      );

    return {
      isIndoor: true,
      temperature:
        weather?.temperature ?? 72,
      condition: "Indoor",
      emoji: "🏟️",
      high: null,
      low: null,
    };
  }

  /*
   * COMPLETED GAME
   *
   * First use the normal forecast endpoint with
   * past_days because recent NFL games are exactly
   * what this endpoint is good at.
   *
   * If that does not contain the game, use the
   * long-term archive.
   */
  if (isCompleted(status)) {
    const recent =
      await fetchRecentWeather(
        stadium,
        gameTime,
      );

    if (recent) {
      console.log(
        "[WEATHER] Completed game loaded from recent archive.",
      );

      return {
        isIndoor: false,
        ...recent,
      };
    }

    const historical =
      await fetchHistoricalWeather(
        stadium,
        gameTime,
      );

    if (historical) {
      console.log(
        "[WEATHER] Completed game loaded from historical archive.",
      );

      return {
        isIndoor: false,
        ...historical,
      };
    }

    console.error(
      "[WEATHER] No historical weather found.",
      {
        gameId,
        gameTime,
        stadium,
      },
    );

    return null;
  }

  /*
   * UPCOMING / LIVE
   *
   * Use Open-Meteo for ALL outdoor games.
   *
   * This guarantees that the same response contains:
   * temperature + condition + daily high + daily low.
   *
   * This also fixes London because we no longer have
   * one provider supplying the temperature and another
   * provider supplying the condition/H-L.
   */
  const openMeteo =
    await fetchRecentWeather(
      stadium,
      gameTime,
    );

  if (openMeteo) {
    return {
      isIndoor: false,
      ...openMeteo,
    };
  }

  /*
   * U.S. NWS fallback.
   */
  const nws =
    await fetchNwsWeather(
      stadium,
      gameTime,
    );

  if (nws) {
    /*
     * NWS gives us the kickoff temperature and
     * condition, but often does not give daily H/L
     * through this endpoint.
     *
     * Try Open-Meteo one more time specifically
     * for the daily values.
     */
    const daily =
      await fetchRecentWeather(
        stadium,
        gameTime,
      );

    return {
      isIndoor: false,
      temperature:
        nws.temperature,
      condition:
        nws.condition,
      emoji:
        nws.emoji,
      high:
        daily?.high ?? null,
      low:
        daily?.low ?? null,
    };
  }

  return null;
}
