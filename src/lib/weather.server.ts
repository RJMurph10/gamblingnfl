import { getStadiumForGame, type StadiumInfo } from "./stadiums";

export interface GameWeather {
  isIndoor: boolean;
  temperature: number | null;
  condition: string;
  high: number | null;
  low: number | null;
  emoji: string;
}

interface WeatherApiResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    weather_code?: Array<number | null>;
    is_day?: Array<number | null>;
  };

  daily?: {
    time?: string[];
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
  };
}

interface NWSPointsResponse {
  properties?: {
    forecast?: string;
    forecastHourly?: string;
  };
}

interface NWSForecastResponse {
  properties?: {
    periods?: Array<{
      startTime?: string;
      temperature?: number;
      temperatureUnit?: string;
      shortForecast?: string;
      isDaytime?: boolean;
    }>;
  };
}

interface NWSHourlyResponse {
  properties?: {
    periods?: Array<{
      startTime?: string;
      temperature?: number;
      temperatureUnit?: string;
      shortForecast?: string;
      isDaytime?: boolean;
    }>;
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
      };
    }>;
  };
}

const USER_AGENT = "GamblingNFL/1.0 weather";

function roundTemperature(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value);
}

function celsiusToFahrenheit(value: number): number {
  return (value * 9) / 5 + 32;
}

function formatDateForApi(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getLocalDateTimeParts(
  date: Date,
  timeZone: string,
): {
  date: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const hour = Number(
    parts.find((p) => p.type === "hour")?.value ?? "0",
  );
  const minute = Number(
    parts.find((p) => p.type === "minute")?.value ?? "0",
  );

  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

function localDateTimeToComparableMinutes(
  value: string,
): number | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;

  return (
    Number(year) * 525600 +
    Number(month) * 44640 +
    Number(day) * 1440 +
    Number(hour) * 60 +
    Number(minute)
  );
}

function targetLocalComparableMinutes(
  gameTime: string,
  timeZone: string,
): number | null {
  const date = new Date(gameTime);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const local = getLocalDateTimeParts(date, timeZone);

  return localDateTimeToComparableMinutes(
    `${local.date}T${String(local.hour).padStart(2, "0")}:${String(
      local.minute,
    ).padStart(2, "0")}`,
  );
}

function getWeatherEmoji(
  weatherCode: number | null,
  isDay: boolean | null = null,
): string {
  if (weatherCode == null) {
    return isDay === false ? "🌙" : "☀️";
  }

  switch (weatherCode) {
    case 0:
      return isDay === false ? "🌙" : "☀️";

    case 1:
      return isDay === false ? "🌙" : "🌤️";

    case 2:
      return "⛅";

    case 3:
      return "☁️";

    case 45:
    case 48:
      return "🌫️";

    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return "🌦️";

    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
      return "🌧️";

    case 71:
    case 73:
    case 75:
    case 77:
      return "🌨️";

    case 80:
    case 81:
    case 82:
      return "🌦️";

    case 85:
    case 86:
      return "🌨️";

    case 95:
      return "⛈️";

    case 96:
    case 99:
      return "⛈️";

    default:
      return isDay === false ? "🌙" : "☀️";
  }
}

function conditionFromWeatherCode(
  weatherCode: number | null,
): string {
  if (weatherCode == null) {
    return "Weather unavailable";
  }

  switch (weatherCode) {
    case 0:
      return "Clear";

    case 1:
      return "Mostly clear";

    case 2:
      return "Partly cloudy";

    case 3:
      return "Overcast";

    case 45:
    case 48:
      return "Fog";

    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return "Drizzle";

    case 61:
    case 63:
    case 65:
      return "Rain";

    case 66:
    case 67:
      return "Freezing rain";

    case 71:
    case 73:
    case 75:
    case 77:
      return "Snow";

    case 80:
    case 81:
    case 82:
      return "Rain showers";

    case 85:
    case 86:
      return "Snow showers";

    case 95:
      return "Thunderstorm";

    case 96:
    case 99:
      return "Thunderstorm";

    default:
      return "Weather unavailable";
  }
}

function symbolCodeToWeather(
  symbolCode: string | undefined,
): {
  condition: string;
  emoji: string;
} {
  if (!symbolCode) {
    return {
      condition: "Weather unavailable",
      emoji: "☀️",
    };
  }

  const code = symbolCode.toLowerCase();

  if (code.includes("thunder")) {
    return {
      condition: "Thunderstorm",
      emoji: "⛈️",
    };
  }

  if (code.includes("snow")) {
    return {
      condition: code.includes("showers")
        ? "Snow showers"
        : "Snow",
      emoji: "🌨️",
    };
  }

  if (
    code.includes("rain") ||
    code.includes("sleet") ||
    code.includes("drizzle")
  ) {
    return {
      condition: code.includes("showers")
        ? "Rain showers"
        : "Rain",
      emoji: "🌧️",
    };
  }

  if (code.includes("fog")) {
    return {
      condition: "Fog",
      emoji: "🌫️",
    };
  }

  if (code.includes("overcast")) {
    return {
      condition: "Overcast",
      emoji: "☁️",
    };
  }

  if (code.includes("partly")) {
    return {
      condition: "Partly cloudy",
      emoji: "⛅",
    };
  }

  if (code.includes("cloudy")) {
    return {
      condition: "Cloudy",
      emoji: "☁️",
    };
  }

  if (code.includes("clear")) {
    return {
      condition: code.includes("night")
        ? "Clear"
        : "Clear",
      emoji: code.includes("night") ? "🌙" : "☀️",
    };
  }

  if (code.includes("fair")) {
    return {
      condition: "Mostly clear",
      emoji: code.includes("night") ? "🌙" : "🌤️",
    };
  }

  return {
    condition: "Weather unavailable",
    emoji: code.includes("night") ? "🌙" : "☀️",
  };
}

function isInternationalStadium(
  stadium: StadiumInfo,
): boolean {
  return (
    stadium.timezone === "Europe/London" ||
    stadium.timezone === "Europe/Berlin" ||
    stadium.timezone === "America/Sao_Paulo"
  );
}

function isGameCompleted(status: string): boolean {
  const normalized = status.toLowerCase();

  return (
    normalized.includes("final") ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized.includes("post")
  );
}

function isGameLive(status: string): boolean {
  const normalized = status.toLowerCase();

  return (
    normalized.includes("live") ||
    normalized.includes("in progress") ||
    normalized.includes("progress")
  );
}

function createUnavailableWeather(
  isIndoor: boolean,
): GameWeather {
  return {
    isIndoor,
    temperature: null,
    condition: "Weather unavailable",
    high: null,
    low: null,
    emoji: "🌡️",
  };
}

/**
 * Historical Forecast API.
 *
 * This is intentionally different from Open-Meteo's /v1/archive endpoint.
 * The archive endpoint's ERA5 data can have a multi-day delay, while the
 * Historical Forecast API continuously archives past forecasts from 2021/2022
 * onward and is therefore much better for recently completed NFL games.
 */
async function fetchOpenMeteoHistoricalForecast(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  const local = getLocalDateTimeParts(
    new Date(gameTime),
    stadium.timezone,
  );

  const targetDate = local.date;

  const url = new URL(
    "https://historical-forecast-api.open-meteo.com/v1/forecast",
  );

  url.searchParams.set("latitude", String(stadium.lat));
  url.searchParams.set("longitude", String(stadium.lon));
  url.searchParams.set("start_date", targetDate);
  url.searchParams.set("end_date", targetDate);

  url.searchParams.set(
    "hourly",
    "temperature_2m,weather_code,is_day",
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
    "cell_selection",
    "land",
  );

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.error(
      `Open-Meteo Historical Forecast HTTP ${response.status}`,
    );

    return null;
  }

  const data =
    (await response.json()) as WeatherApiResponse;

  const times = data.hourly?.time ?? [];
  const temperatures =
    data.hourly?.temperature_2m ?? [];
  const weatherCodes =
    data.hourly?.weather_code ?? [];
  const isDayValues = data.hourly?.is_day ?? [];

  if (!times.length || !temperatures.length) {
    console.error(
      "Open-Meteo Historical Forecast returned no hourly data",
    );

    return null;
  }

  const targetMinutes = targetLocalComparableMinutes(
    gameTime,
    stadium.timezone,
  );

  if (targetMinutes == null) {
    return null;
  }

  let bestIndex = -1;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let i = 0; i < times.length; i++) {
    const candidateMinutes =
      localDateTimeToComparableMinutes(times[i]);

    if (candidateMinutes == null) {
      continue;
    }

    const difference = Math.abs(
      candidateMinutes - targetMinutes,
    );

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) {
    return null;
  }

  // Never use a weather reading from an unrelated hour.
  if (bestDifference > 120) {
    console.error(
      `Open-Meteo Historical Forecast could not find a nearby kickoff hour. Difference: ${bestDifference} minutes`,
    );

    return null;
  }

  const temperature =
    temperatures[bestIndex] ?? null;

  const weatherCode =
    weatherCodes[bestIndex] ?? null;

  const isDay =
    isDayValues[bestIndex] == null
      ? null
      : Boolean(isDayValues[bestIndex]);

  const dailyMax =
    data.daily?.temperature_2m_max?.[0] ?? null;

  const dailyMin =
    data.daily?.temperature_2m_min?.[0] ?? null;

  return {
    isIndoor: false,
    temperature: roundTemperature(temperature),
    condition: conditionFromWeatherCode(weatherCode),
    high: roundTemperature(dailyMax),
    low: roundTemperature(dailyMin),
    emoji: getWeatherEmoji(
      weatherCode,
      isDay,
    ),
  };
}

/**
 * Older historical fallback.
 *
 * ERA5 is excellent for older historical games, but it can have a delay.
 * Therefore it is used only after Historical Forecast fails.
 */
async function fetchOpenMeteoHistoricalArchive(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  const local = getLocalDateTimeParts(
    new Date(gameTime),
    stadium.timezone,
  );

  const targetDate = local.date;

  const url = new URL(
    "https://archive-api.open-meteo.com/v1/archive",
  );

  url.searchParams.set("latitude", String(stadium.lat));
  url.searchParams.set("longitude", String(stadium.lon));
  url.searchParams.set("start_date", targetDate);
  url.searchParams.set("end_date", targetDate);

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
    stadium.timezone,
  );

  url.searchParams.set(
    "cell_selection",
    "land",
  );

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.error(
      `Open-Meteo Historical Archive HTTP ${response.status}`,
    );

    return null;
  }

  const data =
    (await response.json()) as WeatherApiResponse;

  const times = data.hourly?.time ?? [];
  const temperatures =
    data.hourly?.temperature_2m ?? [];
  const weatherCodes =
    data.hourly?.weather_code ?? [];

  if (!times.length || !temperatures.length) {
    return null;
  }

  const targetMinutes = targetLocalComparableMinutes(
    gameTime,
    stadium.timezone,
  );

  if (targetMinutes == null) {
    return null;
  }

  let bestIndex = -1;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let i = 0; i < times.length; i++) {
    const candidateMinutes =
      localDateTimeToComparableMinutes(times[i]);

    if (candidateMinutes == null) {
      continue;
    }

    const difference = Math.abs(
      candidateMinutes - targetMinutes,
    );

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestDifference > 120) {
    return null;
  }

  const temperature =
    temperatures[bestIndex] ?? null;

  const weatherCode =
    weatherCodes[bestIndex] ?? null;

  const dailyMax =
    data.daily?.temperature_2m_max?.[0] ?? null;

  const dailyMin =
    data.daily?.temperature_2m_min?.[0] ?? null;

  return {
    isIndoor: false,
    temperature: roundTemperature(temperature),
    condition: conditionFromWeatherCode(weatherCode),
    high: roundTemperature(dailyMax),
    low: roundTemperature(dailyMin),
    emoji: getWeatherEmoji(weatherCode),
  };
}

async function fetchNwsWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  try {
    const pointsUrl =
      `https://api.weather.gov/points/${stadium.lat},${stadium.lon}`;

    const pointsResponse = await fetch(pointsUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/geo+json",
      },
    });

    if (!pointsResponse.ok) {
      console.error(
        `NWS points HTTP ${pointsResponse.status}`,
      );

      return null;
    }

    const points =
      (await pointsResponse.json()) as NWSPointsResponse;

    const forecastUrl =
      points.properties?.forecastHourly ??
      points.properties?.forecast;

    if (!forecastUrl) {
      return null;
    }

    const forecastResponse = await fetch(
      forecastUrl,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/geo+json",
        },
      },
    );

    if (!forecastResponse.ok) {
      console.error(
        `NWS forecast HTTP ${forecastResponse.status}`,
      );

      return null;
    }

    const forecast =
      (await forecastResponse.json()) as
        | NWSHourlyResponse
        | NWSForecastResponse;

    const periods =
      forecast.properties?.periods ?? [];

    if (!periods.length) {
      return null;
    }

    const target = new Date(gameTime);

    if (Number.isNaN(target.getTime())) {
      return null;
    }

    let bestPeriod:
      | {
          startTime?: string;
          temperature?: number;
          temperatureUnit?: string;
          shortForecast?: string;
          isDaytime?: boolean;
        }
      | undefined;

    let bestDifference = Number.POSITIVE_INFINITY;

    for (const period of periods) {
      if (!period.startTime) {
        continue;
      }

      const time = new Date(period.startTime);

      if (Number.isNaN(time.getTime())) {
        continue;
      }

      const difference = Math.abs(
        time.getTime() - target.getTime(),
      );

      if (difference < bestDifference) {
        bestDifference = difference;
        bestPeriod = period;
      }
    }

    if (!bestPeriod) {
      return null;
    }

    const temperature =
      bestPeriod.temperature ?? null;

    const condition =
      bestPeriod.shortForecast ??
      "Weather unavailable";

    const isDay =
      bestPeriod.isDaytime ?? null;

    const localDate = formatDateForApi(
      target,
      stadium.timezone,
    );

    const dailyUrl = new URL(
      "https://api.weather.gov/gridpoints",
    );

    // NWS hourly forecast already provides the kickoff
    // temperature and condition. High/low are best-effort
    // values from the normal forecast endpoint below.
    let high: number | null = null;
    let low: number | null = null;

    const regularForecastUrl =
      points.properties?.forecast;

    if (regularForecastUrl) {
      try {
        const regularResponse = await fetch(
          regularForecastUrl,
          {
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "application/geo+json",
            },
          },
        );

        if (regularResponse.ok) {
          const regular =
            (await regularResponse.json()) as NWSForecastResponse;

          const regularPeriods =
            regular.properties?.periods ?? [];

          for (const period of regularPeriods) {
            if (!period.startTime) {
              continue;
            }

            const periodDate =
              formatDateForApi(
                new Date(period.startTime),
                stadium.timezone,
              );

            if (periodDate !== localDate) {
              continue;
            }

            const value =
              period.temperature ?? null;

            if (value == null) {
              continue;
            }

            if (period.isDaytime) {
              high =
                high == null
                  ? value
                  : Math.max(high, value);
            } else {
              low =
                low == null
                  ? value
                  : Math.min(low, value);
            }
          }
        }
      } catch (error) {
        console.error(
          "NWS daily high/low lookup failed:",
          error,
        );
      }
    }

    return {
      isIndoor: false,
      temperature: roundTemperature(temperature),
      condition,
      high: roundTemperature(high),
      low: roundTemperature(low),
      emoji: isDay === false ? "🌙" : "☀️",
    };
  } catch (error) {
    console.error(
      "NWS weather lookup failed:",
      error,
    );

    return null;
  }
}

async function fetchMetNorwayWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  try {
    const url =
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${stadium.lat}&lon=${stadium.lon}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "GamblingNFL/1.0 github.com/RJMurph10/gamblingnfl",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `MET Norway HTTP ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as MetNorwayResponse;

    const series =
      data.properties?.timeseries ?? [];

    if (!series.length) {
      return null;
    }

    const target = new Date(gameTime);

    if (Number.isNaN(target.getTime())) {
      return null;
    }

    let best:
      | {
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
          };
        }
      | undefined;

    let bestDifference = Number.POSITIVE_INFINITY;

    for (const entry of series) {
      if (!entry.time) {
        continue;
      }

      const entryDate = new Date(entry.time);

      if (Number.isNaN(entryDate.getTime())) {
        continue;
      }

      const difference = Math.abs(
        entryDate.getTime() - target.getTime(),
      );

      if (difference < bestDifference) {
        bestDifference = difference;
        best = entry;
      }
    }

    if (!best || bestDifference > 3 * 60 * 60 * 1000) {
      return null;
    }

    const temperatureC =
      best.data?.instant?.details
        ?.air_temperature ?? null;

    const symbolCode =
      best.data?.next_1_hours?.summary
        ?.symbol_code;

    const weather =
      symbolCodeToWeather(symbolCode);

    return {
      isIndoor: false,
      temperature:
        temperatureC == null
          ? null
          : roundTemperature(
              celsiusToFahrenheit(temperatureC),
            ),
      condition: weather.condition,
      high: null,
      low: null,
      emoji: weather.emoji,
    };
  } catch (error) {
    console.error(
      "MET Norway weather lookup failed:",
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
}): Promise<GameWeather> {
  console.log(
    `[Weather] ${gameId} | ${homeTeamId} | ${venue ?? "unknown venue"} | ${status} | ${gameTime}`,
  );

  const stadium = getStadiumForGame(
    homeTeamId,
    venue,
  );

  // Indoor stadiums never make an external weather request.
  if (stadium.isIndoor) {
    return {
      isIndoor: true,
      temperature: 72,
      condition: "Indoor",
      high: null,
      low: null,
      emoji: "🏟️",
    };
  }

  const completed = isGameCompleted(status);
  const live = isGameLive(status);

  /*
   * COMPLETED GAMES
   *
   * Use Open-Meteo Historical Forecast first.
   * This is specifically designed for past weather forecasts
   * and has coverage from roughly 2021/2022 onward.
   */
  if (completed) {
    const historicalForecast =
      await fetchOpenMeteoHistoricalForecast(
        stadium,
        gameTime,
      );

    if (historicalForecast) {
      console.log(
        `[Weather] Historical Forecast success for ${gameId}`,
      );

      return historicalForecast;
    }

    /*
     * Fallback for older games or if the Historical Forecast
     * archive does not have the requested location/date.
     */
    const historicalArchive =
      await fetchOpenMeteoHistoricalArchive(
        stadium,
        gameTime,
      );

    if (historicalArchive) {
      console.log(
        `[Weather] Historical Archive fallback success for ${gameId}`,
      );

      return historicalArchive;
    }

    console.error(
      `[Weather] No historical weather available for ${gameId}`,
    );

    return createUnavailableWeather(false);
  }

  /*
   * UPCOMING / LIVE U.S. GAMES
   */
  if (!isInternationalStadium(stadium)) {
    const nws = await fetchNwsWeather(
      stadium,
      gameTime,
    );

    if (nws) {
      return nws;
    }

    console.error(
      `[Weather] NWS unavailable for ${gameId}`,
    );

    return createUnavailableWeather(false);
  }

  /*
   * UPCOMING / LIVE INTERNATIONAL GAMES
   */
  const metNorway =
    await fetchMetNorwayWeather(
      stadium,
      gameTime,
    );

  if (metNorway) {
    return metNorway;
  }

  console.error(
    `[Weather] MET Norway unavailable for ${gameId}`,
  );

  return createUnavailableWeather(false);
}
