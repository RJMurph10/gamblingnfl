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

interface NWSPeriod {
  startTime?: string;
  temperature?: number;
  shortForecast?: string;
  isDaytime?: boolean;
}

interface MetNorwayTimeseries {
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
      details?: {
        air_temperature_max?: number;
        air_temperature_min?: number;
      };
    };
    next_6_hours?: {
      summary?: {
        symbol_code?: string;
      };
      details?: {
        air_temperature_max?: number;
        air_temperature_min?: number;
      };
    };
    next_12_hours?: {
      summary?: {
        symbol_code?: string;
      };
      details?: {
        air_temperature_max?: number;
        air_temperature_min?: number;
      };
    };
  };
}

interface MetNorwayResponse {
  properties?: {
    timeseries?: MetNorwayTimeseries[];
  };
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
  ).format(
    new Date(iso),
  );
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

  const hour =
    Number(
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
 * OPEN-METEO HOURLY
 * ============================================================
 */
function parseOpenMeteoWeather(
  json: OpenMeteoResponse,
  stadium: StadiumInfo,
  gameTime: string,
): WeatherResult | null {
  const times =
    json.hourly?.time ?? [];

  const temperatures =
    json.hourly
      ?.temperature_2m ?? [];

  const codes =
    json.hourly
      ?.weather_code ?? [];

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

  const temperature =
    temperatures[index];

  if (
    temperature == null
  ) {
    return null;
  }

  const weather =
    weatherCodeToCondition(
      codes[index],
    );

  return {
    temperature:
      Math.round(
        temperature,
      ),
    condition:
      weather.condition,
    emoji:
      codes[index] == null
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
 * OPEN-METEO FORECAST
 * ============================================================
 *
 * Used only as a fallback and for historical weather.
 */
async function fetchOpenMeteoForecast(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const date =
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
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(
        stadium.timezone,
      )}` +
      `&start_date=${date}` +
      `&end_date=${date}`;

    const response =
      await fetch(url);

    if (!response.ok) {
      console.error(
        "[WEATHER] Open-Meteo:",
        response.status,
      );

      return null;
    }

    const json =
      (await response.json()) as OpenMeteoResponse;

    const weather =
      parseOpenMeteoWeather(
        json,
        stadium,
        gameTime,
      );

    if (!weather) {
      return null;
    }

    const high =
      json.daily
        ?.temperature_2m_max?.[0];

    const low =
      json.daily
        ?.temperature_2m_min?.[0];

    return {
      ...weather,
      high:
        high != null
          ? Math.round(high)
          : null,
      low:
        low != null
          ? Math.round(low)
          : null,
    };
  } catch (error) {
    console.error(
      "[WEATHER] Open-Meteo error:",
      error,
    );

    return null;
  }
}

/**
 * ============================================================
 * MET NORWAY
 * ============================================================
 *
 * MET Norway covers worldwide locations.
 *
 * Temperature is Celsius.
 * Timestamps are UTC.
 *
 * We calculate the daily high/low directly from the
 * forecast timeseries instead of making another API call.
 */
function metSymbolToWeather(
  symbol?: string,
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
      condition:
        "Partly cloudy",
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
      condition: "Clear",
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

function celsiusToFahrenheit(
  celsius: number,
): number {
  return (
    celsius * 9 / 5 +
    32
  );
}

/**
 * Find the MET Norway forecast entry closest to kickoff.
 */
function findMetEntry(
  series: MetNorwayTimeseries[],
  gameTime: string,
): MetNorwayTimeseries | null {
  const target =
    new Date(
      gameTime,
    ).getTime();

  let best:
    | MetNorwayTimeseries
    | null = null;

  let differenceBest =
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
      differenceBest
    ) {
      differenceBest =
        difference;

      best = entry;
    }
  }

  return best;
}

/**
 * Calculate forecast high/low from the MET Norway
 * timeseries for the stadium's local calendar day.
 *
 * We use the instant air temperature values because
 * they are available throughout the forecast.
 */
function calculateMetDailyHighLow(
  series: MetNorwayTimeseries[],
  stadium: StadiumInfo,
  gameTime: string,
): {
  high: number | null;
  low: number | null;
} {
  const gameDate =
    localDateString(
      gameTime,
      stadium.timezone,
    );

  const temperatures: number[] =
    [];

  for (
    const entry of series
  ) {
    if (!entry.time) {
      continue;
    }

    const localDate =
      localDateString(
        entry.time,
        stadium.timezone,
      );

    if (
      localDate !== gameDate
    ) {
      continue;
    }

    const temp =
      entry.data
        ?.instant
        ?.details
        ?.air_temperature;

    if (
      temp != null &&
      Number.isFinite(temp)
    ) {
      temperatures.push(
        celsiusToFahrenheit(
          temp,
        ),
      );
    }
  }

  if (
    !temperatures.length
  ) {
    return {
      high: null,
      low: null,
    };
  }

  return {
    high: Math.round(
      Math.max(
        ...temperatures,
      ),
    ),
    low: Math.round(
      Math.min(
        ...temperatures,
      ),
    ),
  };
}

async function fetchMetNorwayWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const url =
      "https://api.met.no/weatherapi/locationforecast/2.0/compact" +
      `?lat=${stadium.lat.toFixed(4)}` +
      `&lon=${stadium.lon.toFixed(4)}`;

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

    if (!series.length) {
      return null;
    }

    const best =
      findMetEntry(
        series,
        gameTime,
      );

    if (!best) {
      return null;
    }

    const celsius =
      best.data
        ?.instant
        ?.details
        ?.air_temperature;

    if (
      celsius == null
    ) {
      return null;
    }

    const symbol =
      best.data
        ?.next_1_hours
        ?.summary
        ?.symbol_code ??
      best.data
        ?.next_6_hours
        ?.summary
        ?.symbol_code ??
      best.data
        ?.next_12_hours
        ?.summary
        ?.symbol_code;

    const weather =
      metSymbolToWeather(
        symbol,
      );

    const daily =
      calculateMetDailyHighLow(
        series,
        stadium,
        gameTime,
      );

    return {
      temperature:
        Math.round(
          celsiusToFahrenheit(
            celsius,
          ),
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

      high:
        daily.high,

      low:
        daily.low,
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
 * HISTORICAL FORECAST
 * ============================================================
 */
async function fetchHistoricalForecastWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const date =
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
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(
        stadium.timezone,
      )}` +
      `&start_date=${date}` +
      `&end_date=${date}`;

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

    const weather =
      parseOpenMeteoWeather(
        json,
        stadium,
        gameTime,
      );

    if (!weather) {
      return null;
    }

    return {
      ...weather,
      high:
        json.daily
          ?.temperature_2m_max?.[0] != null
          ? Math.round(
              json.daily
                .temperature_2m_max[0],
            )
          : null,
      low:
        json.daily
          ?.temperature_2m_min?.[0] != null
          ? Math.round(
              json.daily
                .temperature_2m_min[0],
            )
          : null,
    };
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
    const date =
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
      `&start_date=${date}` +
      `&end_date=${date}` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=fahrenheit` +
      `&timezone=${encodeURIComponent(
        stadium.timezone,
      )}` +
      `&cell_selection=nearest`;

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

    const weather =
      parseOpenMeteoWeather(
        json,
        stadium,
        gameTime,
      );

    if (!weather) {
      return null;
    }

    return {
      ...weather,
      high:
        json.daily
          ?.temperature_2m_max?.[0] != null
          ? Math.round(
              json.daily
                .temperature_2m_max[0],
            )
          : null,
      low:
        json.daily
          ?.temperature_2m_min?.[0] != null
          ? Math.round(
              json.daily
                .temperature_2m_min[0],
            )
          : null,
    };
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
 * COMPLETED WEATHER
 * ============================================================
 */
async function fetchHistoricalWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  const historical =
    await fetchHistoricalForecastWeather(
      stadium,
      gameTime,
    );

  if (historical) {
    return historical;
  }

  console.log(
    "[WEATHER] Historical Forecast failed; trying archive",
  );

  return fetchHistoricalArchiveWeather(
    stadium,
    gameTime,
  );
}

/**
 * ============================================================
 * NWS
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
      Accept:
        "application/geo+json",
    };

    const pointsUrl =
      `https://api.weather.gov/points/${stadium.lat},${stadium.lon}`;

    const pointsResponse =
      await fetch(
        pointsUrl,
        { headers },
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
        { headers },
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
          periods?: NWSPeriod[];
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

    let best:
      | NWSPeriod
      | null = null;

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
      !best ||
      best.temperature == null
    ) {
      return null;
    }

    /*
     * Calculate the day's high/low directly from the
     * NWS hourly periods.
     *
     * This avoids the separate Open-Meteo H/L request.
     */
    const gameDate =
      localDateString(
        gameTime,
        stadium.timezone,
      );

    const dayTemperatures =
      periods
        .filter(
          (period) => {
            if (
              !period.startTime ||
              period.temperature ==
                null
            ) {
              return false;
            }

            return (
              localDateString(
                period.startTime,
                stadium.timezone,
              ) ===
              gameDate
            );
          },
        )
        .map(
          (period) =>
            period.temperature!,
        );

    const high =
      dayTemperatures.length
        ? Math.round(
            Math.max(
              ...dayTemperatures,
            ),
          )
        : null;

    const low =
      dayTemperatures.length
        ? Math.round(
            Math.min(
              ...dayTemperatures,
            ),
          )
        : null;

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
      high,
      low,
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
 * MAIN
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

    if (!historical) {
      console.error(
        "[WEATHER] Historical unavailable:",
        gameId,
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
    const met =
      await fetchMetNorwayWeather(
        stadium,
        gameTime,
      );

    if (met) {
      return {
        isIndoor: false,
        ...met,
      };
    }

    /*
     * Fallback only if MET Norway fails.
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
   */
  const nws =
    await fetchNwsWeather(
      stadium,
      gameTime,
    );

  if (nws) {
    return {
      isIndoor: false,
      ...nws,
    };
  }

  /*
   * Open-Meteo fallback.
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
