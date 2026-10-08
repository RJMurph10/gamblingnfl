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

function isCompleted(
  status: string,
): boolean {
  const s =
    status.toLowerCase();

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

  if (
    code === 45 ||
    code === 48
  ) {
    return {
      condition: "Foggy",
      emoji: "🌫️",
    };
  }

  if (
    code >= 51 &&
    code <= 57
  ) {
    return {
      condition: "Drizzle",
      emoji: "🌦️",
    };
  }

  if (
    code >= 61 &&
    code <= 67
  ) {
    return {
      condition: "Rain",
      emoji: "🌧️",
    };
  }

  if (
    code >= 71 &&
    code <= 77
  ) {
    return {
      condition: "Snow",
      emoji: "🌨️",
    };
  }

  if (
    code >= 80 &&
    code <= 82
  ) {
    return {
      condition: "Rain showers",
      emoji: "🌦️",
    };
  }

  if (
    code >= 85 &&
    code <= 86
  ) {
    return {
      condition: "Snow showers",
      emoji: "🌨️",
    };
  }

  if (
    code >= 95 &&
    code <= 99
  ) {
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
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date(iso));
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
    ).formatToParts(
      new Date(iso),
    );

  const hour = Number(
    parts.find(
      (p) =>
        p.type === "hour",
    )?.value ?? 0,
  );

  return hour === 24
    ? 0
    : hour;
}

function dayNightEmoji(
  gameTime: string,
  timezone: string,
): string {
  const hour =
    localHour(
      gameTime,
      timezone,
    );

  return hour >= 6 &&
    hour < 18
    ? "☀️"
    : "🌙";
}

function closestIndex(
  times: string[],
  targetIso: string,
): number {
  const target =
    new Date(
      targetIso,
    ).getTime();

  let bestIndex = -1;
  let bestDifference =
    Infinity;

  for (
    let i = 0;
    i < times.length;
    i++
  ) {
    const timestamp =
      new Date(
        times[i],
      ).getTime();

    if (
      !Number.isFinite(
        timestamp,
      )
    ) {
      continue;
    }

    const difference =
      Math.abs(
        timestamp -
          target,
      );

    if (
      difference <
      bestDifference
    ) {
      bestDifference =
        difference;

      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * ============================================================
 * OPEN-METEO HOURLY WEATHER
 * ============================================================
 */
function parseOpenMeteoWeather(
  json: OpenMeteoResponse,
  stadium: StadiumInfo,
  gameTime: string,
): WeatherResult | null {
  const hourlyTimes =
    json.hourly?.time ?? [];

  const temperatures =
    json.hourly
      ?.temperature_2m ?? [];

  const codes =
    json.hourly
      ?.weather_code ?? [];

  if (
    !hourlyTimes.length
  ) {
    return null;
  }

  const index =
    closestIndex(
      hourlyTimes,
      gameTime,
    );

  if (index < 0) {
    return null;
  }

  const temperature =
    temperatures[index];

  if (
    temperature == null
  ) {
    return null;
  }

  const code =
    codes[index] ?? null;

  const weather =
    weatherCodeToCondition(
      code,
    );

  return {
    temperature:
      Math.round(
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

    high: null,
    low: null,
  };
}

/**
 * ============================================================
 * DEDICATED DAILY HIGH / LOW
 * ============================================================
 *
 * This is intentionally independent of the hourly weather
 * request.
 */
async function fetchDailyHighLow(
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

    console.log(
      "[WEATHER] Daily H/L request:",
      url,
    );

    const response =
      await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] Daily H/L HTTP:",
        response.status,
      );

      return {
        high: null,
        low: null,
      };
    }

    const json =
      (await response.json()) as {
        daily?: {
          time?: string[];
          temperature_2m_max?: number[];
          temperature_2m_min?: number[];
        };
      };

    const dates =
      json.daily?.time ?? [];

    const highs =
      json.daily
        ?.temperature_2m_max ?? [];

    const lows =
      json.daily
        ?.temperature_2m_min ?? [];

    if (
      !dates.length
    ) {
      console.error(
        "[WEATHER] Daily H/L returned no dates",
      );

      return {
        high: null,
        low: null,
      };
    }

    const index =
      dates.findIndex(
        (date) =>
          date === gameDate,
      );

    if (index < 0) {
      console.error(
        "[WEATHER] Daily H/L date not found:",
        {
          requested:
            gameDate,
          returned:
            dates,
        },
      );

      return {
        high: null,
        low: null,
      };
    }

    const high =
      highs[index];

    const low =
      lows[index];

    console.log(
      "[WEATHER] Daily H/L success:",
      {
        gameDate,
        high,
        low,
      },
    );

    return {
      high:
        high != null
          ? Math.round(
              high,
            )
          : null,

      low:
        low != null
          ? Math.round(
              low,
            )
          : null,
    };
  } catch (error) {
    console.error(
      "[WEATHER] Daily H/L error:",
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
 * OPEN-METEO FORECAST FALLBACK
 * ============================================================
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
 */
function metSymbolToWeather(
  symbol:
    | string
    | undefined,
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
      condition:
        "Thunderstorms",
      emoji: "⛈️",
    };
  }

  if (
    s.includes("snow")
  ) {
    return {
      condition:
        s.includes(
          "shower",
        )
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
        s.includes(
          "shower",
        )
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
    s.includes(
      "overcast",
    )
  ) {
    return {
      condition: "Overcast",
      emoji: "☁️",
    };
  }

  if (
    s.includes(
      "partlycloudy",
    )
  ) {
    return {
      condition:
        "Partly cloudy",
      emoji: "⛅",
    };
  }

  if (
    s.includes(
      "cloudy",
    )
  ) {
    return {
      condition: "Cloudy",
      emoji: "☁️",
    };
  }

  if (
    s.includes(
      "clearsky",
    ) ||
    s.includes("fair")
  ) {
    return {
      condition: "Clear",
      emoji: s.includes(
        "night",
      )
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
    const lat =
      stadium.lat.toFixed(
        4,
      );

    const lon =
      stadium.lon.toFixed(
        4,
      );

    const url =
      "https://api.met.no/weatherapi/locationforecast/2.0/compact" +
      `?lat=${lat}&lon=${lon}`;

    const response =
      await fetch(url, {
        headers: {
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
      json.properties
        ?.timeseries ?? [];

    if (
      !series.length
    ) {
      return null;
    }

    const target =
      new Date(
        gameTime,
      ).getTime();

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

    if (
      !bestEntry
    ) {
      return null;
    }

    const celsius =
      bestEntry.data
        ?.instant
        ?.details
        ?.air_temperature;

    if (
      celsius == null
    ) {
      return null;
    }

    const fahrenheit =
      celsius * 9 / 5 +
      32;

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

    return {
      temperature:
        Math.round(
          fahrenheit,
        ),

      condition:
        weather.condition,

      emoji:
        symbol
          ? weather.emoji
          : dayNightEmoji(
              gameTime,
              stadium.timezone,
            ),

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
 */
async function fetchInternationalDailyHighLow(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<{
  high: number | null;
  low: number | null;
}> {
  return fetchDailyHighLow(
    stadium,
    gameTime,
  );
}

/**
 * ============================================================
 * HISTORICAL FORECAST API
 * ============================================================
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
 * HISTORICAL ARCHIVE
 * ============================================================
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
 */
async function fetchHistoricalWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  const historicalForecast =
    await fetchHistoricalForecastWeather(
      stadium,
      gameTime,
    );

  if (
    historicalForecast
  ) {
    console.log(
      "[WEATHER] Historical Forecast succeeded",
    );

    return historicalForecast;
  }

  console.log(
    "[WEATHER] Historical Forecast failed; trying archive",
  );

  const archive =
    await fetchHistoricalArchiveWeather(
      stadium,
      gameTime,
    );

  if (
    archive
  ) {
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
      await fetch(
        pointsUrl,
        {
          headers,
        },
      );

    if (
      !pointsResponse.ok
    ) {
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

    if (
      !forecastUrl
    ) {
      return null;
    }

    const forecastResponse =
      await fetch(
        forecastUrl,
        {
          headers,
        },
      );

    if (
      !forecastResponse.ok
    ) {
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

    if (
      !periods.length
    ) {
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
      if (
        !period.startTime
      ) {
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

    let emoji =
      "☀️";

    if (
      lower.includes(
        "thunder",
      ) ||
      lower.includes(
        "storm",
      )
    ) {
      emoji =
        "⛈️";
    } else if (
      lower.includes(
        "snow",
      ) ||
      lower.includes(
        "sleet",
      )
    ) {
      emoji =
        "🌨️";
    } else if (
      lower.includes(
        "rain",
      ) ||
      lower.includes(
        "shower",
      )
    ) {
      emoji =
        "🌧️";
    } else if (
      lower.includes(
        "cloud",
      ) ||
      lower.includes(
        "overcast",
      )
    ) {
      emoji =
        "☁️";
    } else if (
      lower.includes(
        "partly",
      ) ||
      lower.includes(
        "mostly",
      )
    ) {
      emoji =
        "🌤️";
    } else if (
      best.isDaytime ===
      false
    ) {
      emoji =
        "🌙";
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
  if (
    stadium.isIndoor
  ) {
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
   * COMPLETED
   * ----------------------------------------------------------
   */
  if (
    isCompleted(status)
  ) {
    const historical =
      await fetchHistoricalWeather(
        stadium,
        gameTime,
      );

    if (
      !historical
    ) {
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
   */
  const isInternational =
    stadium.timezone ===
      "Europe/London" ||
    stadium.timezone ===
      "Europe/Berlin" ||
    stadium.timezone ===
      "America/Sao_Paulo";

  if (
    isInternational
  ) {
    const metWeather =
      await fetchMetNorwayWeather(
        stadium,
        gameTime,
      );

    if (
      metWeather
    ) {
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

    const fallback =
      await fetchOpenMeteoForecast(
        stadium,
        gameTime,
      );

    if (
      fallback
    ) {
      const daily =
        await fetchDailyHighLow(
          stadium,
          gameTime,
        );

      return {
        isIndoor: false,

        temperature:
          fallback.temperature,

        condition:
          fallback.condition,

        emoji:
          fallback.emoji,

        high:
          daily.high,

        low:
          daily.low,
      };
    }

    return null;
  }

  /**
   * ----------------------------------------------------------
   * U.S. UPCOMING / LIVE
   * ----------------------------------------------------------
   */

  /*
   * NWS gives us the actual kickoff temperature
   * and condition.
   */
  const nws =
    await fetchNwsWeather(
      stadium,
      gameTime,
    );

  /*
   * Open-Meteo separately gives us the daily
   * high and low.
   */
  const daily =
    await fetchDailyHighLow(
      stadium,
      gameTime,
    );

  if (
    nws
  ) {
    return {
      isIndoor: false,

      temperature:
        nws.temperature,

      condition:
        nws.condition,

      emoji:
        nws.emoji,

      high:
        daily.high,

      low:
        daily.low,
    };
  }

  /*
   * Full Open-Meteo fallback.
   */
  const fallback =
    await fetchOpenMeteoForecast(
      stadium,
      gameTime,
    );

  if (
    fallback
  ) {
    return {
      isIndoor: false,

      temperature:
        fallback.temperature,

      condition:
        fallback.condition,

      emoji:
        fallback.emoji,

      high:
        daily.high,

      low:
        daily.low,
    };
  }

  return null;
}
