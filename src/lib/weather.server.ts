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

function weatherCodeToCondition(code: number | null | undefined): {
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
  const hour = getLocalHour(isoTime, timezone);

  /*
   * NFL games are generally played between late morning
   * and late evening. Use the stadium's local clock rather
   * than the user's/server's timezone.
   */
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

function parseOpenMeteoWeather(
  data: OpenMeteoResponse,
  gameTime: string,
  timezone: string,
): WeatherResult | null {
  const current = data.current;

  if (!current) {
    return null;
  }

  const temperature =
    typeof current.temperature_2m === "number"
      ? Math.round(current.temperature_2m)
      : null;

  const code =
    typeof current.weather_code === "number"
      ? current.weather_code
      : null;

  const mapped = weatherCodeToCondition(code);

  const emoji = getDayNightEmoji(
    gameTime,
    timezone,
    mapped.emoji,
  );

  return {
    temperature,
    condition: mapped.condition,
    high: null,
    low: null,
    emoji,
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
      hourly:
        "temperature_2m,weather_code",
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

    const result = parseOpenMeteoWeather(
      data,
      gameTime,
      timezone,
    );

    if (!result) {
      return null;
    }

    const localDate = getLocalDate(
      gameTime,
      timezone,
    );

    if (
      data.daily?.time &&
      data.daily.temperature_2m_max &&
      data.daily.temperature_2m_min
    ) {
      const index =
        data.daily.time.indexOf(localDate);

      if (index >= 0) {
        const high =
          data.daily.temperature_2m_max[index];

        const low =
          data.daily.temperature_2m_min[index];

        if (typeof high === "number") {
          result.high = Math.round(high);
        }

        if (typeof low === "number") {
          result.low = Math.round(low);
        }
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

/*
 * ============================================================
 * MET NORWAY
 * ============================================================
 *
 * Used for international upcoming/live games.
 *
 * MET Norway supplies the kickoff temperature/condition.
 * Daily H/L is deliberately obtained separately from
 * Open-Meteo so that the international H/L calculation
 * cannot interfere with the working kickoff weather.
 */

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

  const normalized = symbol.toLowerCase();

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
    normalized.includes("fog") ||
    normalized.includes("lightrainshowersandthunder")
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

  const target = new Date(gameTime).getTime();

  let closest: MetNorwayTimeseries | null = null;
  let closestDifference = Infinity;

  for (const entry of timeseries) {
    const time = new Date(entry.time).getTime();

    if (Number.isNaN(time)) {
      continue;
    }

    const difference = Math.abs(
      time - target,
    );

    if (difference < closestDifference) {
      closestDifference = difference;
      closest = entry;
    }
  }

  return closest;
}

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
    const params = new URLSearchParams({
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
        `Open-Meteo international H/L failed: ${response.status}`,
      );

      return {
        high: null,
        low: null,
      };
    }

    const data =
      (await response.json()) as OpenMeteoResponse;

    const high =
      data.daily?.temperature_2m_max?.[0];

    const low =
      data.daily?.temperature_2m_min?.[0];

    return {
      high:
        typeof high === "number"
          ? Math.round(high)
          : null,

      low:
        typeof low === "number"
          ? Math.round(low)
          : null,
    };
  } catch (error) {
    console.error(
      "Open-Meteo international H/L error:",
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
      `?lat=${encodeURIComponent(String(lat))}` +
      `&lon=${encodeURIComponent(String(lon))}`;

    const response = await fetch(url, {
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
      data.properties?.timeseries ?? [];

    const entry = findMetEntry(
      timeseries,
      gameTime,
    );

    if (!entry) {
      console.error(
        "MET Norway returned no matching timeseries entry",
      );

      return null;
    }

    const temperatureC =
      entry.data.instant?.details
        ?.air_temperature;

    const symbol =
      entry.data.next_1_hours?.summary
        ?.symbol_code ??
      entry.data.next_6_hours?.summary
        ?.symbol_code;

    const mapped =
      metSymbolToWeather(symbol);

    const localDate = getLocalDate(
      gameTime,
      timezone,
    );

    /*
     * IMPORTANT:
     * MET Norway handles the international kickoff
     * temperature/condition.
     *
     * Open-Meteo handles the daily H/L independently.
     */
    const dailyHighLow =
      await fetchInternationalDailyHighLow(
        lat,
        lon,
        timezone,
        localDate,
      );

    const emoji = getDayNightEmoji(
      gameTime,
      timezone,
      mapped.emoji,
    );

    return {
      temperature:
        typeof temperatureC === "number"
          ? celsiusToFahrenheit(temperatureC)
          : null,

      condition: mapped.condition,

      high: dailyHighLow.high,

      low: dailyHighLow.low,

      emoji,

      isIndoor: false,
    };
  } catch (error) {
    console.error(
      "MET Norway weather error:",
      error,
    );

    return null;
  }
}

/*
 * ============================================================
 * HISTORICAL WEATHER
 * ============================================================
 *
 * Completed games use their own historical path.
 * This is intentionally isolated from the working
 * upcoming/live weather providers.
 */

async function fetchHistoricalForecastWeather(
  lat: number,
  lon: number,
  timezone: string,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const localDate = getLocalDate(
      gameTime,
      timezone,
    );

    const params = new URLSearchParams({
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

    const response = await fetch(
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
      data.hourly?.temperature_2m ?? [];

    const codes =
      data.hourly?.weather_code ?? [];

    if (!times.length) {
      return null;
    }

    const target =
      new Date(gameTime).getTime();

    let closestIndex = -1;
    let closestDifference = Infinity;

    for (
      let i = 0;
      i < times.length;
      i++
    ) {
      const timestamp =
        new Date(times[i]).getTime();

      if (Number.isNaN(timestamp)) {
        continue;
      }

      const difference = Math.abs(
        timestamp - target,
      );

      if (difference < closestDifference) {
        closestDifference = difference;
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

    let high: number | null = null;
    let low: number | null = null;

    if (
      data.daily?.temperature_2m_max?.[0] !=
      null
    ) {
      high = Math.round(
        data.daily.temperature_2m_max[0],
      );
    }

    if (
      data.daily?.temperature_2m_min?.[0] !=
      null
    ) {
      low = Math.round(
        data.daily.temperature_2m_min[0],
      );
    }

    return {
      temperature:
        typeof temperature === "number"
          ? Math.round(temperature)
          : null,

      condition: mapped.condition,

      high,

      low,

      emoji: mapped.emoji,

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
    const localDate = getLocalDate(
      gameTime,
      timezone,
    );

    const params = new URLSearchParams({
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

    const response = await fetch(
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
      data.hourly?.temperature_2m ?? [];

    const codes =
      data.hourly?.weather_code ?? [];

    if (!times.length) {
      return null;
    }

    const target =
      new Date(gameTime).getTime();

    let closestIndex = -1;
    let closestDifference = Infinity;

    for (
      let i = 0;
      i < times.length;
      i++
    ) {
      const timestamp =
        new Date(times[i]).getTime();

      if (Number.isNaN(timestamp)) {
        continue;
      }

      const difference = Math.abs(
        timestamp - target,
      );

      if (difference < closestDifference) {
        closestDifference = difference;
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
        typeof temperature === "number"
          ? Math.round(temperature)
          : null,

      condition: mapped.condition,

      high:
        typeof data.daily
          ?.temperature_2m_max?.[0] ===
        "number"
          ? Math.round(
              data.daily.temperature_2m_max[0],
            )
          : null,

      low:
        typeof data.daily
          ?.temperature_2m_min?.[0] ===
        "number"
          ? Math.round(
              data.daily.temperature_2m_min[0],
            )
          : null,

      emoji: mapped.emoji,

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
  /*
   * First try the historical forecast dataset.
   * This is intended for recent completed games.
   */
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

  /*
   * Fallback to Open-Meteo's historical archive.
   */
  const archive =
    await fetchHistoricalArchiveWeather(
      lat,
      lon,
      timezone,
      gameTime,
    );

  if (archive) {
    return archive;
  }

  return null;
}

/*
 * ============================================================
 * NWS
 * ============================================================
 *
 * Used for U.S. upcoming/live outdoor games.
 */

async function fetchNwsWeather(
  lat: number,
  lon: number,
  timezone: string,
  gameTime: string,
): Promise<WeatherResult | null> {
  try {
    const pointsResponse = await fetch(
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
      points?.properties?.forecastHourly;

    if (!hourlyUrl) {
      console.error(
        "NWS hourly forecast URL missing",
      );

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
      forecast.properties?.periods ?? [];

    if (!periods.length) {
      return null;
    }

    const target =
      new Date(gameTime).getTime();

    let closestPeriod:
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

      if (Number.isNaN(timestamp)) {
        continue;
      }

      const difference = Math.abs(
        timestamp - target,
      );

      if (difference < closestDifference) {
        closestDifference = difference;
        closestPeriod = period;
      }
    }

    if (!closestPeriod) {
      return null;
    }

    const localDate = getLocalDate(
      gameTime,
      timezone,
    );

    const sameDayPeriods =
      periods.filter((period) => {
        if (!period.startTime) {
          return false;
        }

        return (
          getLocalDate(
            period.startTime,
            timezone,
          ) === localDate
        );
      });

    const temperatures =
      sameDayPeriods
        .map((period) => period.temperature)
        .filter(
          (value): value is number =>
            typeof value === "number",
        );

    const high =
      temperatures.length > 0
        ? Math.round(
            Math.max(...temperatures),
          )
        : null;

    const low =
      temperatures.length > 0
        ? Math.round(
            Math.min(...temperatures),
          )
        : null;

    const temperature =
      typeof closestPeriod.temperature ===
      "number"
        ? Math.round(
            closestPeriod.temperature,
          )
        : null;

    const condition =
      closestPeriod.shortForecast ??
      "Weather unavailable";

    let emoji = "🌡️";

    const lower =
      condition.toLowerCase();

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
      lower.includes("cloud")
    ) {
      emoji = "☁️";
    } else if (
      lower.includes("partly")
    ) {
      emoji = "⛅";
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

    emoji = getDayNightEmoji(
      gameTime,
      timezone,
      emoji,
    );

    return {
      temperature,
      condition,
      high,
      low,
      emoji,
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

/*
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
  try {
    const stadium =
      getStadiumForGame(
        homeTeamId,
        venue,
      );

    /*
     * Indoor / climate-controlled stadiums
     * never call an outdoor weather API.
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

    const completed =
      isCompleted(status);

    /*
     * ========================================================
     * COMPLETED GAME
     * ========================================================
     *
     * Historical weather gets its own completely separate
     * path so it cannot break upcoming/live weather.
     */
    if (completed) {
      const historical =
        await fetchHistoricalWeather(
          stadium.lat,
          stadium.lon,
          stadium.timezone,
          gameTime,
        );

      return historical;
    }

    /*
     * ========================================================
     * INTERNATIONAL UPCOMING / LIVE
     * ========================================================
     *
     * International venues are detected by the stadium object,
     * not by the user's timezone or server timezone.
     */
    const internationalVenue =
      stadium.timezone === "Europe/London" ||
      stadium.timezone === "Europe/Berlin" ||
      stadium.timezone === "America/Sao_Paulo";

    if (internationalVenue) {
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
       * Open-Meteo remains a fallback for international
       * upcoming/live games if MET Norway is temporarily
       * unavailable.
       */
      const openMeteo =
        await fetchOpenMeteoForecast(
          stadium.lat,
          stadium.lon,
          stadium.timezone,
          gameTime,
        );

      if (openMeteo) {
        return openMeteo;
      }

      return null;
    }

    /*
     * ========================================================
     * U.S. UPCOMING / LIVE
     * ========================================================
     *
     * NWS remains the primary U.S. provider.
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
     * Open-Meteo is the U.S. fallback.
     */
    const openMeteo =
      await fetchOpenMeteoForecast(
        stadium.lat,
        stadium.lon,
        stadium.timezone,
        gameTime,
      );

    if (openMeteo) {
      return openMeteo;
    }

    return null;
  } catch (error) {
    console.error(
      `Weather failed for game ${gameId}:`,
      error,
    );

    return null;
  }
}
