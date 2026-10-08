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
  latitude?: number;
  longitude?: number;
  timezone?: string;
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

function isLive(status: string): boolean {
  const s = status.toLowerCase();

  return (
    s === "in" ||
    s === "live" ||
    s.includes("progress") ||
    s.includes("in_progress")
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
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function localHourMinute(
  iso: string,
  timeZone: string,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));

  const hour = Number(
    parts.find((p) => p.type === "hour")?.value ?? 0,
  );

  const minute = Number(
    parts.find((p) => p.type === "minute")?.value ?? 0,
  );

  return {
    hour: hour === 24 ? 0 : hour,
    minute,
  };
}

function closestHourlyIndex(
  times: string[],
  targetIso: string,
): number {
  const target = new Date(targetIso).getTime();

  let closestIndex = 0;
  let closestDifference = Infinity;

  for (let i = 0; i < times.length; i++) {
    const value = new Date(times[i]).getTime();

    if (!Number.isFinite(value)) continue;

    const difference = Math.abs(value - target);

    if (difference < closestDifference) {
      closestDifference = difference;
      closestIndex = i;
    }
  }

  return closestIndex;
}

async function fetchOpenMeteoHistorical(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<{
  result: WeatherResult | null;
  diagnostic: Record<string, unknown>;
}> {
  const date = localDateString(
    gameTime,
    stadium.timezone,
  );

  const nextDate = new Date(
    new Date(gameTime).getTime() + 24 * 60 * 60 * 1000,
  );

  const endDate = localDateString(
    nextDate.toISOString(),
    stadium.timezone,
  );

  const url =
    "https://historical-forecast-api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(stadium.lat)}` +
    `&longitude=${encodeURIComponent(stadium.lon)}` +
    `&start_date=${date}` +
    `&end_date=${endDate}` +
    `&hourly=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&temperature_unit=fahrenheit` +
    `&timezone=${encodeURIComponent(stadium.timezone)}`;

  console.log("[WEATHER DIAGNOSTIC] Historical Forecast URL:", url);

  try {
    const response = await fetch(url);

    const text = await response.text();

    console.log(
      "[WEATHER DIAGNOSTIC] Historical HTTP:",
      response.status,
    );

    console.log(
      "[WEATHER DIAGNOSTIC] Historical body:",
      text.slice(0, 3000),
    );

    let json: OpenMeteoResponse;

    try {
      json = JSON.parse(text);
    } catch {
      return {
        result: null,
        diagnostic: {
          source: "historical-forecast",
          url,
          httpStatus: response.status,
          parseError: true,
          responseBody: text.slice(0, 3000),
        },
      };
    }

    const times = json.hourly?.time ?? [];
    const temperatures =
      json.hourly?.temperature_2m ?? [];
    const codes = json.hourly?.weather_code ?? [];

    const dailyTimes = json.daily?.time ?? [];
    const dailyHighs =
      json.daily?.temperature_2m_max ?? [];
    const dailyLows =
      json.daily?.temperature_2m_min ?? [];
    const dailyCodes =
      json.daily?.weather_code ?? [];

    const targetLocal = localHourMinute(
      gameTime,
      stadium.timezone,
    );

    let selectedIndex = -1;

    if (times.length > 0) {
      selectedIndex = closestHourlyIndex(
        times,
        gameTime,
      );
    }

    const selectedTime =
      selectedIndex >= 0
        ? times[selectedIndex]
        : null;

    const selectedTemperature =
      selectedIndex >= 0
        ? temperatures[selectedIndex] ?? null
        : null;

    const selectedCode =
      selectedIndex >= 0
        ? codes[selectedIndex] ?? null
        : null;

    const dailyIndex = dailyTimes.findIndex(
      (value) => value === date,
    );

    const high =
      dailyIndex >= 0
        ? dailyHighs[dailyIndex] ?? null
        : null;

    const low =
      dailyIndex >= 0
        ? dailyLows[dailyIndex] ?? null
        : null;

    const weather = weatherCodeToCondition(
      selectedCode,
    );

    const result =
      selectedTemperature != null
        ? {
            temperature: Math.round(
              selectedTemperature,
            ),
            condition: weather.condition,
            emoji: weather.emoji,
            high:
              high != null
                ? Math.round(high)
                : null,
            low:
              low != null
                ? Math.round(low)
                : null,
          }
        : null;

    return {
      result,
      diagnostic: {
        source: "historical-forecast",
        url,
        httpStatus: response.status,
        apiError: json.error ?? false,
        apiReason: json.reason ?? null,
        stadium: stadium.name,
        coordinates: {
          lat: stadium.lat,
          lon: stadium.lon,
        },
        timezone: stadium.timezone,
        gameTime,
        localDate: date,
        targetLocalHour: targetLocal.hour,
        targetLocalMinute: targetLocal.minute,
        hourlyCount: times.length,
        firstHourlyTime: times[0] ?? null,
        lastHourlyTime:
          times[times.length - 1] ?? null,
        selectedIndex,
        selectedTime,
        selectedTemperature,
        selectedWeatherCode: selectedCode,
        dailyCount: dailyTimes.length,
        dailyTimes,
        dailyIndex,
        dailyHigh: high,
        dailyLow: low,
      },
    };
  } catch (error) {
    return {
      result: null,
      diagnostic: {
        source: "historical-forecast",
        url,
        networkError:
          error instanceof Error
            ? error.message
            : String(error),
      },
    };
  }
}

async function fetchOpenMeteoRecent(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<{
  result: WeatherResult | null;
  diagnostic: Record<string, unknown>;
}> {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(stadium.lat)}` +
    `&longitude=${encodeURIComponent(stadium.lon)}` +
    `&hourly=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&temperature_unit=fahrenheit` +
    `&timezone=${encodeURIComponent(stadium.timezone)}` +
    `&past_days=16` +
    `&forecast_days=1`;

  console.log("[WEATHER DIAGNOSTIC] Recent URL:", url);

  try {
    const response = await fetch(url);

    const text = await response.text();

    console.log(
      "[WEATHER DIAGNOSTIC] Recent HTTP:",
      response.status,
    );

    console.log(
      "[WEATHER DIAGNOSTIC] Recent body:",
      text.slice(0, 3000),
    );

    let json: OpenMeteoResponse;

    try {
      json = JSON.parse(text);
    } catch {
      return {
        result: null,
        diagnostic: {
          source: "recent-past-days",
          url,
          httpStatus: response.status,
          parseError: true,
          responseBody: text.slice(0, 3000),
        },
      };
    }

    const times = json.hourly?.time ?? [];
    const temperatures =
      json.hourly?.temperature_2m ?? [];
    const codes = json.hourly?.weather_code ?? [];

    const date = localDateString(
      gameTime,
      stadium.timezone,
    );

    const dailyTimes = json.daily?.time ?? [];
    const dailyHighs =
      json.daily?.temperature_2m_max ?? [];
    const dailyLows =
      json.daily?.temperature_2m_min ?? [];

    const selectedIndex =
      times.length > 0
        ? closestHourlyIndex(times, gameTime)
        : -1;

    const selectedTemperature =
      selectedIndex >= 0
        ? temperatures[selectedIndex] ?? null
        : null;

    const selectedCode =
      selectedIndex >= 0
        ? codes[selectedIndex] ?? null
        : null;

    const dailyIndex = dailyTimes.findIndex(
      (value) => value === date,
    );

    const high =
      dailyIndex >= 0
        ? dailyHighs[dailyIndex] ?? null
        : null;

    const low =
      dailyIndex >= 0
        ? dailyLows[dailyIndex] ?? null
        : null;

    const weather = weatherCodeToCondition(
      selectedCode,
    );

    const result =
      selectedTemperature != null
        ? {
            temperature: Math.round(
              selectedTemperature,
            ),
            condition: weather.condition,
            emoji: weather.emoji,
            high:
              high != null
                ? Math.round(high)
                : null,
            low:
              low != null
                ? Math.round(low)
                : null,
          }
        : null;

    return {
      result,
      diagnostic: {
        source: "recent-past-days",
        url,
        httpStatus: response.status,
        apiError: json.error ?? false,
        apiReason: json.reason ?? null,
        hourlyCount: times.length,
        firstHourlyTime: times[0] ?? null,
        lastHourlyTime:
          times[times.length - 1] ?? null,
        selectedIndex,
        selectedTime:
          selectedIndex >= 0
            ? times[selectedIndex]
            : null,
        selectedTemperature,
        selectedWeatherCode: selectedCode,
        dailyTimes,
        dailyIndex,
        dailyHigh: high,
        dailyLow: low,
      },
    };
  } catch (error) {
    return {
      result: null,
      diagnostic: {
        source: "recent-past-days",
        url,
        networkError:
          error instanceof Error
            ? error.message
            : String(error),
      },
    };
  }
}

async function fetchOpenMeteoArchive(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<{
  result: WeatherResult | null;
  diagnostic: Record<string, unknown>;
}> {
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

  console.log("[WEATHER DIAGNOSTIC] Archive URL:", url);

  try {
    const response = await fetch(url);

    const text = await response.text();

    console.log(
      "[WEATHER DIAGNOSTIC] Archive HTTP:",
      response.status,
    );

    console.log(
      "[WEATHER DIAGNOSTIC] Archive body:",
      text.slice(0, 3000),
    );

    let json: OpenMeteoResponse;

    try {
      json = JSON.parse(text);
    } catch {
      return {
        result: null,
        diagnostic: {
          source: "historical-archive",
          url,
          httpStatus: response.status,
          parseError: true,
          responseBody: text.slice(0, 3000),
        },
      };
    }

    const times = json.hourly?.time ?? [];
    const temperatures =
      json.hourly?.temperature_2m ?? [];
    const codes = json.hourly?.weather_code ?? [];

    const selectedIndex =
      times.length > 0
        ? closestHourlyIndex(times, gameTime)
        : -1;

    const selectedTemperature =
      selectedIndex >= 0
        ? temperatures[selectedIndex] ?? null
        : null;

    const selectedCode =
      selectedIndex >= 0
        ? codes[selectedIndex] ?? null
        : null;

    const dailyTimes = json.daily?.time ?? [];
    const dailyHighs =
      json.daily?.temperature_2m_max ?? [];
    const dailyLows =
      json.daily?.temperature_2m_min ?? [];

    const dailyIndex = dailyTimes.findIndex(
      (value) => value === date,
    );

    const high =
      dailyIndex >= 0
        ? dailyHighs[dailyIndex] ?? null
        : null;

    const low =
      dailyIndex >= 0
        ? dailyLows[dailyIndex] ?? null
        : null;

    const weather = weatherCodeToCondition(
      selectedCode,
    );

    const result =
      selectedTemperature != null
        ? {
            temperature: Math.round(
              selectedTemperature,
            ),
            condition: weather.condition,
            emoji: weather.emoji,
            high:
              high != null
                ? Math.round(high)
                : null,
            low:
              low != null
                ? Math.round(low)
                : null,
          }
        : null;

    return {
      result,
      diagnostic: {
        source: "historical-archive",
        url,
        httpStatus: response.status,
        apiError: json.error ?? false,
        apiReason: json.reason ?? null,
        hourlyCount: times.length,
        firstHourlyTime: times[0] ?? null,
        lastHourlyTime:
          times[times.length - 1] ?? null,
        selectedIndex,
        selectedTime:
          selectedIndex >= 0
            ? times[selectedIndex]
            : null,
        selectedTemperature,
        selectedWeatherCode: selectedCode,
        dailyTimes,
        dailyIndex,
        dailyHigh: high,
        dailyLow: low,
      },
    };
  } catch (error) {
    return {
      result: null,
      diagnostic: {
        source: "historical-archive",
        url,
        networkError:
          error instanceof Error
            ? error.message
            : String(error),
      },
    };
  }
}

function getLocalHour(
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

  return Number(
    parts.find((p) => p.type === "hour")?.value ?? 0,
  );
}

function dayNightEmoji(
  gameTime: string,
  timezone: string,
): string {
  const hour = getLocalHour(
    gameTime,
    timezone,
  );

  return hour >= 6 && hour < 18
    ? "☀️"
    : "🌙";
}

async function fetchUpcomingOpenMeteo(
  stadium: StadiumInfo,
  gameTime: string,
): Promise<WeatherResult | null> {
  const date = localDateString(
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
    `&start_date=${date}` +
    `&end_date=${date}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const json =
      (await response.json()) as OpenMeteoResponse;

    const times = json.hourly?.time ?? [];
    const temperatures =
      json.hourly?.temperature_2m ?? [];
    const codes = json.hourly?.weather_code ?? [];

    if (!times.length) {
      return null;
    }

    const index = closestHourlyIndex(
      times,
      gameTime,
    );

    const temperature =
      temperatures[index] ?? null;

    const code = codes[index] ?? null;

    if (temperature == null) {
      return null;
    }

    const weather =
      weatherCodeToCondition(code);

    const dailyTimes = json.daily?.time ?? [];
    const dailyHighs =
      json.daily?.temperature_2m_max ?? [];
    const dailyLows =
      json.daily?.temperature_2m_min ?? [];

    const dailyIndex = dailyTimes.findIndex(
      (value) => value === date,
    );

    return {
      temperature: Math.round(temperature),
      condition: weather.condition,
      emoji:
        code == null
          ? dayNightEmoji(
              gameTime,
              stadium.timezone,
            )
          : weather.emoji,
      high:
        dailyIndex >= 0 &&
        dailyHighs[dailyIndex] != null
          ? Math.round(
              dailyHighs[dailyIndex]!,
            )
          : null,
      low:
        dailyIndex >= 0 &&
        dailyLows[dailyIndex] != null
          ? Math.round(
              dailyLows[dailyIndex]!,
            )
          : null,
    };
  } catch {
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
        "GamblingNFL/1.0 weather@openai.com",
    };

    const pointsUrl =
      `https://api.weather.gov/points/${stadium.lat},${stadium.lon}`;

    const pointsResponse = await fetch(
      pointsUrl,
      { headers },
    );

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
      await fetch(forecastUrl, { headers });

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

    let bestDifference = Infinity;

    for (const period of periods) {
      if (!period.startTime) continue;

      const difference = Math.abs(
        new Date(period.startTime).getTime() -
          target,
      );

      if (difference < bestDifference) {
        bestDifference = difference;
        best = period;
      }
    }

    if (best.temperature == null) {
      return null;
    }

    const shortForecast =
      best.shortForecast ?? "Unknown";

    let emoji = "☀️";

    const lower =
      shortForecast.toLowerCase();

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
      condition: shortForecast,
      emoji,
      high: null,
      low: null,
    };
  } catch {
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
    "\n========== WEATHER DIAGNOSTIC ==========",
  );

  console.log("Game ID:", gameId);
  console.log("Status:", status);
  console.log("Game Time:", gameTime);
  console.log("Home Team:", homeTeamId);
  console.log("Venue:", venue);
  console.log("Stadium:", stadium.name);
  console.log(
    "Coordinates:",
    stadium.lat,
    stadium.lon,
  );
  console.log("Timezone:", stadium.timezone);
  console.log("Indoor:", stadium.isIndoor);
  console.log(
    "Completed detected:",
    isCompleted(status),
  );
  console.log(
    "Live detected:",
    isLive(status),
  );

  if (stadium.isIndoor) {
    console.log(
      "[WEATHER DIAGNOSTIC] Indoor stadium — fetching temperature only.",
    );

    const result =
      await fetchUpcomingOpenMeteo(
        stadium,
        gameTime,
      );

    return {
      isIndoor: true,
      temperature:
        result?.temperature ?? null,
      condition: "Indoor",
      emoji: "🏟️",
      high: null,
      low: null,
    };
  }

  /*
   * COMPLETED GAME
   *
   * Try all three Open-Meteo historical sources.
   *
   * The important part of this diagnostic build is that
   * every attempt prints its exact result instead of
   * silently returning "Weather unavailable".
   */
  if (isCompleted(status)) {
    const historical =
      await fetchOpenMeteoHistorical(
        stadium,
        gameTime,
      );

    console.log(
      "[WEATHER DIAGNOSTIC] HISTORICAL RESULT:",
      historical.diagnostic,
    );

    if (historical.result) {
      console.log(
        "[WEATHER DIAGNOSTIC] Historical Forecast SUCCESS",
      );

      return {
        isIndoor: false,
        ...historical.result,
      };
    }

    const recent =
      await fetchOpenMeteoRecent(
        stadium,
        gameTime,
      );

    console.log(
      "[WEATHER DIAGNOSTIC] RECENT RESULT:",
      recent.diagnostic,
    );

    if (recent.result) {
      console.log(
        "[WEATHER DIAGNOSTIC] Recent Past Days SUCCESS",
      );

      return {
        isIndoor: false,
        ...recent.result,
      };
    }

    const archive =
      await fetchOpenMeteoArchive(
        stadium,
        gameTime,
      );

    console.log(
      "[WEATHER DIAGNOSTIC] ARCHIVE RESULT:",
      archive.diagnostic,
    );

    if (archive.result) {
      console.log(
        "[WEATHER DIAGNOSTIC] Historical Archive SUCCESS",
      );

      return {
        isIndoor: false,
        ...archive.result,
      };
    }

    /*
     * TEMPORARY DIAGNOSTIC RETURN
     *
     * This intentionally puts the failure reason
     * directly into the weather card instead of
     * hiding it behind "Weather unavailable".
     */
    console.error(
      "[WEATHER DIAGNOSTIC] ALL HISTORICAL SOURCES FAILED",
      {
        gameId,
        status,
        gameTime,
        stadium,
        historical:
          historical.diagnostic,
        recent:
          recent.diagnostic,
        archive:
          archive.diagnostic,
      },
    );

    return {
      isIndoor: false,
      temperature: null,
      condition: `DEBUG: historical failed (${String(
        historical.diagnostic.httpStatus ??
          historical.diagnostic.apiReason ??
          historical.diagnostic.networkError ??
          "no data",
      )})`,
      emoji: "⚠️",
      high: null,
      low: null,
    };
  }

  /*
   * UPCOMING / LIVE
   */

  const isInternational =
    stadium.timezone === "Europe/London" ||
    stadium.timezone === "Europe/Berlin" ||
    stadium.timezone ===
      "America/Sao_Paulo";

  if (isInternational) {
    const result =
      await fetchUpcomingOpenMeteo(
        stadium,
        gameTime,
      );

    return result
      ? {
          isIndoor: false,
          ...result,
        }
      : null;
  }

  const result =
    await fetchNwsWeather(
      stadium,
      gameTime,
    );

  if (result) {
    return {
      isIndoor: false,
      ...result,
    };
  }

  /*
   * NWS fallback.
   */
  const fallback =
    await fetchUpcomingOpenMeteo(
      stadium,
      gameTime,
    );

  return fallback
    ? {
        isIndoor: false,
        ...fallback,
      }
    : null;
}
