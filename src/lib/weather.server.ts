import { getStadiumForGame } from "./stadiums";

export interface GameWeather {
  isIndoor: boolean;
  temperature: number | null;
  high: number | null;
  low: number | null;
  condition: string;
  emoji: string;
}

interface WeatherRequest {
  gameId: string;
  homeTeamId: string;
  venue?: string;
  status: string;
  gameTime: string;
}

interface NwsPoint {
  properties?: {
    forecast?: string;
    forecastHourly?: string;
  };
}

interface NwsForecastPeriod {
  startTime?: string;
  temperature?: number;
  temperatureUnit?: string;
  shortForecast?: string;
}

interface NwsForecast {
  properties?: {
    periods?: NwsForecastPeriod[];
  };
}

interface MetTimeseriesItem {
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
      details?: {
        air_temperature_max?: number;
        air_temperature_min?: number;
      };
    };
  };
}

interface MetForecast {
  properties?: {
    timeseries?: MetTimeseriesItem[];
  };
}

interface OpenMeteoHistorical {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<
      number | null
    >;
    weather_code?: Array<
      number | null
    >;
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: Array<
      number | null
    >;
    temperature_2m_min?: Array<
      number | null
    >;
  };
}

const NWS_USER_AGENT =
  "GamblingNFL/1.0 (https://gamblingnfl.lovable.app/)";

const MET_USER_AGENT =
  "GamblingNFL/1.0 (https://gamblingnfl.lovable.app/)";

/* =========================
   GENERAL HELPERS
   ========================= */

function normalizeVenue(
  venue?: string,
): string {
  return (venue ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isCompletedStatus(
  status: string,
): boolean {
  const value =
    status.toLowerCase().trim();

  return (
    value.includes("final") ||
    value.includes("complete") ||
    value.includes("post") ||
    value === "completed"
  );
}

function getLocalDate(
  iso: string,
  timeZone: string,
): string | null {
  const date =
    new Date(iso);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).format(date);
  } catch {
    return null;
  }
}

function getLocalHour(
  iso: string,
  timeZone: string,
): number | null {
  const date =
    new Date(iso);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  try {
    const parts =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone,
          hour: "numeric",
          hour12: false,
        },
      ).formatToParts(date);

    const hourPart =
      parts.find(
        (part) =>
          part.type === "hour",
      );

    if (!hourPart) {
      return null;
    }

    let hour =
      Number(
        hourPart.value,
      );

    if (
      !Number.isFinite(hour)
    ) {
      return null;
    }

    if (hour === 24) {
      hour = 0;
    }

    return hour;
  } catch {
    return null;
  }
}

function isNight(
  iso: string,
  timeZone: string,
): boolean {
  const hour =
    getLocalHour(
      iso,
      timeZone,
    );

  if (hour === null) {
    return false;
  }

  return (
    hour >= 18 ||
    hour < 6
  );
}

function weatherEmoji(
  condition: string,
  gameTime: string,
  timeZone: string,
): string {
  const value =
    condition.toLowerCase();

  if (
    value.includes("thunder") ||
    value.includes("storm")
  ) {
    return "⛈️";
  }

  if (
    value.includes("snow") ||
    value.includes("sleet") ||
    value.includes("ice")
  ) {
    return "❄️";
  }

  if (
    value.includes("rain") ||
    value.includes("drizzle") ||
    value.includes("shower")
  ) {
    return "🌧️";
  }

  if (
    value.includes("fog") ||
    value.includes("mist")
  ) {
    return "🌫️";
  }

  const night =
    isNight(
      gameTime,
      timeZone,
    );

  if (
    value.includes("partly")
  ) {
    return night
      ? "🌙"
      : "🌤️";
  }

  if (
    value.includes("cloudy") ||
    value.includes("overcast")
  ) {
    return "☁️";
  }

  if (
    value.includes("clear") ||
    value.includes("sunny")
  ) {
    return night
      ? "🌙"
      : "☀️";
  }

  return night
    ? "🌙"
    : "🌤️";
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response =
    await fetch(
      url,
      init,
    );

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `HTTP ${response.status}: ${body.slice(
        0,
        500,
      )}`,
    );
  }

  return response.json() as Promise<T>;
}

/* =========================
   INTERNATIONAL VENUES
   ========================= */

function getInternationalVenue(
  venue?: string,
) {
  const normalized =
    normalizeVenue(venue);

  if (
    normalized.includes("tottenham")
  ) {
    return {
      latitude: 51.6043,
      longitude: -0.0664,
      timeZone: "Europe/London",
    };
  }

  if (
    normalized.includes("wembley")
  ) {
    return {
      latitude: 51.5560,
      longitude: -0.2795,
      timeZone: "Europe/London",
    };
  }

  if (
    normalized.includes("allianz") ||
    normalized.includes("munich")
  ) {
    return {
      latitude: 48.2188,
      longitude: 11.6247,
      timeZone: "Europe/Berlin",
    };
  }

  if (
    normalized.includes("corinthians") ||
    normalized.includes("neoquimica") ||
    normalized.includes("saopaulo")
  ) {
    return {
      latitude: -23.5453,
      longitude: -46.4742,
      timeZone: "America/Sao_Paulo",
    };
  }

  return null;
}

/* =========================
   STADIUM COORDINATES
   ========================= */

function getStadiumCoordinates(
  stadium: any,
): {
  latitude: number;
  longitude: number;
} | null {
  if (!stadium) {
    return null;
  }

  const latitude =
    typeof stadium.latitude ===
      "number"
      ? stadium.latitude
      : typeof stadium.lat ===
          "number"
        ? stadium.lat
        : typeof stadium.coordinates
              ?.latitude ===
            "number"
          ? stadium.coordinates.latitude
          : typeof stadium.coordinates
                ?.lat ===
              "number"
            ? stadium.coordinates.lat
            : null;

  const longitude =
    typeof stadium.longitude ===
      "number"
      ? stadium.longitude
      : typeof stadium.lon ===
          "number"
        ? stadium.lon
        : typeof stadium.lng ===
            "number"
          ? stadium.lng
          : typeof stadium.coordinates
                ?.longitude ===
              "number"
            ? stadium.coordinates.longitude
            : typeof stadium.coordinates
                  ?.lon ===
                "number"
              ? stadium.coordinates.lon
              : typeof stadium.coordinates
                    ?.lng ===
                  "number"
                ? stadium.coordinates.lng
                : null;

  if (
    typeof latitude !==
      "number" ||
    typeof longitude !==
      "number" ||
    !Number.isFinite(
      latitude,
    ) ||
    !Number.isFinite(
      longitude,
    )
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

/* =========================
   TIMEZONE
   ========================= */

function getTimeZone(
  longitude: number,
  venue?: string,
): string {
  const international =
    getInternationalVenue(
      venue,
    );

  if (international) {
    return international.timeZone;
  }

  if (longitude <= -110) {
    return "America/Los_Angeles";
  }

  if (longitude <= -100) {
    return "America/Denver";
  }

  if (longitude <= -85) {
    return "America/Chicago";
  }

  return "America/New_York";
}

/* =========================
   NWS — UPCOMING U.S.
   ========================= */

async function fetchNws(
  latitude: number,
  longitude: number,
  gameTime: string,
  timeZone: string,
): Promise<GameWeather> {
  const pointsUrl =
    `https://api.weather.gov/points/${latitude},${longitude}`;

  const points =
    await fetchJson<NwsPoint>(
      pointsUrl,
      {
        headers: {
          "User-Agent":
            NWS_USER_AGENT,
          Accept:
            "application/geo+json",
        },
      },
    );

  const forecastUrl =
    points.properties
      ?.forecastHourly ??
    points.properties?.forecast;

  if (!forecastUrl) {
    throw new Error(
      "NWS did not return a forecast URL",
    );
  }

  const forecast =
    await fetchJson<NwsForecast>(
      forecastUrl,
      {
        headers: {
          "User-Agent":
            NWS_USER_AGENT,
          Accept:
            "application/geo+json",
        },
      },
    );

  const periods =
    forecast.properties
      ?.periods ?? [];

  if (!periods.length) {
    throw new Error(
      "NWS returned no forecast periods",
    );
  }

  const target =
    new Date(
      gameTime,
    ).getTime();

  let selected =
    periods[0];

  let closest =
    Infinity;

  for (
    const period of periods
  ) {
    if (!period.startTime) {
      continue;
    }

    const distance =
      Math.abs(
        new Date(
          period.startTime,
        ).getTime() -
          target,
      );

    if (
      distance <
      closest
    ) {
      closest =
        distance;

      selected =
        period;
    }
  }

  const temperature =
    typeof selected.temperature ===
      "number"
      ? selected.temperature
      : null;

  const condition =
    selected.shortForecast ??
    "Weather unavailable";

  const gameDate =
    getLocalDate(
      gameTime,
      timeZone,
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
            timeZone,
          ) === gameDate
        );
      },
    );

  const temps =
    sameDay
      .map(
        (period) =>
          typeof period.temperature ===
          "number"
            ? period.temperature
            : null,
      )
      .filter(
        (
          value,
        ): value is number =>
          typeof value ===
          "number",
      );

  return {
    isIndoor: false,
    temperature,
    high: temps.length
      ? Math.max(...temps)
      : null,
    low: temps.length
      ? Math.min(...temps)
      : null,
    condition,
    emoji:
      weatherEmoji(
        condition,
        gameTime,
        timeZone,
      ),
  };
}

/* =========================
   MET NORWAY — INTERNATIONAL
   ========================= */

async function fetchMet(
  latitude: number,
  longitude: number,
  gameTime: string,
  timeZone: string,
): Promise<GameWeather> {
  const url =
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude}&lon=${longitude}`;

  const forecast =
    await fetchJson<MetForecast>(
      url,
      {
        headers: {
          "User-Agent":
            MET_USER_AGENT,
          Accept:
            "application/json",
        },
      },
    );

  const timeseries =
    forecast.properties
      ?.timeseries ?? [];

  if (!timeseries.length) {
    throw new Error(
      "MET Norway returned no forecast data",
    );
  }

  const target =
    new Date(
      gameTime,
    ).getTime();

  let selected =
    timeseries[0];

  let closest =
    Infinity;

  for (
    const item of timeseries
  ) {
    const distance =
      Math.abs(
        new Date(
          item.time,
        ).getTime() -
          target,
      );

    if (
      distance <
      closest
    ) {
      closest =
        distance;

      selected =
        item;
    }
  }

  const temperatureC =
    selected.data
      ?.instant
      ?.details
      ?.air_temperature;

  const temperature =
    typeof temperatureC ===
      "number"
      ? Math.round(
          (temperatureC * 9) / 5 +
            32,
        )
      : null;

  const symbol =
    selected.data
      ?.next_1_hours
      ?.summary
      ?.symbol_code;

  let condition =
    "Weather unavailable";

  if (symbol) {
    const s =
      symbol.toLowerCase();

    if (
      s.includes("thunder")
    ) {
      condition =
        "Thunderstorms";
    } else if (
      s.includes("snow") ||
      s.includes("sleet")
    ) {
      condition = "Snow";
    } else if (
      s.includes("rain") ||
      s.includes("drizzle")
    ) {
      condition = "Rain";
    } else if (
      s.includes("fog")
    ) {
      condition = "Fog";
    } else if (
      s.includes("clearsky")
    ) {
      condition = "Clear";
    } else if (
      s.includes("fair")
    ) {
      condition =
        "Mostly Clear";
    } else if (
      s.includes("partlycloudy")
    ) {
      condition =
        "Partly Cloudy";
    } else if (
      s.includes("cloudy")
    ) {
      condition = "Cloudy";
    }
  }

  const gameDate =
    getLocalDate(
      gameTime,
      timeZone,
    );

  const sameDay =
    timeseries.filter(
      (item) =>
        getLocalDate(
          item.time,
          timeZone,
        ) === gameDate,
    );

  const temps: number[] = [];

  for (
    const item of sameDay
  ) {
    const instant =
      item.data
        ?.instant
        ?.details
        ?.air_temperature;

    if (
      typeof instant ===
      "number"
    ) {
      temps.push(
        Math.round(
          (instant * 9) / 5 +
            32,
        ),
      );
    }

    const max =
      item.data
        ?.next_6_hours
        ?.details
        ?.air_temperature_max;

    const min =
      item.data
        ?.next_6_hours
        ?.details
        ?.air_temperature_min;

    if (
      typeof max ===
      "number"
    ) {
      temps.push(
        Math.round(
          (max * 9) / 5 +
            32,
        ),
      );
    }

    if (
      typeof min ===
      "number"
    ) {
      temps.push(
        Math.round(
          (min * 9) / 5 +
            32,
        ),
      );
    }
  }

  return {
    isIndoor: false,
    temperature,
    high: temps.length
      ? Math.max(...temps)
      : temperature,
    low: temps.length
      ? Math.min(...temps)
      : temperature,
    condition,
    emoji:
      weatherEmoji(
        condition,
        gameTime,
        timeZone,
      ),
  };
}

/* =========================
   OPEN-METEO — HISTORICAL
   ========================= */

function openMeteoCondition(
  weatherCode: number | null,
): string {
  if (
    weatherCode === null
  ) {
    return "Weather unavailable";
  }

  if (
    weatherCode === 0
  ) {
    return "Clear";
  }

  if (
    weatherCode === 1 ||
    weatherCode === 2
  ) {
    return "Partly Cloudy";
  }

  if (
    weatherCode === 3
  ) {
    return "Overcast";
  }

  if (
    weatherCode === 45 ||
    weatherCode === 48
  ) {
    return "Fog";
  }

  if (
    weatherCode >= 51 &&
    weatherCode <= 57
  ) {
    return "Drizzle";
  }

  if (
    weatherCode >= 61 &&
    weatherCode <= 67
  ) {
    return "Rain";
  }

  if (
    weatherCode >= 71 &&
    weatherCode <= 77
  ) {
    return "Snow";
  }

  if (
    weatherCode >= 80 &&
    weatherCode <= 82
  ) {
    return "Rain Showers";
  }

  if (
    weatherCode === 85 ||
    weatherCode === 86
  ) {
    return "Snow Showers";
  }

  if (
    weatherCode >= 95
  ) {
    return "Thunderstorms";
  }

  return "Weather unavailable";
}

async function fetchHistoricalOpenMeteo(
  latitude: number,
  longitude: number,
  gameTime: string,
  timeZone: string,
): Promise<GameWeather> {
  const localDate =
    getLocalDate(
      gameTime,
      timeZone,
    );

  if (!localDate) {
    throw new Error(
      "Could not determine historical weather date",
    );
  }

  /*
   * Open-Meteo's historical API supports
   * named IANA timezones. Requesting the
   * stadium's timezone means the returned
   * hourly timestamps are local stadium time.
   */
  const params =
    new URLSearchParams();

  params.set(
    "latitude",
    latitude.toString(),
  );

  params.set(
    "longitude",
    longitude.toString(),
  );

  params.set(
    "start_date",
    localDate,
  );

  params.set(
    "end_date",
    localDate,
  );

  params.set(
    "hourly",
    "temperature_2m,weather_code",
  );

  params.set(
    "daily",
    "temperature_2m_max,temperature_2m_min",
  );

  params.set(
    "temperature_unit",
    "fahrenheit",
  );

  params.set(
    "timezone",
    timeZone,
  );

  params.set(
    "models",
    "era5",
  );

  const url =
    `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`;

  const weather =
    await fetchJson<OpenMeteoHistorical>(
      url,
      {
        headers: {
          Accept:
            "application/json",
        },
      },
    );

  const hourlyTimes =
    weather.hourly
      ?.time ?? [];

  const temperatures =
    weather.hourly
      ?.temperature_2m ?? [];

  const weatherCodes =
    weather.hourly
      ?.weather_code ?? [];

  if (
    !hourlyTimes.length ||
    !temperatures.length
  ) {
    throw new Error(
      `Open-Meteo returned no historical hourly data for ${localDate}`,
    );
  }

  /*
   * gameTime is an absolute timestamp.
   * Convert it to the same local clock
   * representation used by Open-Meteo.
   */
  const gameLocalDateTime =
    new Intl.DateTimeFormat(
      "sv-SE",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      },
    )
      .format(
        new Date(gameTime),
      )
      .replace(" ", "T");

  let selectedIndex =
    0;

  let closest =
    Infinity;

  for (
    let i = 0;
    i < hourlyTimes.length;
    i++
  ) {
    const timestamp =
      hourlyTimes[i];

    if (!timestamp) {
      continue;
    }

    const distance =
      Math.abs(
        new Date(
          `${timestamp}:00`,
        ).getTime() -
          new Date(
            `${gameLocalDateTime}:00`,
          ).getTime(),
      );

    if (
      distance <
      closest
    ) {
      closest =
        distance;

      selectedIndex =
        i;
    }
  }

  const temperature =
    typeof temperatures[
      selectedIndex
    ] === "number"
      ? Math.round(
          temperatures[
            selectedIndex
          ] as number,
        )
      : null;

  const weatherCode =
    typeof weatherCodes[
      selectedIndex
    ] === "number"
      ? (weatherCodes[
          selectedIndex
        ] as number)
      : null;

  const condition =
    openMeteoCondition(
      weatherCode,
    );

  const dailyMax =
    weather.daily
      ?.temperature_2m_max?.[0];

  const dailyMin =
    weather.daily
      ?.temperature_2m_min?.[0];

  return {
    isIndoor: false,
    temperature,
    high:
      typeof dailyMax ===
      "number"
        ? Math.round(
            dailyMax,
          )
        : null,
    low:
      typeof dailyMin ===
      "number"
        ? Math.round(
            dailyMin,
          )
        : null,
    condition,
    emoji:
      weatherEmoji(
        condition,
        gameTime,
        timeZone,
      ),
  };
}

/* =========================
   MAIN WEATHER FUNCTION
   ========================= */

export async function fetchGameWeather(
  data: WeatherRequest,
): Promise<GameWeather> {
  const {
    homeTeamId,
    venue,
    status,
    gameTime,
  } = data;

  /*
   * INTERNATIONAL VENUE FIRST
   *
   * A U.S. team can be the designated
   * home team in London/Munich/etc.
   */
  const international =
    getInternationalVenue(
      venue,
    );

  if (international) {
    /*
     * COMPLETED INTERNATIONAL
     * → Open-Meteo historical
     */
    if (
      isCompletedStatus(
        status,
      )
    ) {
      return fetchHistoricalOpenMeteo(
        international.latitude,
        international.longitude,
        gameTime,
        international.timeZone,
      );
    }

    /*
     * UPCOMING / LIVE INTERNATIONAL
     * → MET Norway
     */
    return fetchMet(
      international.latitude,
      international.longitude,
      gameTime,
      international.timeZone,
    );
  }

  /*
   * U.S. STADIUM
   */
  const stadium =
    getStadiumForGame(
      homeTeamId,
      venue,
    );

  /*
   * INDOOR / CLIMATE CONTROLLED
   */
  if (
    stadium?.isIndoor
  ) {
    return {
      isIndoor: true,
      temperature: 72,
      high: null,
      low: null,
      condition: "Indoor",
      emoji: "🏟️",
    };
  }

  const coordinates =
    getStadiumCoordinates(
      stadium,
    );

  if (!coordinates) {
    throw new Error(
      `No valid coordinates for stadium/home team ${homeTeamId}`,
    );
  }

  const timeZone =
    stadium?.timezone ??
    getTimeZone(
      coordinates.longitude,
      venue,
    );

  /*
   * COMPLETED U.S. GAMES
   * → Open-Meteo historical
   */
  if (
    isCompletedStatus(
      status,
    )
  ) {
    return fetchHistoricalOpenMeteo(
      coordinates.latitude,
      coordinates.longitude,
      gameTime,
      timeZone,
    );
  }

  /*
   * UPCOMING / LIVE U.S. GAMES
   * → NWS
   */
  return fetchNws(
    coordinates.latitude,
    coordinates.longitude,
    gameTime,
    timeZone,
  );
}
