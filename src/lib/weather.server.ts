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
}

interface EspnSummary {
  header?: {
    competitions?: Array<{
      date?: string;
      venue?: {
        fullName?: string;
      };
    }>;
  };
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

interface IemObservation {
  valid?: string;
  tmpf?: string | number | null;
  wxcodes?: string | null;
  skyc1?: string | null;
  skyc2?: string | null;
  skyc3?: string | null;
  skyc4?: string | null;
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
  };
}

interface MetForecast {
  properties?: {
    timeseries?: MetTimeseriesItem[];
  };
}

const NWS_USER_AGENT =
  "GamblingNFL/1.0 (gamblingnfl.lovable.app)";

const MET_USER_AGENT =
  "GamblingNFL/1.0 (https://gamblingnfl.lovable.app/)";

function celsiusToFahrenheit(
  celsius: number,
): number {
  return Math.round(
    (celsius * 9) / 5 + 32,
  );
}

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
    status.toLowerCase();

  return (
    value.includes("final") ||
    value.includes("complete") ||
    value.includes("post") ||
    value === "completed"
  );
}

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
      longitude: -0.0661,
      timeZone: "Europe/London",
      iemStation: "EGLC",
    };
  }

  if (
    normalized.includes("wembley")
  ) {
    return {
      latitude: 51.556,
      longitude: -0.2796,
      timeZone: "Europe/London",
      iemStation: "EGLL",
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
      iemStation: "EDDM",
    };
  }

  if (
    normalized.includes("corinthians") ||
    normalized.includes("neoquimica") ||
    normalized.includes("saopaulo")
  ) {
    return {
      latitude: -23.5456,
      longitude: -46.4748,
      timeZone: "America/Sao_Paulo",
      iemStation: "SBSP",
    };
  }

  return null;
}

function getStadiumCoordinates(
  stadium: any,
) {
  if (!stadium) {
    return null;
  }

  const latitude =
    typeof stadium.latitude === "number"
      ? stadium.latitude
      : typeof stadium.lat === "number"
        ? stadium.lat
        : typeof stadium.coordinates?.latitude ===
            "number"
          ? stadium.coordinates.latitude
          : typeof stadium.coordinates?.lat ===
              "number"
            ? stadium.coordinates.lat
            : null;

  const longitude =
    typeof stadium.longitude === "number"
      ? stadium.longitude
      : typeof stadium.lon === "number"
        ? stadium.lon
        : typeof stadium.lng === "number"
          ? stadium.lng
          : typeof stadium.coordinates?.longitude ===
              "number"
            ? stadium.coordinates.longitude
            : typeof stadium.coordinates?.lon ===
                "number"
              ? stadium.coordinates.lon
              : typeof stadium.coordinates?.lng ===
                  "number"
                ? stadium.coordinates.lng
                : null;

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function getTimeZone(
  longitude: number,
  venue?: string,
): string {
  const international =
    getInternationalVenue(venue);

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

/*
 * IMPORTANT:
 * Do NOT silently swallow ESPN errors.
 *
 * If ESPN fails, we need to know exactly why.
 */
async function fetchEspnSummary(
  gameId: string,
): Promise<EspnSummary> {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(
      gameId,
    )}`;

  try {
    return await fetchJson<EspnSummary>(
      url,
    );
  } catch (error) {
    throw new Error(
      `ESPN WEATHER SUMMARY FAILED: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}

function getGameTime(
  summary: EspnSummary,
): string {
  const date =
    summary
      .header
      ?.competitions?.[0]
      ?.date;

  if (!date) {
    throw new Error(
      "ESPN WEATHER: game start time missing",
    );
  }

  return date;
}

function getSummaryVenue(
  summary: EspnSummary,
): string | undefined {
  return (
    summary
      .header
      ?.competitions?.[0]
      ?.venue
      ?.fullName
  );
}

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
    points.properties
      ?.forecast;

  if (!forecastUrl) {
    throw new Error(
      "NWS WEATHER: forecast URL missing",
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
      "NWS WEATHER: no forecast periods",
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

  const sameDay =
    periods.filter(
      (period) => {
        if (!period.startTime) {
          return false;
        }

        const a =
          new Intl.DateTimeFormat(
            "en-CA",
            {
              timeZone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            },
          ).format(
            new Date(
              period.startTime,
            ),
          );

        const b =
          new Intl.DateTimeFormat(
            "en-CA",
            {
              timeZone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            },
          ).format(
            new Date(
              gameTime,
            ),
          );

        return a === b;
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
      "MET WEATHER: no forecast data",
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
      ? celsiusToFahrenheit(
          temperatureC,
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

    if (s.includes("thunder")) {
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

  return {
    isIndoor: false,
    temperature,
    high: temperature,
    low: temperature,
    condition,
    emoji:
      weatherEmoji(
        condition,
        gameTime,
        timeZone,
      ),
  };
}

async function fetchIem(
  station: string,
  gameTime: string,
  timeZone: string,
): Promise<GameWeather> {
  const gameDate =
    new Date(gameTime);

  if (
    Number.isNaN(
      gameDate.getTime(),
    )
  ) {
    throw new Error(
      "IEM WEATHER: invalid game time",
    );
  }

  const localDate =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).format(gameDate);

  const [
    year,
    month,
    day,
  ] =
    localDate
      .split("-")
      .map(Number);

  const nextDay =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + 1,
      ),
    );

  const url =
    `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${encodeURIComponent(
      station,
    )}&data=tmpf&data=wxcodes&data=skyc1&data=skyc2&data=skyc3&data=skyc4&year1=${year}&month1=${month}&day1=${day}&year2=${nextDay.getUTCFullYear()}&month2=${nextDay.getUTCMonth() + 1}&day2=${nextDay.getUTCDate()}&tz=UTC&format=json&latlon=no&elev=no&missing=M&trace=T&report_type=3&report_type=4`;

  const response =
    await fetch(
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

  if (!response.ok) {
    throw new Error(
      `IEM WEATHER HTTP ${response.status}`,
    );
  }

  const data =
    (await response.json()) as {
      data?: IemObservation[];
    };

  const observations =
    data.data ?? [];

  if (!observations.length) {
    throw new Error(
      `IEM WEATHER: no observations for ${station} on ${localDate}`,
    );
  }

  const target =
    gameDate.getTime();

  let selected =
    observations[0];

  let closest =
    Infinity;

  for (
    const observation of observations
  ) {
    if (!observation.valid) {
      continue;
    }

    const distance =
      Math.abs(
        new Date(
          observation.valid,
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
        observation;
    }
  }

  const temperature =
    typeof selected.tmpf ===
      "number"
      ? Math.round(
          selected.tmpf,
        )
      : typeof selected.tmpf ===
            "string"
        ? Math.round(
            Number(
              selected.tmpf,
            ),
          )
        : null;

  let condition =
    "Weather unavailable";

  const wx =
    (
      selected.wxcodes ??
      ""
    ).toLowerCase();

  if (
    wx.includes("ts") ||
    wx.includes("thunder")
  ) {
    condition =
      "Thunderstorms";
  } else if (
    wx.includes("sn") ||
    wx.includes("snow")
  ) {
    condition = "Snow";
  } else if (
    wx.includes("ra") ||
    wx.includes("rain") ||
    wx.includes("sh")
  ) {
    condition = "Rain";
  } else if (
    wx.includes("fg") ||
    wx.includes("fog") ||
    wx.includes("br")
  ) {
    condition = "Fog";
  } else {
    const sky = [
      selected.skyc1,
      selected.skyc2,
      selected.skyc3,
      selected.skyc4,
    ]
      .filter(Boolean)
      .map(
        (x) =>
          x!.toUpperCase(),
      );

    if (
      sky.includes("OVC")
    ) {
      condition =
        "Overcast";
    } else if (
      sky.includes("BKN") ||
      sky.includes("SCT")
    ) {
      condition =
        "Partly Cloudy";
    } else if (
      sky.includes("CLR") ||
      sky.includes("SKC") ||
      sky.includes("FEW")
    ) {
      condition = "Clear";
    }
  }

  const temps =
    observations
      .map(
        (observation) => {
          if (
            typeof observation.tmpf ===
            "number"
          ) {
            return observation.tmpf;
          }

          if (
            typeof observation.tmpf ===
              "string" &&
            observation.tmpf !== ""
          ) {
            const n =
              Number(
                observation.tmpf,
              );

            return Number.isFinite(
              n,
            )
              ? n
              : null;
          }

          return null;
        },
      )
      .filter(
        (
          x,
        ): x is number =>
          typeof x ===
            "number" &&
          Number.isFinite(x),
      );

  return {
    isIndoor: false,
    temperature,
    high: temps.length
      ? Math.round(
          Math.max(...temps),
        )
      : null,
    low: temps.length
      ? Math.round(
          Math.min(...temps),
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

function getIemStation(
  teamId: string,
): string | null {
  const stations: Record<
    string,
    string
  > = {
    "1": "KPHI",
    "2": "KDAL",
    "3": "KDEN",
    "4": "KJAX",
    "5": "KIND",
    "6": "KBUF",
    "7": "KCAR",
    "8": "KCHI",
    "9": "KCLE",
    "10": "KCMH",
    "11": "KCIN",
    "12": "KDET",
    "13": "KGBR",
    "14": "KHOU",
    "15": "KJAX",
    "16": "KANS",
    "17": "KPHX",
    "18": "KSEA",
    "19": "KTBM",
    "20": "KMSY",
    "21": "KMIA",
    "22": "KMSP",
    "23": "KNEV",
    "24": "KNYC",
    "25": "KJFK",
    "26": "KORF",
    "27": "KPIT",
    "28": "KSFO",
    "29": "KSTL",
    "30": "KSEA",
    "31": "KTBN",
    "32": "KCLT",
  };

  return (
    stations[teamId] ??
    null
  );
}

export async function fetchGameWeather(
  data: WeatherRequest,
): Promise<GameWeather> {
  try {
    const summary =
      await fetchEspnSummary(
        data.gameId,
      );

    const gameTime =
      getGameTime(
        summary,
      );

    const summaryVenue =
      getSummaryVenue(
        summary,
      );

    const actualVenue =
      data.venue ??
      summaryVenue;

    /*
     * INTERNATIONAL FIRST
     */
    const international =
      getInternationalVenue(
        actualVenue,
      );

    if (international) {
      if (
        isCompletedStatus(
          data.status,
        )
      ) {
        return await fetchIem(
          international.iemStation,
          gameTime,
          international.timeZone,
        );
      }

      return await fetchMet(
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
        data.homeTeamId,
        actualVenue,
      );

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
        `STADIUM WEATHER: invalid coordinates for home team ${data.homeTeamId}`,
      );
    }

    const timeZone =
      getTimeZone(
        coordinates.longitude,
        actualVenue,
      );

    if (
      isCompletedStatus(
        data.status,
      )
    ) {
      const station =
        getIemStation(
          data.homeTeamId,
        );

      if (!station) {
        throw new Error(
          `IEM WEATHER: no station for home team ${data.homeTeamId}`,
        );
      }

      return await fetchIem(
        station,
        gameTime,
        timeZone,
      );
    }

    return await fetchNws(
      coordinates.latitude,
      coordinates.longitude,
      gameTime,
      timeZone,
    );
  } catch (error) {
    /*
     * THIS IS TEMPORARY AND INTENTIONAL.
     *
     * Instead of returning null and making the UI say
     * "Weather unavailable", expose the actual failure.
     */
    throw new Error(
      `WEATHER DEBUG: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}
