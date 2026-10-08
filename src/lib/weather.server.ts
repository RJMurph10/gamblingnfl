import { NFL_STADIUMS, getStadiumForGame } from "@/lib/stadiums";

export interface GameWeather {
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
  isIndoor: boolean;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
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

interface MetNorwayTimeseriesEntry {
  time: string;

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

      details?: {
        air_temperature_max?: number;
        air_temperature_min?: number;
      };
    };

    next_12_hours?: {
      summary?: {
        symbol_code?: string;
      };
    };
  };
}

interface MetNorwayResponse {
  properties?: {
    timeseries?: MetNorwayTimeseriesEntry[];
  };
}

interface NWSPeriod {
  startTime: string;
  endTime: string;
  temperature?: number;
  temperatureUnit?: string;
  shortForecast?: string;
  icon?: string;
}

interface NWSResponse {
  properties?: {
    periods?: NWSPeriod[];
  };
}

function isCompleted(status: string): boolean {
  const s = status.toLowerCase();

  return (
    s.includes("final") ||
    s.includes("completed") ||
    s.includes("complete") ||
    s === "post" ||
    s.includes("postgame")
  );
}

function weatherCodeToCondition(code: number): {
  condition: string;
  emoji: string;
} {
  if (code === 0) {
    return {
      condition: "Clear",
      emoji: "☀️",
    };
  }

  if (code === 1) {
    return {
      condition: "Mainly clear",
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
      condition: "Cloudy",
      emoji: "☁️",
    };
  }

  if (code === 45 || code === 48) {
    return {
      condition: "Fog",
      emoji: "🌫️",
    };
  }

  if ([51, 53, 55, 56, 57].includes(code)) {
    return {
      condition: "Drizzle",
      emoji: "🌦️",
    };
  }

  if ([61, 63, 65, 66, 67].includes(code)) {
    return {
      condition: "Rain",
      emoji: "🌧️",
    };
  }

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return {
      condition: "Snow",
      emoji: "🌨️",
    };
  }

  if ([80, 81, 82].includes(code)) {
    return {
      condition: "Rain showers",
      emoji: "🌦️",
    };
  }

  if ([95, 96, 99].includes(code)) {
    return {
      condition: "Thunderstorm",
      emoji: "⛈️",
    };
  }

  return {
    condition: "Cloudy",
    emoji: "☁️",
  };
}

function getLocalDate(
  iso: string,
  timezone: string,
): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function getLocalHour(
  iso: string,
  timezone: string,
): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        hour12: false,
      }).format(new Date(iso)),
    );
  } catch {
    return new Date(iso).getUTCHours();
  }
}

function getDayNightEmoji(
  iso: string,
  timezone: string,
  fallback: string,
): string {
  const hour = getLocalHour(iso, timezone);

  if (hour >= 6 && hour < 18) {
    if (
      fallback === "🌙" ||
      fallback === "🌃"
    ) {
      return "☀️";
    }

    return fallback;
  }

  if (
    fallback === "☀️" ||
    fallback === "🌤️" ||
    fallback === "⛅"
  ) {
    return "🌙";
  }

  return fallback;
}

function parseOpenMeteoWeather(
  response: OpenMeteoResponse,
  gameTime: string,
  timezone: string,
): GameWeather | null {
  const hourly = response.hourly;

  if (
    !hourly?.time ||
    !hourly.temperature_2m ||
    hourly.time.length === 0
  ) {
    return null;
  }

  const gameTimestamp = new Date(gameTime).getTime();

  let bestIndex = -1;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let i = 0; i < hourly.time.length; i++) {
    const timestamp = new Date(hourly.time[i]).getTime();
    const difference = Math.abs(timestamp - gameTimestamp);

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) {
    return null;
  }

  const temperature =
    hourly.temperature_2m[bestIndex];

  if (
    temperature == null ||
    !Number.isFinite(temperature)
  ) {
    return null;
  }

  const weatherCode =
    hourly.weather_code?.[bestIndex] ?? 3;

  const weather = weatherCodeToCondition(
    weatherCode,
  );

  return {
    temperature: Math.round(temperature),
    condition: weather.condition,
    emoji: getDayNightEmoji(
      gameTime,
      timezone,
      weather.emoji,
    ),
    high: null,
    low: null,
    isIndoor: false,
  };
}

async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  gameTime: string,
  timezone: string,
): Promise<GameWeather | null> {
  try {
    const url = new URL(
      "https://api.open-meteo.com/v1/forecast",
    );

    url.searchParams.set(
      "latitude",
      String(lat),
    );

    url.searchParams.set(
      "longitude",
      String(lon),
    );

    url.searchParams.set(
      "hourly",
      "temperature_2m,weather_code",
    );

    url.searchParams.set(
      "temperature_unit",
      "fahrenheit",
    );

    url.searchParams.set(
      "timezone",
      timezone,
    );

    url.searchParams.set(
      "forecast_days",
      "7",
    );

    url.searchParams.set(
      "cell_selection",
      "nearest",
    );

    const response = await fetch(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
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

    return parseOpenMeteoWeather(
      data,
      gameTime,
      timezone,
    );
  } catch (error) {
    console.error(
      "Open-Meteo forecast error:",
      error,
    );

    return null;
  }
}

/**
 * MET Norway uses symbol codes such as:
 *
 * clearsky_day
 * clearsky_night
 * fair_day
 * partlycloudy_day
 * partlycloudy_night
 * cloudy
 * lightrain
 * rain
 * heavyrain
 * rainshowers_day
 * snow
 * fog
 * etc.
 *
 * The suffix is not important for the condition.
 */
function metSymbolToWeather(
  symbol?: string,
): {
  condition: string;
  emoji: string;
} {
  if (!symbol) {
    return {
      condition: "Cloudy",
      emoji: "☁️",
    };
  }

  const normalized = symbol
    .toLowerCase()
    .trim();

  if (
    normalized.includes("thunder")
  ) {
    return {
      condition: "Thunderstorm",
      emoji: "⛈️",
    };
  }

  if (
    normalized.includes("snow") ||
    normalized.includes("sleet")
  ) {
    return {
      condition: "Snow",
      emoji: "🌨️",
    };
  }

  if (
    normalized.includes("rain") ||
    normalized.includes("shower") ||
    normalized.includes("drizzle")
  ) {
    return {
      condition: "Rain",
      emoji: "🌧️",
    };
  }

  if (
    normalized.includes("fog") ||
    normalized.includes("mist")
  ) {
    return {
      condition: "Fog",
      emoji: "🌫️",
    };
  }

  if (
    normalized.includes("partlycloudy") ||
    normalized.includes("partly_cloudy")
  ) {
    return {
      condition: "Partly cloudy",
      emoji: "⛅",
    };
  }

  if (
    normalized.includes("overcast") ||
    normalized.includes("cloudy") ||
    normalized.includes("cloud")
  ) {
    return {
      condition: "Cloudy",
      emoji: "☁️",
    };
  }

  if (
    normalized.includes("fair")
  ) {
    return {
      condition: "Mainly clear",
      emoji: "🌤️",
    };
  }

  if (
    normalized.includes("clearsky") ||
    normalized.includes("clear")
  ) {
    return {
      condition: "Clear",
      emoji: "☀️",
    };
  }

  // IMPORTANT:
  // Never turn a valid temperature into
  // "Weather unavailable" just because MET
  // returned an unfamiliar symbol code.
  console.warn(
    `MET Norway: unrecognized symbol "${symbol}", using Cloudy fallback`,
  );

  return {
    condition: "Cloudy",
    emoji: "☁️",
  };
}

function celsiusToFahrenheit(
  celsius: number,
): number {
  return Math.round(
    (celsius * 9) / 5 + 32,
  );
}

function findMetEntry(
  entries: MetNorwayTimeseriesEntry[],
  gameTime: string,
): MetNorwayTimeseriesEntry | null {
  if (!entries.length) {
    return null;
  }

  const target = new Date(
    gameTime,
  ).getTime();

  let best:
    | MetNorwayTimeseriesEntry
    | null = null;

  let bestDifference =
    Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const timestamp = new Date(
      entry.time,
    ).getTime();

    const difference = Math.abs(
      timestamp - target,
    );

    if (difference < bestDifference) {
      bestDifference = difference;
      best = entry;
    }
  }

  return best;
}

/**
 * International daily high/low.
 *
 * This is deliberately independent from MET Norway.
 * If this request fails, the kickoff temperature and
 * condition still remain visible.
 *
 * Open-Meteo supports daily temperature_2m_max/min
 * and timezone-aware daily results.
 */
async function fetchInternationalDailyHighLow(
  lat: number,
  lon: number,
  gameTime: string,
  timezone: string,
): Promise<{
  high: number | null;
  low: number | null;
}> {
  try {
    const localDate = getLocalDate(
      gameTime,
      timezone,
    );

    const url = new URL(
      "https://api.open-meteo.com/v1/forecast",
    );

    url.searchParams.set(
      "latitude",
      String(lat),
    );

    url.searchParams.set(
      "longitude",
      String(lon),
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
      "timezone",
      timezone,
    );

    // IMPORTANT:
    // Use a broad forecast window so the target
    // international game date is definitely included.
    url.searchParams.set(
      "forecast_days",
      "7",
    );

    url.searchParams.set(
      "cell_selection",
      "nearest",
    );

    const response = await fetch(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
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

    const times =
      data.daily?.time ?? [];

    const highs =
      data.daily?.temperature_2m_max ?? [];

    const lows =
      data.daily?.temperature_2m_min ?? [];

    const index = times.findIndex(
      (date) => date === localDate,
    );

    if (index < 0) {
      console.warn(
        `Open-Meteo international H/L: ${localDate} not found in daily dates`,
        times,
      );

      return {
        high: null,
        low: null,
      };
    }

    const high = highs[index];
    const low = lows[index];

    return {
      high:
        high != null &&
        Number.isFinite(high)
          ? Math.round(high)
          : null,

      low:
        low != null &&
        Number.isFinite(low)
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
  gameTime: string,
  timezone: string,
): Promise<GameWeather | null> {
  try {
    const url =
      `https://api.met.no/weatherapi/locationforecast/2.0/compact` +
      `?lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lon)}`;

    const response = await fetch(
      url,
      {
        headers: {
          Accept: "application/json",
          // MET Norway requests a descriptive User-Agent.
          "User-Agent":
            "GamblingNFL/1.0 weather service",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error(
        `MET Norway failed: ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as MetNorwayResponse;

    const entries =
      data.properties?.timeseries ?? [];

    const entry = findMetEntry(
      entries,
      gameTime,
    );

    if (!entry) {
      console.error(
        "MET Norway: no matching forecast entry",
      );

      return null;
    }

    const celsius =
      entry.data?.instant?.details
        ?.air_temperature;

    if (
      celsius == null ||
      !Number.isFinite(celsius)
    ) {
      console.error(
        "MET Norway: no air temperature",
      );

      return null;
    }

    const symbol =
      entry.data?.next_1_hours?.summary
        ?.symbol_code ??
      entry.data?.next_6_hours?.summary
        ?.symbol_code ??
      entry.data?.next_12_hours?.summary
        ?.symbol_code;

    const weather =
      metSymbolToWeather(symbol);

    const temperature =
      celsiusToFahrenheit(celsius);

    const emoji =
      getDayNightEmoji(
        gameTime,
        timezone,
        weather.emoji,
      );

    // H/L is intentionally a completely
    // separate request.
    const daily =
      await fetchInternationalDailyHighLow(
        lat,
        lon,
        gameTime,
        timezone,
      );

    return {
      temperature,
      condition: weather.condition,
      emoji,
      high: daily.high,
      low: daily.low,
      isIndoor: false,
    };
  } catch (error) {
    console.error(
      "MET Norway error:",
      error,
    );

    return null;
  }
}

/**
 * Historical Open-Meteo request.
 *
 * This branch is ONLY used after the game is
 * completed. It never affects upcoming/live games.
 */
async function fetchHistoricalArchiveWeather(
  lat: number,
  lon: number,
  gameTime: string,
  timezone: string,
): Promise<GameWeather | null> {
  try {
    const localDate = getLocalDate(
      gameTime,
      timezone,
    );

    const url = new URL(
      "https://archive-api.open-meteo.com/v1/archive",
    );

    url.searchParams.set(
      "latitude",
      String(lat),
    );

    url.searchParams.set(
      "longitude",
      String(lon),
    );

    url.searchParams.set(
      "start_date",
      localDate,
    );

    url.searchParams.set(
      "end_date",
      localDate,
    );

    url.searchParams.set(
      "hourly",
      "temperature_2m,weather_code",
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
      "timezone",
      timezone,
    );

    url.searchParams.set(
      "cell_selection",
      "nearest",
    );

    const response = await fetch(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error(
        `Historical Open-Meteo failed: ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as OpenMeteoResponse;

    const base =
      parseOpenMeteoWeather(
        data,
        gameTime,
        timezone,
      );

    if (!base) {
      return null;
    }

    const dailyDate =
      data.daily?.time?.[0];

    const dailyHigh =
      data.daily?.temperature_2m_max?.[0];

    const dailyLow =
      data.daily?.temperature_2m_min?.[0];

    return {
      ...base,

      high:
        dailyDate === localDate &&
        dailyHigh != null &&
        Number.isFinite(dailyHigh)
          ? Math.round(dailyHigh)
          : null,

      low:
        dailyDate === localDate &&
        dailyLow != null &&
        Number.isFinite(dailyLow)
          ? Math.round(dailyLow)
          : null,
    };
  } catch (error) {
    console.error(
      "Historical Open-Meteo error:",
      error,
    );

    return null;
  }
}

async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  gameTime: string,
  timezone: string,
): Promise<GameWeather | null> {
  return fetchHistoricalArchiveWeather(
    lat,
    lon,
    gameTime,
    timezone,
  );
}

async function fetchNwsWeather(
  lat: number,
  lon: number,
  gameTime: string,
  timezone: string,
): Promise<GameWeather | null> {
  try {
    const pointsUrl =
      `https://api.weather.gov/points/${lat},${lon}`;

    const pointsResponse = await fetch(
      pointsUrl,
      {
        headers: {
          Accept:
            "application/geo+json",
          "User-Agent":
            "GamblingNFL/1.0 weather service",
        },
        cache: "no-store",
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
        "NWS: no hourly forecast URL",
      );

      return null;
    }

    const forecastResponse =
      await fetch(hourlyUrl, {
        headers: {
          Accept:
            "application/geo+json",
          "User-Agent":
            "GamblingNFL/1.0 weather service",
        },
        cache: "no-store",
      });

    if (!forecastResponse.ok) {
      console.error(
        `NWS hourly failed: ${forecastResponse.status}`,
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

    let best:
      | NWSPeriod
      | null = null;

    let bestDifference =
      Number.POSITIVE_INFINITY;

    for (const period of periods) {
      const start =
        new Date(
          period.startTime,
        ).getTime();

      const end =
        new Date(
          period.endTime,
        ).getTime();

      let difference: number;

      if (
        target >= start &&
        target <= end
      ) {
        difference = 0;
      } else {
        difference = Math.min(
          Math.abs(target - start),
          Math.abs(target - end),
        );
      }

      if (difference < bestDifference) {
        bestDifference = difference;
        best = period;
      }
    }

    if (!best) {
      return null;
    }

    const temperature =
      best.temperature;

    if (
      temperature == null ||
      !Number.isFinite(temperature)
    ) {
      return null;
    }

    const condition =
      best.shortForecast ||
      "Cloudy";

    const conditionLower =
      condition.toLowerCase();

    let emoji = "☁️";

    if (
      conditionLower.includes("thunder")
    ) {
      emoji = "⛈️";
    } else if (
      conditionLower.includes("snow")
    ) {
      emoji = "🌨️";
    } else if (
      conditionLower.includes("rain") ||
      conditionLower.includes("shower") ||
      conditionLower.includes("drizzle")
    ) {
      emoji = "🌧️";
    } else if (
      conditionLower.includes("fog")
    ) {
      emoji = "🌫️";
    } else if (
      conditionLower.includes("mostly clear")
    ) {
      emoji = "🌤️";
    } else if (
      conditionLower.includes("partly")
    ) {
      emoji = "⛅";
    } else if (
      conditionLower.includes("clear")
    ) {
      emoji = "☀️";
    }

    return {
      temperature: Math.round(
        temperature,
      ),
      condition,
      emoji: getDayNightEmoji(
        gameTime,
        timezone,
        emoji,
      ),
      high: null,
      low: null,
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

async function fetchNwsDailyHighLow(
  lat: number,
  lon: number,
  gameTime: string,
  timezone: string,
): Promise<{
  high: number | null;
  low: number | null;
}> {
  try {
    const pointsUrl =
      `https://api.weather.gov/points/${lat},${lon}`;

    const pointsResponse = await fetch(
      pointsUrl,
      {
        headers: {
          Accept:
            "application/geo+json",
          "User-Agent":
            "GamblingNFL/1.0 weather service",
        },
        cache: "no-store",
      },
    );

    if (!pointsResponse.ok) {
      return {
        high: null,
        low: null,
      };
    }

    const points =
      await pointsResponse.json();

    const hourlyUrl =
      points?.properties?.forecastHourly;

    if (!hourlyUrl) {
      return {
        high: null,
        low: null,
      };
    }

    const response =
      await fetch(hourlyUrl, {
        headers: {
          Accept:
            "application/geo+json",
          "User-Agent":
            "GamblingNFL/1.0 weather service",
        },
        cache: "no-store",
      });

    if (!response.ok) {
      return {
        high: null,
        low: null,
      };
    }

    const data =
      (await response.json()) as NWSResponse;

    const periods =
      data.properties?.periods ?? [];

    const localDate =
      getLocalDate(
        gameTime,
        timezone,
      );

    const dayPeriods =
      periods.filter((period) => {
        return (
          getLocalDate(
            period.startTime,
            timezone,
          ) === localDate
        );
      });

    if (!dayPeriods.length) {
      return {
        high: null,
        low: null,
      };
    }

    const temperatures =
      dayPeriods
        .map(
          (period) =>
            period.temperature,
        )
        .filter(
          (value): value is number =>
            value != null &&
            Number.isFinite(value),
        );

    if (!temperatures.length) {
      return {
        high: null,
        low: null,
      };
    }

    return {
      high: Math.round(
        Math.max(...temperatures),
      ),
      low: Math.round(
        Math.min(...temperatures),
      ),
    };
  } catch (error) {
    console.error(
      "NWS daily H/L error:",
      error,
    );

    return {
      high: null,
      low: null,
    };
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
  try {
    void gameId;

    const stadium =
      getStadiumForGame(
        homeTeamId,
        venue,
      );

    if (!stadium) {
      return null;
    }

    /*
     * INDOOR / CLIMATE CONTROLLED
     *
     * No external API call.
     */
    if (stadium.isIndoor) {
      return {
        temperature: 72,
        condition: "Indoor",
        emoji: "🏟️",
        high: null,
        low: null,
        isIndoor: true,
      };
    }

    /*
     * COMPLETED GAMES
     *
     * Keep historical weather completely separate
     * from upcoming/live weather.
     */
    if (isCompleted(status)) {
      const historical =
        await fetchHistoricalWeather(
          stadium.lat,
          stadium.lon,
          gameTime,
          stadium.timezone,
        );

      if (historical) {
        return historical;
      }

      return null;
    }

    /*
     * INTERNATIONAL UPCOMING / LIVE
     *
     * Venue-first detection means these games never
     * accidentally use an American NWS station.
     */
    const isInternational =
      stadium === NFL_STADIUMS.TOTTENHAM ||
      stadium === NFL_STADIUMS.WEMBLEY ||
      stadium === NFL_STADIUMS.ALLIANZ ||
      stadium === NFL_STADIUMS.SAOPAULO;

    if (isInternational) {
      const metWeather =
        await fetchMetNorwayWeather(
          stadium.lat,
          stadium.lon,
          gameTime,
          stadium.timezone,
        );

      if (metWeather) {
        return metWeather;
      }

      /*
       * MET Norway fallback.
       *
       * This preserves the temperature/condition
       * even if MET itself has an issue.
       */
      const openMeteo =
        await fetchOpenMeteoForecast(
          stadium.lat,
          stadium.lon,
          gameTime,
          stadium.timezone,
        );

      if (openMeteo) {
        const daily =
          await fetchInternationalDailyHighLow(
            stadium.lat,
            stadium.lon,
            gameTime,
            stadium.timezone,
          );

        return {
          ...openMeteo,
          high: daily.high,
          low: daily.low,
        };
      }

      return null;
    }

    /*
     * UNITED STATES UPCOMING / LIVE
     *
     * NWS is the primary source.
     */
    const nws =
      await fetchNwsWeather(
        stadium.lat,
        stadium.lon,
        gameTime,
        stadium.timezone,
      );

    if (nws) {
      const daily =
        await fetchNwsDailyHighLow(
          stadium.lat,
          stadium.lon,
          gameTime,
          stadium.timezone,
        );

      return {
        ...nws,
        high: daily.high,
        low: daily.low,
      };
    }

    /*
     * Open-Meteo fallback for U.S. games.
     */
    const openMeteo =
      await fetchOpenMeteoForecast(
        stadium.lat,
        stadium.lon,
        gameTime,
        stadium.timezone,
      );

    if (openMeteo) {
      const localDate =
        getLocalDate(
          gameTime,
          stadium.timezone,
        );

      try {
        const url = new URL(
          "https://api.open-meteo.com/v1/forecast",
        );

        url.searchParams.set(
          "latitude",
          String(stadium.lat),
        );

        url.searchParams.set(
          "longitude",
          String(stadium.lon),
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
          "timezone",
          stadium.timezone,
        );

        url.searchParams.set(
          "forecast_days",
          "7",
        );

        url.searchParams.set(
          "cell_selection",
          "nearest",
        );

        const response =
          await fetch(
            url.toString(),
            {
              headers: {
                Accept:
                  "application/json",
              },
              cache: "no-store",
            },
          );

        if (response.ok) {
          const data =
            (await response.json()) as OpenMeteoResponse;

          const times =
            data.daily?.time ?? [];

          const highs =
            data.daily
              ?.temperature_2m_max ?? [];

          const lows =
            data.daily
              ?.temperature_2m_min ?? [];

          const index =
            times.findIndex(
              (date) =>
                date === localDate,
            );

          if (index >= 0) {
            return {
              ...openMeteo,

              high:
                highs[index] != null
                  ? Math.round(
                      highs[index],
                    )
                  : null,

              low:
                lows[index] != null
                  ? Math.round(
                      lows[index],
                    )
                  : null,
            };
          }
        }
      } catch (error) {
        console.error(
          "Open-Meteo U.S. H/L fallback error:",
          error,
        );
      }

      return openMeteo;
    }

    return null;
  } catch (error) {
    console.error(
      "fetchGameWeather error:",
      error,
    );

    return null;
  }
}
