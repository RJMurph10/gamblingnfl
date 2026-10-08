import {
  getStadiumForGame,
  type StadiumInfo,
} from "./stadiums";

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

/**
 * MET Norway compact response.
 *
 * MET Norway returns timestamps in UTC and temperatures in Celsius.
 */
interface MetNorwayResponse {
  properties?: {
    timeseries?: Array<{
      time?: string;
      data?: {
        instant?: {
          details?: {
            air_temperature?: number;
          };
        };
        next_1_hours?: {
          summary?: {
            symbol_code?: string;
          };
        };
        next_6_hours?: {
          summary?: {
            symbol_code?: string;
          };
        };
      };
    }>;
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
    return {
      condition: "Clear",
      emoji: "☀️",
    };
  }

  if (code === 1) {
    return {
      condition: "Mostly clear",
      emoji: "🌤️",
    };
  }

  if (code === 2) {
    return {
      condition: "Partly cloudy",
      emoji: "⛅",
    };
  }

  if (code === 3) {
    return {
      condition: "Overcast",
      emoji: "☁️",
    };
  }

  if (code === 45 || code === 48) {
    return {
      condition: "Foggy",
      emoji: "🌫️",
    };
  }

  if (code >= 51 && code <= 57) {
    return {
      condition: "Drizzle",
      emoji: "🌦️",
    };
  }

  if (code >= 61 && code <= 67) {
    return {
      condition: "Rain",
      emoji: "🌧️",
    };
  }

  if (code >= 71 && code <= 77) {
    return {
      condition: "Snow",
      emoji: "🌨️",
    };
  }

  if (code >= 80 && code <= 82) {
    return {
      condition: "Rain showers",
      emoji: "🌦️",
    };
  }

  if (code >= 85 && code <= 86) {
    return {
      condition: "Snow showers",
      emoji: "🌨️",
    };
  }

  if (code >= 95 && code <= 99) {
    return {
      condition: "Thunderstorms",
      emoji: "⛈️",
    };
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
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      },
    ).formatToParts(new Date(iso));

  const hour = Number(
    parts.find(
      (p) => p.type === "hour",
    )?.value ?? 0,
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

  for (
    let i = 0;
    i < times.length;
    i++
  ) {
    const timestamp =
      new Date(times[i]).getTime();

    if (!Number.isFinite(timestamp)) {
      continue;
    }

    const difference =
      Math.abs(timestamp - target);

    if (
      difference <
      bestDifference
    ) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * Converts an Open-Meteo response into the
 * format used by GameWeatherCard.
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
    json.daily?.temperature_2m_max ??
    [];

  const dailyLows =
    json.daily?.temperature_2m_min ??
    [];

  const dailyIndex =
    dailyTimes.findIndex(
      (date) =>
        date === gameDate,
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
 * OPEN-METEO FORECAST
 * ============================================================
 *
 * Used for:
 * - U.S. daily high/low
 * - fallback weather
 * - historical fallback
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
      `?latitude=${encodeURIComponent(
        stadium.lat,
      )}` +
      `&longitude=${encodeURIComponent(
        stadium.lon,
      )}` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(
        stadium.timezone,
      )}` +
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
 * MET NORWAY — INTERNATIONAL UPCOMING / LIVE
 * ============================================================
 *
 * MET Norway provides a global forecast.
 *
 * IMPORTANT:
 * - API temperatures are Celsius.
 * - API timestamps are UTC.
 * - We match the actual kickoff timestamp.
 * - The API requires a proper identifying User-Agent.
 */
function metSymbolToWeather(
  symbol: string | undefined,
): {
  condition: string;
  emoji: string;
} {
  if (!symbol) {
    return {
      condition: "Clear",
      emoji: "☀️",
    };
  }

  const s =
    symbol.toLowerCase();

  if (
    s.includes("thunder")
  ) {
    return {
      condition: "Thunderstorms",
      emoji: "⛈️",
    };
  }

  if (
    s.includes("snow")
  ) {
    return {
      condition:
        s.includes("shower")
          ? "Snow showers"
          : "Snow",
      emoji: "🌨️",
    };
  }

  if (
    s.includes("sleet")
  ) {
    return {
      condition: "Sleet",
      emoji: "🌨️",
    };
  }

  if (
    s.includes("rain")
  ) {
    return {
      condition:
        s.includes("shower")
          ? "Rain showers"
          : "Rain",
      emoji: "🌧️",
    };
  }

  if (
    s.includes("fog")
  ) {
    return {
      condition: "Foggy",
      emoji: "🌫️",
    };
  }

  if (
    s.includes("overcast")
  ) {
    return {
      condition: "Overcast",
      emoji: "☁️",
    };
  }

  if (
    s.includes("partlycloudy")
  ) {
    return {
      condition: "Partly cloudy",
      emoji: "⛅",
    };
  }

  if (
    s.includes("cloudy")
  ) {
    return {
      condition: "Cloudy",
      emoji: "☁️",
    };
  }

  if (
    s.includes("clearsky") ||
    s.includes("fair")
  ) {
    return {
      condition:
        s.includes("night")
          ? "Clear"
          : "Clear",
      emoji:
        s.includes("night")
          ? "🌙"
          : "☀️",
    };
  }

  return {
    condition: "Clear",
    emoji: "☀️",
  };
}

async function fetchMetNorwayWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    /*
     * MET Norway recommends no more than four decimal
     * places to facilitate caching.
     */
    const lat =
      stadium.lat.toFixed(4);

    const lon =
      stadium.lon.toFixed(4);

    const url =
      "https://api.met.no/weatherapi/locationforecast/2.0/compact" +
      `?lat=${lat}&lon=${lon}`;

    const response =
      await fetch(url, {
        headers: {
          /*
           * MET Norway requires a unique identifying
           * User-Agent. This is a server-side request.
           */
          "User-Agent":
            "GamblingNFL/1.0 (weather analytics website)",
          Accept:
            "application/json",
        },
      });

    if (!response.ok) {
      console.error(
        "[WEATHER] MET Norway HTTP:",
        response.status,
      );

      return null;
    }

    const json =
      (await response.json()) as MetNorwayResponse;

    const series =
      json.properties?.timeseries ?? [];

    if (!series.length) {
      console.error(
        "[WEATHER] MET Norway returned no timeseries",
      );

      return null;
    }

    const times =
      series
        .map((entry) => entry.time)
        .filter(
          (
            value,
          ): value is string =>
            Boolean(value),
        );

    if (!times.length) {
      return null;
    }

    const index =
      closestIndex(
        times,
        gameTime,
      );

    if (index < 0) {
      return null;
    }

    /*
     * The filtered `times` array only contains entries
     * with a time, so find the actual matching entry
     * by timestamp rather than relying on the original
     * array index.
     */
    const target =
      new Date(gameTime).getTime();

    let bestEntry:
      | NonNullable<
          NonNullable<
            MetNorwayResponse["properties"]
          >["timeseries"]
        >[number]
      | null = null;

    let bestDifference =
      Infinity;

    for (
      const entry of series
    ) {
      if (!entry.time) {
        continue;
      }

      const difference =
        Math.abs(
          new Date(
            entry.time,
          ).getTime() -
            target,
        );

      if (
        difference <
        bestDifference
      ) {
        bestDifference =
          difference;
        bestEntry =
          entry;
      }
    }

    if (!bestEntry) {
      return null;
    }

    const celsius =
      bestEntry.data
        ?.instant
        ?.details
        ?.air_temperature;

    if (celsius == null) {
      return null;
    }

    /*
     * Celsius -> Fahrenheit.
     */
    const fahrenheit =
      celsius * 9 / 5 + 32;

    const symbol =
      bestEntry.data
        ?.next_1_hours
        ?.summary
        ?.symbol_code ??
      bestEntry.data
        ?.next_6_hours
        ?.summary
        ?.symbol_code;

    const weather =
      metSymbolToWeather(
        symbol,
      );

    /*
     * If MET Norway doesn't provide a usable symbol,
     * determine day/night from the stadium's actual
     * local timezone.
     */
    const emoji =
      symbol
        ? weather.emoji
        : dayNightEmoji(
            gameTime,
            stadium.timezone,
          );

    return {
      temperature:
        Math.round(
          fahrenheit,
        ),
      condition:
        weather.condition,
      emoji,
      high: null,
      low: null,
    };
  } catch (error) {
    console.error(
      "[WEATHER] MET Norway error:",
      error,
    );

    return null;
  }
}

/**
 * ============================================================
 * INTERNATIONAL HIGH / LOW
 * ============================================================
 *
 * MET Norway supplies the kickoff temperature/condition.
 * Open-Meteo supplies the daily high/low.
 *
 * This is intentionally a separate request so London does
 * not end up showing a temperature while the card says
 * "Weather unavailable".
 */
async function fetchInternationalDailyHighLow(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<{
  high: number | null;
  low: number | null;
}> {
  try {
    const gameDate =
      localDateString(
        gameTime,
        stadium.timezone,
      );

    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(
        stadium.lat,
      )}` +
      `&longitude=${encodeURIComponent(
        stadium.lon,
      )}` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(
        stadium.timezone,
      )}` +
      `&start_date=${gameDate}` +
      `&end_date=${gameDate}`;

    const response =
      await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] International H/L HTTP:",
        response.status,
      );

      return {
        high: null,
        low: null,
      };
    }

    const json =
      (await response.json()) as OpenMeteoResponse;

    const highs =
      json.daily
        ?.temperature_2m_max ?? [];

    const lows =
      json.daily
        ?.temperature_2m_min ?? [];

    return {
      high:
        highs[0] != null
          ? Math.round(
              highs[0],
            )
          : null,
      low:
        lows[0] != null
          ? Math.round(
              lows[0],
            )
          : null,
    };
  } catch (error) {
    console.error(
      "[WEATHER] International H/L error:",
      error,
    );

    return {
      high: null,
      low: null,
    };
  }
}

/**
 * ============================================================
 * HISTORICAL FORECAST API
 * ============================================================
 *
 * Primary completed-game source.
 *
 * This is different from the normal Forecast API.
 * Open-Meteo specifically provides archived forecasts for
 * past weather conditions.
 */
async function fetchHistoricalForecastWeather(
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
      "https://historical-forecast-api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(
        stadium.lat,
      )}` +
      `&longitude=${encodeURIComponent(
        stadium.lon,
      )}` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(
        stadium.timezone,
      )}` +
      `&start_date=${gameDate}` +
      `&end_date=${gameDate}`;

    console.log(
      "[WEATHER] Historical Forecast request:",
      url,
    );

    const response =
      await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] Historical Forecast HTTP:",
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
      "[WEATHER] Historical Forecast error:",
      error,
    );

    return null;
  }
}

/**
 * ============================================================
 * HISTORICAL WEATHER ARCHIVE
 * ============================================================
 *
 * Secondary completed-game source.
 *
 * This is intentionally only called if the Historical Forecast
 * API fails.
 */
async function fetchHistoricalArchiveWeather(
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
      `?latitude=${encodeURIComponent(
        stadium.lat,
      )}` +
      `&longitude=${encodeURIComponent(
        stadium.lon,
      )}` +
      `&start_date=${gameDate}` +
      `&end_date=${gameDate}` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(
        stadium.timezone,
      )}` +
      `&cell_selection=nearest`;

    console.log(
      "[WEATHER] Historical Archive request:",
      url,
    );

    const response =
      await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] Historical Archive HTTP:",
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
      "[WEATHER] Historical Archive error:",
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
 * Only completed games enter this function.
 *
 * Order:
 *
 * 1. Historical Forecast API
 * 2. Historical Weather Archive
 *
 * Upcoming/live weather NEVER uses this function.
 */
async function fetchHistoricalWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  /*
   * First attempt: archived forecast data.
   */
  const historicalForecast =
    await fetchHistoricalForecastWeather(
      stadium,
      gameTime,
    );

  if (historicalForecast) {
    console.log(
      "[WEATHER] Historical Forecast succeeded",
    );

    return historicalForecast;
  }

  /*
   * Second attempt: historical archive.
   */
  console.log(
    "[WEATHER] Historical Forecast failed; trying archive",
  );

  const archive =
    await fetchHistoricalArchiveWeather(
      stadium,
      gameTime,
    );

  if (archive) {
    console.log(
      "[WEATHER] Historical Archive succeeded",
    );

    return archive;
  }

  return null;
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
      points.properties
        ?.forecastHourly;

    if (!forecastUrl) {
      return null;
    }

    const forecastResponse =
      await fetch(
        forecastUrl,
        {
          headers,
        },
      );

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
      forecast.properties
        ?.periods ?? [];

    if (!periods.length) {
      return null;
    }

    const target =
      new Date(
        gameTime,
      ).getTime();

    let best =
      periods[0];

    let bestDifference =
      Infinity;

    for (
      const period of periods
    ) {
      if (!period.startTime) {
        continue;
      }

      const difference =
        Math.abs(
          new Date(
            period.startTime,
          ).getTime() -
            target,
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

    if (
      best.temperature == null
    ) {
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
      temperature:
        Math.round(
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
      stadium:
        stadium.name,
      timezone:
        stadium.timezone,
      indoor:
        stadium.isIndoor,
    },
  );

  /**
   * ----------------------------------------------------------
   * INDOOR
   * ----------------------------------------------------------
   */
  if (stadium.isIndoor) {
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
   * Historical weather is ONLY used here.
   *
   * This means a finished game can never interfere with
   * the working upcoming/live weather systems.
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
          stadium:
            stadium.name,
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
   * RESTORED TO MET NORWAY.
   *
   * This is intentionally not using the historical system.
   */
  const isInternational =
    stadium.timezone ===
      "Europe/London" ||
    stadium.timezone ===
      "Europe/Berlin" ||
    stadium.timezone ===
      "America/Sao_Paulo";

  if (isInternational) {
    const metWeather =
      await fetchMetNorwayWeather(
        stadium,
        gameTime,
      );

    if (metWeather) {
      const daily =
        await fetchInternationalDailyHighLow(
          stadium,
          gameTime,
        );

      return {
        isIndoor: false,
        temperature:
          metWeather.temperature,
        condition:
          metWeather.condition,
        emoji:
          metWeather.emoji,
        high:
          daily.high,
        low:
          daily.low,
      };
    }

    /*
     * If MET Norway fails, use Open-Meteo as a fallback.
     */
    const fallback =
      await fetchOpenMeteoForecast(
        stadium,
        gameTime,
      );

    if (fallback) {
      return {
        isIndoor: false,
        ...fallback,
      };
    }

    return null;
  }

  /**
   * ----------------------------------------------------------
   * U.S. UPCOMING / LIVE
   * ----------------------------------------------------------
   *
   * NWS remains the primary source.
   */
  const nws =
    await fetchNwsWeather(
      stadium,
      gameTime,
    );

  /**
   * Open-Meteo supplies daily H/L.
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
   * Open-Meteo remains the fallback if NWS fails.
   */
  if (daily) {
    return {
      isIndoor: false,
      ...daily,
    };
  }

  return null;
}
