import { getStadiumForGame } from "./stadiums";

export interface GameWeather {
  temperature: number | null;
  condition: string;
  high: number | null;
  low: number | null;
  emoji: string;
  isIndoor: boolean;
}

interface WeatherResult {
  temperature: number | null;
  condition: string;
  high: number | null;
  low: number | null;
  emoji: string;
  isIndoor: boolean;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    is_day?: number;
  };
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

interface MetNorwayTimeseries {
  time: string;
  data: {
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
}

interface MetNorwayResponse {
  properties?: {
    timeseries?: MetNorwayTimeseries[];
  };
}

interface NWSPeriod {
  startTime?: string;
  endTime?: string;
  temperature?: number;
  shortForecast?: string;
  isDaytime?: boolean;
}

interface NWSResponse {
  properties?: {
    periods?: NWSPeriod[];
  };
}

/* ============================================================
   BASIC HELPERS
   ============================================================ */

function isCompleted(status: string): boolean {
  const normalized = status.toLowerCase();

  return (
    normalized === "final" ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "closed" ||
    normalized === "post"
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
      condition: "Weather unavailable",
      emoji: "🌡️",
    };
  }

  switch (code) {
    case 0:
      return { condition: "Clear", emoji: "☀️" };

    case 1:
      return { condition: "Mainly clear", emoji: "🌤️" };

    case 2:
      return { condition: "Partly cloudy", emoji: "⛅" };

    case 3:
      return { condition: "Overcast", emoji: "☁️" };

    case 45:
    case 48:
      return { condition: "Fog", emoji: "🌫️" };

    case 51:
    case 53:
    case 55:
      return { condition: "Drizzle", emoji: "🌦️" };

    case 56:
    case 57:
      return { condition: "Freezing drizzle", emoji: "🌧️" };

    case 61:
    case 63:
    case 65:
      return { condition: "Rain", emoji: "🌧️" };

    case 66:
    case 67:
      return { condition: "Freezing rain", emoji: "🌧️" };

    case 71:
    case 73:
    case 75:
    case 77:
      return { condition: "Snow", emoji: "🌨️" };

    case 80:
    case 81:
    case 82:
      return { condition: "Rain showers", emoji: "🌦️" };

    case 85:
    case 86:
      return { condition: "Snow showers", emoji: "🌨️" };

    case 95:
      return { condition: "Thunderstorm", emoji: "⛈️" };

    case 96:
    case 99:
      return { condition: "Thunderstorm", emoji: "⛈️" };

    default:
      return {
        condition: "Weather unavailable",
        emoji: "🌡️",
      };
  }
}

function getLocalDate(
  isoTime: string,
  timezone: string,
): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    return formatter.format(new Date(isoTime));
  } catch {
    return isoTime.slice(0, 10);
  }
}

function getLocalHour(
  isoTime: string,
  timezone: string,
): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });

    return Number(formatter.format(new Date(isoTime)));
  } catch {
    return new Date(isoTime).getUTCHours();
  }
}

function getDayNightEmoji(
  isoTime: string,
  timezone: string,
  fallbackEmoji: string,
): string {
  const hour = getLocalHour(
    isoTime,
    timezone,
  );

  if (hour >= 7 && hour < 18) {
    if (
      fallbackEmoji === "🌙" ||
      fallbackEmoji === "🌃"
    ) {
      return "☀️";
    }

    return fallbackEmoji;
  }

  if (
    fallbackEmoji === "☀️" ||
    fallbackEmoji === "🌤️" ||
    fallbackEmoji === "⛅"
  ) {
    return "🌙";
  }

  return fallbackEmoji;
}

/* ============================================================
   OPEN-METEO FORECAST
   ============================================================ */

function parseOpenMeteoWeather(
  data: OpenMeteoResponse,
  gameTime: string,
  timezone: string,
): WeatherResult | null {
  if (!data.current) {
    return null;
  }

  const temperature =
    typeof data.current.temperature_2m ===
    "number"
      ? Math.round(
          data.current.temperature_2m,
        )
      : null;

  const code =
    typeof data.current.weather_code ===
    "number"
      ? data.current.weather_code
      : null;

  const mapped =
    weatherCodeToCondition(code);

  return {
    temperature,
    condition: mapped.condition,
    high: null,
    low: null,
    emoji: getDayNightEmoji(
      gameTime,
      timezone,
      mapped.emoji,
    ),
    isIndoor: false,
  };
}

async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  timezone: string,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current:
        "temperature_2m,weather_code,is_day",
      daily:
        "temperature_2m_max,temperature_2m_min",
      temperature_unit: "fahrenheit",
      timezone,
      forecast_days: "2",
      cell_selection: "nearest",
    });

    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error(
        `Open-Meteo forecast failed: ${response.status}`,
      );
      return null;
    }

    const data =
      (await response.json()) as OpenMeteoResponse;

    const result =
      parseOpenMeteoWeather(
        data,
        gameTime,
        timezone,
      );

    if (!result) {
      return null;
    }

    const localDate =
      getLocalDate(
        gameTime,
        timezone,
      );

    const dates =
      data.daily?.time ?? [];

    const highs =
      data.daily?.temperature_2m_max ?? [];

    const lows =
      data.daily?.temperature_2m_min ?? [];

    const index =
      dates.indexOf(localDate);

    if (index >= 0) {
      if (
        typeof highs[index] ===
        "number"
      ) {
        result.high =
          Math.round(highs[index]);
      }

      if (
        typeof lows[index] ===
        "number"
      ) {
        result.low =
          Math.round(lows[index]);
      }
    }

    return result;
  } catch (error) {
    console.error(
      "Open-Meteo forecast error:",
      error,
    );

    return null;
  }
}

/* ============================================================
   MET NORWAY — INTERNATIONAL UPCOMING/LIVE
   ============================================================ */

function metSymbolToWeather(
  symbol: string | undefined,
): {
  condition: string;
  emoji: string;
} {
  if (!symbol) {
    return {
      condition: "Weather unavailable",
      emoji: "🌡️",
    };
  }

  const normalized =
    symbol.toLowerCase();

  if (
    normalized.includes("clearsky") ||
    normalized.includes("fair")
  ) {
    return {
      condition: "Clear",
      emoji: "☀️",
    };
  }

  if (
    normalized.includes("partlycloudy")
  ) {
    return {
      condition: "Partly cloudy",
      emoji: "⛅",
    };
  }

  if (
    normalized.includes("cloudy") ||
    normalized.includes("overcast")
  ) {
    return {
      condition: "Cloudy",
      emoji: "☁️",
    };
  }

  if (
    normalized.includes("fog")
  ) {
    return {
      condition: "Fog",
      emoji: "🌫️",
    };
  }

  if (
    normalized.includes("rain") ||
    normalized.includes("drizzle")
  ) {
    return {
      condition: "Rain",
      emoji: "🌧️",
    };
  }

  if (
    normalized.includes("snow")
  ) {
    return {
      condition: "Snow",
      emoji: "🌨️",
    };
  }

  if (
    normalized.includes("thunder")
  ) {
    return {
      condition: "Thunderstorm",
      emoji: "⛈️",
    };
  }

  return {
    condition: "Weather unavailable",
    emoji: "🌡️",
  };
}

function celsiusToFahrenheit(
  value: number,
): number {
  return Math.round(
    (value * 9) / 5 + 32,
  );
}

function findMetEntry(
  timeseries: MetNorwayTimeseries[],
  gameTime: string,
): MetNorwayTimeseries | null {
  if (!timeseries.length) {
    return null;
  }

  const target =
    new Date(gameTime).getTime();

  let closest:
    | MetNorwayTimeseries
    | null = null;

  let closestDifference =
    Infinity;

  for (const entry of timeseries) {
    const timestamp =
      new Date(entry.time).getTime();

    if (Number.isNaN(timestamp)) {
      continue;
    }

    const difference =
      Math.abs(
        timestamp - target,
      );

    if (
      difference <
      closestDifference
    ) {
      closestDifference =
        difference;

      closest = entry;
    }
  }

  return closest;
}

/*
 * IMPORTANT:
 *
 * This function is intentionally independent.
 *
 * If Open-Meteo H/L fails, it returns { null, null }
 * and DOES NOT affect the MET Norway temperature.
 */
async function fetchInternationalDailyHighLow(
  lat: number,
  lon: number,
  timezone: string,
  date: string,
): Promise<{
  high: number | null;
  low: number | null;
}> {
  try {
    const params =
      new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        start_date: date,
        end_date: date,
        daily:
          "temperature_2m_max,temperature_2m_min",
        temperature_unit: "fahrenheit",
        timezone,
        cell_selection: "nearest",
      });

    const url =
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

    const response =
      await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

    if (!response.ok) {
      console.error(
        `International H/L request failed: ${response.status}`,
      );

      return {
        high: null,
        low: null,
      };
    }

    const data =
      (await response.json()) as OpenMeteoResponse;

    const dates =
      data.daily?.time ?? [];

    const highs =
      data.daily
        ?.temperature_2m_max ?? [];

    const lows =
      data.daily
        ?.temperature_2m_min ?? [];

    const index =
      dates.indexOf(date);

    if (index < 0) {
      console.error(
        `International H/L date not found: ${date}`,
      );

      return {
        high: null,
        low: null,
      };
    }

    return {
      high:
        typeof highs[index] ===
        "number"
          ? Math.round(
              highs[index],
            )
          : null,

      low:
        typeof lows[index] ===
        "number"
          ? Math.round(
              lows[index],
            )
          : null,
    };
  } catch (error) {
    console.error(
      "International H/L request error:",
      error,
    );

    return {
      high: null,
      low: null,
    };
  }
}

async function fetchMetNorwayWeather(
  lat: number,
  lon: number,
  timezone: string,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const url =
      `https://api.met.no/weatherapi/locationforecast/2.0/complete` +
      `?lat=${encodeURIComponent(
        String(lat),
      )}` +
      `&lon=${encodeURIComponent(
        String(lon),
      )}`;

    const response =
      await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "GamblingNFL/1.0 https://gamblingnfl.lovable.app/",
        },
      });

    if (!response.ok) {
      console.error(
        `MET Norway failed: ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as MetNorwayResponse;

    const timeseries =
      data.properties?.timeseries ??
      [];

    const entry =
      findMetEntry(
        timeseries,
        gameTime,
      );

    if (!entry) {
      return null;
    }

    const temperatureC =
      entry.data.instant
        ?.details
        ?.air_temperature;

    const symbol =
      entry.data
        .next_1_hours
        ?.summary
        ?.symbol_code ??
      entry.data
        .next_6_hours
        ?.summary
        ?.symbol_code;

    const mapped =
      metSymbolToWeather(symbol);

    /*
     * FIRST build the working MET Norway result.
     *
     * This means Germany/London temperature and condition
     * are preserved even if the H/L request fails.
     */
    const result: WeatherResult = {
      temperature:
        typeof temperatureC ===
        "number"
          ? celsiusToFahrenheit(
              temperatureC,
            )
          : null,

      condition:
        mapped.condition,

      high: null,
      low: null,

      emoji:
        getDayNightEmoji(
          gameTime,
          timezone,
          mapped.emoji,
        ),

      isIndoor: false,
    };

    /*
     * SECOND, independently attempt H/L.
     *
     * Failure here is harmless.
     */
    const localDate =
      getLocalDate(
        gameTime,
        timezone,
      );

    try {
      const daily =
        await fetchInternationalDailyHighLow(
          lat,
          lon,
          timezone,
          localDate,
        );

      /*
       * Only overwrite H/L if the values actually
       * came back successfully.
       */
      if (
        daily.high !== null
      ) {
        result.high =
          daily.high;
      }

      if (
        daily.low !== null
      ) {
        result.low =
          daily.low;
      }
    } catch (error) {
      console.error(
        "International H/L failed without affecting kickoff weather:",
        error,
      );
    }

    /*
     * CRITICAL:
     *
     * Return the MET Norway result regardless of whether
     * the separate H/L request succeeded.
     */
    return result;
  } catch (error) {
    console.error(
      "MET Norway weather error:",
      error,
    );

    return null;
  }
}

/* ============================================================
   HISTORICAL WEATHER
   ============================================================ */

async function fetchHistoricalForecastWeather(
  lat: number,
  lon: number,
  timezone: string,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const localDate =
      getLocalDate(
        gameTime,
        timezone,
      );

    const params =
      new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        start_date: localDate,
        end_date: localDate,
        hourly:
          "temperature_2m,weather_code",
        daily:
          "temperature_2m_max,temperature_2m_min",
        temperature_unit: "fahrenheit",
        timezone,
        cell_selection: "nearest",
      });

    const response =
      await fetch(
        `https://historical-forecast-api.open-meteo.com/v1/forecast?${params.toString()}`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

    if (!response.ok) {
      console.error(
        `Historical Forecast API failed: ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as OpenMeteoResponse;

    const times =
      data.hourly?.time ?? [];

    const temperatures =
      data.hourly
        ?.temperature_2m ?? [];

    const codes =
      data.hourly?.weather_code ?? [];

    if (!times.length) {
      return null;
    }

    const target =
      new Date(gameTime).getTime();

    let closestIndex = -1;
    let closestDifference =
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
        Number.isNaN(timestamp)
      ) {
        continue;
      }

      const difference =
        Math.abs(
          timestamp - target,
        );

      if (
        difference <
        closestDifference
      ) {
        closestDifference =
          difference;

        closestIndex = i;
      }
    }

    if (closestIndex < 0) {
      return null;
    }

    const temperature =
      temperatures[closestIndex];

    const code =
      codes[closestIndex];

    const mapped =
      weatherCodeToCondition(code);

    return {
      temperature:
        typeof temperature ===
        "number"
          ? Math.round(
              temperature,
            )
          : null,

      condition:
        mapped.condition,

      high:
        typeof data.daily
          ?.temperature_2m_max?.[0] ===
        "number"
          ? Math.round(
              data.daily
                .temperature_2m_max[0],
            )
          : null,

      low:
        typeof data.daily
          ?.temperature_2m_min?.[0] ===
        "number"
          ? Math.round(
              data.daily
                .temperature_2m_min[0],
            )
          : null,

      emoji:
        mapped.emoji,

      isIndoor: false,
    };
  } catch (error) {
    console.error(
      "Historical Forecast API error:",
      error,
    );

    return null;
  }
}

async function fetchHistoricalArchiveWeather(
  lat: number,
  lon: number,
  timezone: string,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const localDate =
      getLocalDate(
        gameTime,
        timezone,
      );

    const params =
      new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        start_date: localDate,
        end_date: localDate,
        hourly:
          "temperature_2m,weather_code",
        daily:
          "temperature_2m_max,temperature_2m_min",
        temperature_unit: "fahrenheit",
        timezone,
        cell_selection: "nearest",
      });

    const response =
      await fetch(
        `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

    if (!response.ok) {
      console.error(
        `Historical Archive API failed: ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as OpenMeteoResponse;

    const times =
      data.hourly?.time ?? [];

    const temperatures =
      data.hourly
        ?.temperature_2m ?? [];

    const codes =
      data.hourly?.weather_code ?? [];

    if (!times.length) {
      return null;
    }

    const target =
      new Date(gameTime).getTime();

    let closestIndex = -1;
    let closestDifference =
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
        Number.isNaN(timestamp)
      ) {
        continue;
      }

      const difference =
        Math.abs(
          timestamp - target,
        );

      if (
        difference <
        closestDifference
      ) {
        closestDifference =
          difference;

        closestIndex = i;
      }
    }

    if (closestIndex < 0) {
      return null;
    }

    const temperature =
      temperatures[closestIndex];

    const code =
      codes[closestIndex];

    const mapped =
      weatherCodeToCondition(code);

    return {
      temperature:
        typeof temperature ===
        "number"
          ? Math.round(
              temperature,
            )
          : null,

      condition:
        mapped.condition,

      high:
        typeof data.daily
          ?.temperature_2m_max?.[0] ===
        "number"
          ? Math.round(
              data.daily
                .temperature_2m_max[0],
            )
          : null,

      low:
        typeof data.daily
          ?.temperature_2m_min?.[0] ===
        "number"
          ? Math.round(
              data.daily
                .temperature_2m_min[0],
            )
          : null,

      emoji:
        mapped.emoji,

      isIndoor: false,
    };
  } catch (error) {
    console.error(
      "Historical Archive API error:",
      error,
    );

    return null;
  }
}

async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  timezone: string,
  gameTime: string,
): Promise<WeatherResult | null> {
  const historicalForecast =
    await fetchHistoricalForecastWeather(
      lat,
      lon,
      timezone,
      gameTime,
    );

  if (historicalForecast) {
    return historicalForecast;
  }

  return fetchHistoricalArchiveWeather(
    lat,
    lon,
    timezone,
    gameTime,
  );
}

/* ============================================================
   NWS — U.S. UPCOMING/LIVE
   ============================================================ */

async function fetchNwsWeather(
  lat: number,
  lon: number,
  timezone: string,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const pointsResponse =
      await fetch(
        `https://api.weather.gov/points/${lat},${lon}`,
        {
          headers: {
            Accept: "application/geo+json",
            "User-Agent":
              "GamblingNFL/1.0 https://gamblingnfl.lovable.app/",
          },
        },
      );

    if (!pointsResponse.ok) {
      console.error(
        `NWS points failed: ${pointsResponse.status}`,
      );

      return null;
    }

    const points =
      await pointsResponse.json();

    const hourlyUrl =
      points?.properties
        ?.forecastHourly;

    if (!hourlyUrl) {
      return null;
    }

    const forecastResponse =
      await fetch(hourlyUrl, {
        headers: {
          Accept: "application/geo+json",
          "User-Agent":
            "GamblingNFL/1.0 https://gamblingnfl.lovable.app/",
        },
      });

    if (!forecastResponse.ok) {
      console.error(
        `NWS forecast failed: ${forecastResponse.status}`,
      );

      return null;
    }

    const forecast =
      (await forecastResponse.json()) as NWSResponse;

    const periods =
      forecast.properties
        ?.periods ?? [];

    if (!periods.length) {
      return null;
    }

    const target =
      new Date(gameTime).getTime();

    let closest:
      | NWSPeriod
      | null = null;

    let closestDifference =
      Infinity;

    for (const period of periods) {
      if (!period.startTime) {
        continue;
      }

      const timestamp =
        new Date(
          period.startTime,
        ).getTime();

      if (
        Number.isNaN(timestamp)
      ) {
        continue;
      }

      const difference =
        Math.abs(
          timestamp - target,
        );

      if (
        difference <
        closestDifference
      ) {
        closestDifference =
          difference;

        closest = period;
      }
    }

    if (!closest) {
      return null;
    }

    const localDate =
      getLocalDate(
        gameTime,
        timezone,
      );

    const sameDay =
      periods.filter(
        (period) => {
          if (!period.startTime) {
            return false;
          }

          return (
            getLocalDate(
              period.startTime,
              timezone,
            ) === localDate
          );
        },
      );

    const temperatures =
      sameDay
        .map(
          (period) =>
            period.temperature,
        )
        .filter(
          (
            value,
          ): value is number =>
            typeof value ===
            "number",
        );

    const high =
      temperatures.length
        ? Math.round(
            Math.max(
              ...temperatures,
            ),
          )
        : null;

    const low =
      temperatures.length
        ? Math.round(
            Math.min(
              ...temperatures,
            ),
          )
        : null;

    const temperature =
      typeof closest.temperature ===
      "number"
        ? Math.round(
            closest.temperature,
          )
        : null;

    const condition =
      closest.shortForecast ??
      "Weather unavailable";

    const lower =
      condition.toLowerCase();

    let emoji = "🌡️";

    if (
      lower.includes("thunder")
    ) {
      emoji = "⛈️";
    } else if (
      lower.includes("snow") ||
      lower.includes("blizzard")
    ) {
      emoji = "🌨️";
    } else if (
      lower.includes("rain") ||
      lower.includes("shower") ||
      lower.includes("drizzle")
    ) {
      emoji = "🌧️";
    } else if (
      lower.includes("fog") ||
      lower.includes("haze")
    ) {
      emoji = "🌫️";
    } else if (
      lower.includes("partly")
    ) {
      emoji = "⛅";
    } else if (
      lower.includes("cloud")
    ) {
      emoji = "☁️";
    } else if (
      lower.includes("mostly clear") ||
      lower.includes("mostly sunny")
    ) {
      emoji = "🌤️";
    } else if (
      lower.includes("sunny") ||
      lower.includes("clear")
    ) {
      emoji = "☀️";
    }

    return {
      temperature,
      condition,
      high,
      low,
      emoji:
        getDayNightEmoji(
          gameTime,
          timezone,
          emoji,
        ),
      isIndoor: false,
    };
  } catch (error) {
    console.error(
      "NWS weather error:",
      error,
    );

    return null;
  }
}

/* ============================================================
   MAIN
   ============================================================ */

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
  try {
    const stadium =
      getStadiumForGame(
        homeTeamId,
        venue,
      );

    /*
     * Indoor games are always static.
     */
    if (stadium.isIndoor) {
      return {
        temperature: 72,
        condition: "Indoor",
        high: null,
        low: null,
        emoji: "🏟️",
        isIndoor: true,
      };
    }

    /*
     * COMPLETED
     *
     * Completely separate from upcoming/live providers.
     */
    if (isCompleted(status)) {
      return fetchHistoricalWeather(
        stadium.lat,
        stadium.lon,
        stadium.timezone,
        gameTime,
      );
    }

    /*
     * INTERNATIONAL UPCOMING/LIVE
     *
     * London / Germany / São Paulo use MET Norway.
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
          stadium.lat,
          stadium.lon,
          stadium.timezone,
          gameTime,
        );

      if (metWeather) {
        return metWeather;
      }

      /*
       * Only if MET Norway itself fails do we fall back
       * to Open-Meteo for the entire international result.
       */
      return fetchOpenMeteoForecast(
        stadium.lat,
        stadium.lon,
        stadium.timezone,
        gameTime,
      );
    }

    /*
     * U.S. UPCOMING/LIVE
     *
     * NWS first.
     */
    const nws =
      await fetchNwsWeather(
        stadium.lat,
        stadium.lon,
        stadium.timezone,
        gameTime,
      );

    if (nws) {
      return nws;
    }

    /*
     * Open-Meteo fallback.
     */
    return fetchOpenMeteoForecast(
      stadium.lat,
      stadium.lon,
      stadium.timezone,
      gameTime,
    );
  } catch (error) {
    console.error(
      `Weather failed for game ${gameId}:`,
      error,
    );

    return null;
  }
}
