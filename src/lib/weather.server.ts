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

const USER_AGENT =
  "GamblingNFL/1.0 github.com/RJMurph10/gamblingnfl";

function roundTemperature(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value);
}

function celsiusToFahrenheit(value: number): number {
  return (value * 9) / 5 + 32;
}

function getLocalParts(
  dateString: string,
  timeZone: string,
) {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const year =
    parts.find((p) => p.type === "year")?.value ?? "0000";
  const month =
    parts.find((p) => p.type === "month")?.value ?? "01";
  const day =
    parts.find((p) => p.type === "day")?.value ?? "01";
  const hour =
    parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute =
    parts.find((p) => p.type === "minute")?.value ?? "00";

  return {
    date: `${year}-${month}-${day}`,
    hour: Number(hour),
    minute: Number(minute),
    dateTime: `${year}-${month}-${day}T${hour}:${minute}`,
  };
}

function getDateForTimezone(
  dateString: string,
  timeZone: string,
): string | null {
  return getLocalParts(dateString, timeZone)?.date ?? null;
}

function getComparableMinutes(
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

function getClosestHourlyIndex(
  times: string[],
  gameTime: string,
  timeZone: string,
): number {
  const local = getLocalParts(gameTime, timeZone);

  if (!local) {
    return -1;
  }

  const target =
    getComparableMinutes(local.dateTime);

  if (target == null) {
    return -1;
  }

  let bestIndex = -1;
  let bestDifference = Infinity;

  for (let i = 0; i < times.length; i++) {
    const candidate =
      getComparableMinutes(times[i]);

    if (candidate == null) {
      continue;
    }

    const difference = Math.abs(candidate - target);

    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  // Never use weather from more than 2 hours away.
  if (bestDifference > 120) {
    return -1;
  }

  return bestIndex;
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
      condition: "Clear",
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

function isInternational(
  stadium: StadiumInfo,
): boolean {
  return (
    stadium.timezone === "Europe/London" ||
    stadium.timezone === "Europe/Berlin" ||
    stadium.timezone === "America/Sao_Paulo"
  );
}

function isCompleted(status: string): boolean {
  const s = status.toLowerCase();

  return (
    s.includes("final") ||
    s.includes("completed") ||
    s === "complete" ||
    s.includes("post")
  );
}

function isLive(status: string): boolean {
  const s = status.toLowerCase();

  return (
    s.includes("live") ||
    s.includes("in progress") ||
    s.includes("progress")
  );
}

function unavailable(): GameWeather {
  return {
    isIndoor: false,
    temperature: null,
    condition: "Weather unavailable",
    high: null,
    low: null,
    emoji: "🌡️",
  };
}

/* ============================================================
   OPEN-METEO HISTORICAL FORECAST
   ============================================================ */

async function fetchHistoricalForecast(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  try {
    const local = getLocalParts(
      gameTime,
      stadium.timezone,
    );

    if (!local) {
      return null;
    }

    const url = new URL(
      "https://historical-forecast-api.open-meteo.com/v1/forecast",
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
      "start_date",
      local.date,
    );

    url.searchParams.set(
      "end_date",
      local.date,
    );

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

    const response = await fetch(
      url.toString(),
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error(
        `[Weather] Historical Forecast HTTP ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as WeatherApiResponse;

    const times = data.hourly?.time ?? [];
    const temperatures =
      data.hourly?.temperature_2m ?? [];
    const codes =
      data.hourly?.weather_code ?? [];
    const isDayValues =
      data.hourly?.is_day ?? [];

    if (!times.length || !temperatures.length) {
      return null;
    }

    const index = getClosestHourlyIndex(
      times,
      gameTime,
      stadium.timezone,
    );

    if (index < 0) {
      return null;
    }

    const temperature =
      temperatures[index] ?? null;

    const code =
      codes[index] ?? null;

    return {
      isIndoor: false,
      temperature: roundTemperature(temperature),
      condition: conditionFromWeatherCode(code),
      high: roundTemperature(
        data.daily?.temperature_2m_max?.[0],
      ),
      low: roundTemperature(
        data.daily?.temperature_2m_min?.[0],
      ),
      emoji: getWeatherEmoji(
        code,
        isDayValues[index] == null
          ? null
          : Boolean(isDayValues[index]),
      ),
    };
  } catch (error) {
    console.error(
      "[Weather] Historical Forecast failed:",
      error,
    );

    return null;
  }
}

/* ============================================================
   OPEN-METEO RECENT PAST DAYS
   ============================================================ */

async function fetchRecentPastForecast(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  try {
    const gameDate = new Date(gameTime);

    if (Number.isNaN(gameDate.getTime())) {
      return null;
    }

    const now = new Date();

    const differenceDays = Math.ceil(
      (now.getTime() - gameDate.getTime()) /
        (24 * 60 * 60 * 1000),
    );

    if (
      differenceDays < 0 ||
      differenceDays > 92
    ) {
      return null;
    }

    const local = getLocalParts(
      gameTime,
      stadium.timezone,
    );

    if (!local) {
      return null;
    }

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
      "past_days",
      String(
        Math.min(
          92,
          Math.max(1, differenceDays + 1),
        ),
      ),
    );

    url.searchParams.set(
      "forecast_days",
      "1",
    );

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

    const response = await fetch(
      url.toString(),
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error(
        `[Weather] Recent Forecast HTTP ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as WeatherApiResponse;

    const times = data.hourly?.time ?? [];
    const temperatures =
      data.hourly?.temperature_2m ?? [];
    const codes =
      data.hourly?.weather_code ?? [];
    const isDayValues =
      data.hourly?.is_day ?? [];

    if (!times.length || !temperatures.length) {
      return null;
    }

    const index = getClosestHourlyIndex(
      times,
      gameTime,
      stadium.timezone,
    );

    if (index < 0) {
      return null;
    }

    const temperature =
      temperatures[index] ?? null;

    const code =
      codes[index] ?? null;

    return {
      isIndoor: false,
      temperature: roundTemperature(temperature),
      condition: conditionFromWeatherCode(code),
      high: roundTemperature(
        data.daily?.temperature_2m_max?.[0],
      ),
      low: roundTemperature(
        data.daily?.temperature_2m_min?.[0],
      ),
      emoji: getWeatherEmoji(
        code,
        isDayValues[index] == null
          ? null
          : Boolean(isDayValues[index]),
      ),
    };
  } catch (error) {
    console.error(
      "[Weather] Recent past forecast failed:",
      error,
    );

    return null;
  }
}

/* ============================================================
   OPEN-METEO HISTORICAL ARCHIVE
   ============================================================ */

async function fetchHistoricalArchive(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  try {
    const local = getLocalParts(
      gameTime,
      stadium.timezone,
    );

    if (!local) {
      return null;
    }

    const url = new URL(
      "https://archive-api.open-meteo.com/v1/archive",
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
      "start_date",
      local.date,
    );

    url.searchParams.set(
      "end_date",
      local.date,
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
      stadium.timezone,
    );

    url.searchParams.set(
      "cell_selection",
      "land",
    );

    const response = await fetch(
      url.toString(),
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error(
        `[Weather] Historical Archive HTTP ${response.status}`,
      );

      return null;
    }

    const data =
      (await response.json()) as WeatherApiResponse;

    const times = data.hourly?.time ?? [];
    const temperatures =
      data.hourly?.temperature_2m ?? [];
    const codes =
      data.hourly?.weather_code ?? [];

    if (!times.length || !temperatures.length) {
      return null;
    }

    const index = getClosestHourlyIndex(
      times,
      gameTime,
      stadium.timezone,
    );

    if (index < 0) {
      return null;
    }

    const temperature =
      temperatures[index] ?? null;

    const code =
      codes[index] ?? null;

    return {
      isIndoor: false,
      temperature: roundTemperature(temperature),
      condition: conditionFromWeatherCode(code),
      high: roundTemperature(
        data.daily?.temperature_2m_max?.[0],
      ),
      low: roundTemperature(
        data.daily?.temperature_2m_min?.[0],
      ),
      emoji: getWeatherEmoji(code),
    };
  } catch (error) {
    console.error(
      "[Weather] Historical Archive failed:",
      error,
    );

    return null;
  }
}

/* ============================================================
   NWS — UNITED STATES UPCOMING/LIVE
   ============================================================ */

async function fetchNwsWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  try {
    const pointsUrl =
      `https://api.weather.gov/points/${stadium.lat},${stadium.lon}`;

    const pointsResponse = await fetch(
      pointsUrl,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/geo+json",
        },
      },
    );

    if (!pointsResponse.ok) {
      return null;
    }

    const points =
      (await pointsResponse.json()) as NWSPointsResponse;

    const hourlyUrl =
      points.properties?.forecastHourly;

    const dailyUrl =
      points.properties?.forecast;

    if (!hourlyUrl) {
      return null;
    }

    const hourlyResponse = await fetch(
      hourlyUrl,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/geo+json",
        },
      },
    );

    if (!hourlyResponse.ok) {
      return null;
    }

    const hourly =
      (await hourlyResponse.json()) as NWSForecastResponse;

    const periods =
      hourly.properties?.periods ?? [];

    if (!periods.length) {
      return null;
    }

    const target = new Date(gameTime);

    if (Number.isNaN(target.getTime())) {
      return null;
    }

    let best = periods[0];
    let bestDifference = Infinity;

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
        best = period;
      }
    }

    let high: number | null = null;
    let low: number | null = null;

    if (dailyUrl) {
      try {
        const dailyResponse = await fetch(
          dailyUrl,
          {
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "application/geo+json",
            },
          },
        );

        if (dailyResponse.ok) {
          const daily =
            (await dailyResponse.json()) as NWSForecastResponse;

          const dailyPeriods =
            daily.properties?.periods ?? [];

          const targetDate =
            getDateForTimezone(
              gameTime,
              stadium.timezone,
            );

          for (const period of dailyPeriods) {
            if (!period.startTime) {
              continue;
            }

            const periodDate =
              getDateForTimezone(
                period.startTime,
                stadium.timezone,
              );

            if (
              periodDate !== targetDate ||
              period.temperature == null
            ) {
              continue;
            }

            if (period.isDaytime) {
              high =
                high == null
                  ? period.temperature
                  : Math.max(
                      high,
                      period.temperature,
                    );
            } else {
              low =
                low == null
                  ? period.temperature
                  : Math.min(
                      low,
                      period.temperature,
                    );
            }
          }
        }
      } catch {
        // H/L are optional; kickoff weather is still valid.
      }
    }

    const condition =
      best.shortForecast ??
      "Weather unavailable";

    return {
      isIndoor: false,
      temperature: roundTemperature(
        best.temperature,
      ),
      condition,
      high: roundTemperature(high),
      low: roundTemperature(low),
      emoji: best.isDaytime === false
        ? "🌙"
        : "☀️",
    };
  } catch (error) {
    console.error(
      "[Weather] NWS failed:",
      error,
    );

    return null;
  }
}

/* ============================================================
   MET NORWAY — INTERNATIONAL UPCOMING/LIVE
   ============================================================ */

async function fetchMetNorwayWeather(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<GameWeather | null> {
  try {
    const url =
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${stadium.lat}&lon=${stadium.lon}`;

    const response = await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "GamblingNFL/1.0 github.com/RJMurph10/gamblingnfl",
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
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

    let best = series[0];
    let bestDifference = Infinity;

    for (const entry of series) {
      if (!entry.time) {
        continue;
      }

      const entryTime =
        new Date(entry.time);

      if (Number.isNaN(entryTime.getTime())) {
        continue;
      }

      const difference = Math.abs(
        entryTime.getTime() -
          target.getTime(),
      );

      if (difference < bestDifference) {
        bestDifference = difference;
        best = entry;
      }
    }

    const temperatureC =
      best.data?.instant?.details
        ?.air_temperature ?? null;

    const symbol =
      best.data?.next_1_hours?.summary
        ?.symbol_code;

    const weather =
      symbolCodeToWeather(symbol);

    return {
      isIndoor: false,
      temperature:
        temperatureC == null
          ? null
          : roundTemperature(
              celsiusToFahrenheit(
                temperatureC,
              ),
            ),
      condition: weather.condition,
      high: null,
      low: null,
      emoji: weather.emoji,
    };
  } catch (error) {
    console.error(
      "[Weather] MET Norway failed:",
      error,
    );

    return null;
  }
}

/* ============================================================
   OPEN-METEO DAILY H/L FOR INTERNATIONAL GAMES
   ============================================================ */

async function fetchInternationalDailyHighLow(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<{
  high: number | null;
  low: number | null;
}> {
  try {
    const local = getLocalParts(
      gameTime,
      stadium.timezone,
    );

    if (!local) {
      return {
        high: null,
        low: null,
      };
    }

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
      "start_date",
      local.date,
    );

    url.searchParams.set(
      "end_date",
      local.date,
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

    const response = await fetch(
      url.toString(),
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      return {
        high: null,
        low: null,
      };
    }

    const data =
      (await response.json()) as WeatherApiResponse;

    return {
      high: roundTemperature(
        data.daily?.temperature_2m_max?.[0],
      ),
      low: roundTemperature(
        data.daily?.temperature_2m_min?.[0],
      ),
    };
  } catch {
    return {
      high: null,
      low: null,
    };
  }
}

/* ============================================================
   MAIN WEATHER FUNCTION
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
}): Promise<GameWeather> {
  console.log(
    `[Weather] ${gameId} | ${homeTeamId} | ${venue ?? "unknown"} | ${status} | ${gameTime}`,
  );

  const stadium = getStadiumForGame(
    homeTeamId,
    venue,
  );

  /* ----------------------------------------------------------
     INDOOR
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     COMPLETED GAMES
     ---------------------------------------------------------- */

  if (isCompleted(status)) {
    /*
     * 1. Historical Forecast
     */
    const historical =
      await fetchHistoricalForecast(
        stadium,
        gameTime,
      );

    if (historical) {
      console.log(
        `[Weather] Historical Forecast success: ${gameId}`,
      );

      return historical;
    }

    /*
     * 2. Recent past_days forecast
     */
    const recent =
      await fetchRecentPastForecast(
        stadium,
        gameTime,
      );

    if (recent) {
      console.log(
        `[Weather] Recent Forecast success: ${gameId}`,
      );

      return recent;
    }

    /*
     * 3. Historical archive
     */
    const archive =
      await fetchHistoricalArchive(
        stadium,
        gameTime,
      );

    if (archive) {
      console.log(
        `[Weather] Historical Archive success: ${gameId}`,
      );

      return archive;
    }

    console.error(
      `[Weather] ALL historical sources failed: ${gameId}`,
    );

    return unavailable();
  }

  /* ----------------------------------------------------------
     UPCOMING / LIVE U.S.
     ---------------------------------------------------------- */

  if (!isInternational(stadium)) {
    const nws =
      await fetchNwsWeather(
        stadium,
        gameTime,
      );

    if (nws) {
      return nws;
    }

    console.error(
      `[Weather] NWS unavailable: ${gameId}`,
    );

    return unavailable();
  }

  /* ----------------------------------------------------------
     UPCOMING / LIVE INTERNATIONAL
     ---------------------------------------------------------- */

  const met =
    await fetchMetNorwayWeather(
      stadium,
      gameTime,
    );

  const daily =
    await fetchInternationalDailyHighLow(
      stadium,
      gameTime,
    );

  if (met) {
    return {
      ...met,
      high: daily.high,
      low: daily.low,
    };
  }

  console.error(
    `[Weather] MET Norway unavailable: ${gameId}`,
  );

  /*
   * Even if MET Norway fails, if Open-Meteo gave us
   * daily information, return something useful.
   */
  if (
    daily.high != null ||
    daily.low != null
  ) {
    return {
      isIndoor: false,
      temperature: null,
      condition: "Weather unavailable",
      high: daily.high,
      low: daily.low,
      emoji: "🌡️",
    };
  }

  return unavailable();
}
