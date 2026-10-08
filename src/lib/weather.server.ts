import { getStadiumForGame, type StadiumInfo } from "./stadiums";

export interface GameWeather {
  isIndoor: boolean;
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
}

interface WeatherResult {
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

  if (code === 0) {
    return { condition: "Clear", emoji: "☀️" };
  }

  if (code === 1) {
    return { condition: "Mostly clear", emoji: "🌤️" };
  }

  if (code === 2) {
    return { condition: "Partly cloudy", emoji: "⛅" };
  }

  if (code === 3) {
    return { condition: "Overcast", emoji: "☁️" };
  }

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

  const hour = Number(
    parts.find((p) => p.type === "hour")?.value ?? 0,
  );

  return hour === 24 ? 0 : hour;
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

    const difference =
      Math.abs(timestamp - target);

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * Converts an Open-Meteo response into the format
 * used by GameWeatherCard.
 */
function parseOpenMeteoWeather(
  json: OpenMeteoResponse,
  stadium: StadiumInfo,
  gameTime: string,
): WeatherResult | null {
  const hourlyTimes =
    json.hourly?.time ?? [];

  const temperatures =
    json.hourly?.temperature_2m ?? [];

  const codes =
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
    temperatures[index];

  if (temperature == null) {
    return null;
  }

  const code =
    codes[index] ?? null;

  const weather =
    weatherCodeToCondition(code);

  const gameDate =
    localDateString(
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
      (date) => date === gameDate,
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
    condition:
      weather.condition,
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

/**
 * ============================================================
 * UPCOMING / LIVE — OPEN-METEO
 * ============================================================
 *
 * Used as the international fallback/daily H/L source.
 *
 * This is deliberately separate from completed games.
 */
async function fetchOpenMeteoForecast(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const gameDate =
      localDateString(
        gameTime,
        stadium.timezone,
      );

    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(stadium.lat)}` +
      `&longitude=${encodeURIComponent(stadium.lon)}` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(stadium.timezone)}` +
      `&start_date=${gameDate}` +
      `&end_date=${gameDate}`;

    const response =
      await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] Open-Meteo forecast:",
        response.status,
      );

      return null;
    }

    const json =
      (await response.json()) as OpenMeteoResponse;

    return parseOpenMeteoWeather(
      json,
      stadium,
      gameTime,
    );
  } catch (error) {
    console.error(
      "[WEATHER] Open-Meteo forecast error:",
      error,
    );

    return null;
  }
}

/**
 * ============================================================
 * COMPLETED GAMES — HISTORICAL WEATHER
 * ============================================================
 *
 * Uses the Open-Meteo historical archive ONLY for finished
 * games. This path is completely separate from upcoming/live
 * weather.
 */
async function fetchHistoricalWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const gameDate =
      localDateString(
        gameTime,
        stadium.timezone,
      );

    const url =
      "https://archive-api.open-meteo.com/v1/archive" +
      `?latitude=${encodeURIComponent(stadium.lat)}` +
      `&longitude=${encodeURIComponent(stadium.lon)}` +
      `&start_date=${gameDate}` +
      `&end_date=${gameDate}` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(stadium.timezone)}` +
      `&cell_selection=nearest`;

    console.log(
      "[WEATHER] Historical request:",
      url,
    );

    const response =
      await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] Historical HTTP:",
        response.status,
      );

      return null;
    }

    const json =
      (await response.json()) as OpenMeteoResponse;

    return parseOpenMeteoWeather(
      json,
      stadium,
      gameTime,
    );
  } catch (error) {
    console.error(
      "[WEATHER] Historical error:",
      error,
    );

    return null;
  }
}

/**
 * ============================================================
 * U.S. UPCOMING / LIVE — NWS
 * ============================================================
 */
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
      console.error(
        "[WEATHER] NWS points:",
        pointsResponse.status,
      );

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
      console.error(
        "[WEATHER] NWS forecast:",
        forecastResponse.status,
      );

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

    const condition =
      best.shortForecast ??
      "Clear";

    const lower =
      condition.toLowerCase();

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
      condition,
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

/**
 * ============================================================
 * MAIN WEATHER FUNCTION
 * ============================================================
 */
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
      timezone: stadium.timezone,
      indoor: stadium.isIndoor,
    },
  );

  /**
   * ----------------------------------------------------------
   * INDOOR
   * ----------------------------------------------------------
   */
  if (stadium.isIndoor) {
    /*
     * Keep the existing indoor behavior.
     *
     * We don't need outdoor weather for these stadiums.
     */
    return {
      isIndoor: true,
      temperature: 72,
      condition: "Indoor",
      emoji: "🏟️",
      high: null,
      low: null,
    };
  }

  /**
   * ----------------------------------------------------------
   * COMPLETED GAME
   * ----------------------------------------------------------
   *
   * THIS is the only branch that uses historical weather.
   *
   * It does not touch NWS or MET Norway.
   */
  if (isCompleted(status)) {
    const historical =
      await fetchHistoricalWeather(
        stadium,
        gameTime,
      );

    if (!historical) {
      console.error(
        "[WEATHER] Historical weather unavailable:",
        {
          gameId,
          gameTime,
          stadium: stadium.name,
        },
      );

      return null;
    }

    return {
      isIndoor: false,
      ...historical,
    };
  }

  /**
   * ----------------------------------------------------------
   * INTERNATIONAL UPCOMING / LIVE
   * ----------------------------------------------------------
   *
   * Open-Meteo provides the international forecast.
   *
   * This replaces the problematic mixed MET/Open-Meteo
   * implementation and keeps the international game entirely
   * in one forecast request.
   */
  const isInternational =
    stadium.timezone ===
      "Europe/London" ||
    stadium.timezone ===
      "Europe/Berlin" ||
    stadium.timezone ===
      "America/Sao_Paulo";

  if (isInternational) {
    const forecast =
      await fetchOpenMeteoForecast(
        stadium,
        gameTime,
      );

    if (forecast) {
      return {
        isIndoor: false,
        ...forecast,
      };
    }

    return null;
  }

  /**
   * ----------------------------------------------------------
   * U.S. UPCOMING / LIVE
   * ----------------------------------------------------------
   *
   * Restore NWS as the primary source.
   */
  const nws =
    await fetchNwsWeather(
      stadium,
      gameTime,
    );

  /**
   * We use Open-Meteo ONLY to supply the daily H/L
   * because NWS hourly forecast does not reliably expose
   * the daily high/low in this response.
   */
  const daily =
    await fetchOpenMeteoForecast(
      stadium,
      gameTime,
    );

  if (nws) {
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

  /**
   * If NWS happens to fail, Open-Meteo remains a fallback
   * rather than making the entire weather card disappear.
   */
  if (daily) {
    return {
      isIndoor: false,
      ...daily,
    };
  }

  return null;
}
