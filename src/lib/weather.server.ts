import { getStadiumForGame } from "./stadiums";

export interface GameWeather {
  isIndoor: boolean;
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
  capturedAt: string;
}

interface EspnGameInfo {
  startTime: string | null;
  endTime: string | null;
  completed: boolean;
}

interface NwsPointData {
  properties?: {
    forecast?: string;
    forecastHourly?: string;
    observationStations?: string;
    timeZone?: string;
  };
}

interface NwsStationList {
  features?: Array<{
    properties?: {
      stationIdentifier?: string;
      stationName?: string;
    };
  }>;
}

interface NwsObservation {
  properties?: {
    timestamp?: string;
    temperature?: {
      value?: number | null;
    };
    textDescription?: string | null;
  };
}

interface NwsForecast {
  properties?: {
    periods?: Array<{
      startTime?: string;
      endTime?: string;
      isDaytime?: boolean;
      temperature?: number | null;
      shortForecast?: string;
    }>;
  };
}

const FETCH_TIMEOUT_MS = 12000;

function timeoutSignal(ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, ms);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const { signal, cleanup } = timeoutSignal();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal,
    });

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `HTTP ${response.status}: ${text.slice(0, 300)}`,
      );
    }

    return (await response.json()) as T;
  } finally {
    cleanup();
  }
}

/*
 * ESPN's normal game APIs do not provide usable weather for these pages,
 * but ESPN does provide the actual game start information.
 *
 * We use that timestamp to select the historical weather observation.
 */
async function fetchEspnGameInfo(
  gameId: string,
): Promise<EspnGameInfo> {
  const eventId =
    gameId.replace(/^espn-/, "");

  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(
      eventId,
    )}`;

  try {
    const data =
      await fetchJson<any>(url, {
        Accept: "application/json",
      });

    const competition =
      data?.header?.competitions?.[0];

    const status =
      competition?.status;

    const startTime =
      competition?.date ??
      data?.header?.competitions?.[0]?.date ??
      data?.gameInfo?.date ??
      null;

    const endTime =
      status?.endDate ??
      status?.endTime ??
      data?.gameInfo?.endDate ??
      null;

    const completed =
      Boolean(
        status?.type?.completed ||
        status?.type?.name === "STATUS_FINAL",
      );

    return {
      startTime:
        typeof startTime === "string"
          ? startTime
          : null,
      endTime:
        typeof endTime === "string"
          ? endTime
          : null,
      completed,
    };
  } catch (error) {
    console.error(
      "[WEATHER] ESPN game info failed:",
      error,
    );

    return {
      startTime: null,
      endTime: null,
      completed: false,
    };
  }
}

/*
 * ESPN team IDs -> IANA time zones.
 *
 * This lets us calculate the historical daily high/low using
 * the stadium's actual local calendar day rather than UTC.
 */
const TEAM_TIME_ZONES: Record<string, string> = {
  "1": "America/New_York", // ATL
  "2": "America/New_York", // BUF
  "3": "America/Chicago", // CHI
  "4": "America/New_York", // CIN
  "5": "America/New_York", // CLE
  "6": "America/Chicago", // DAL
  "7": "America/Denver", // DEN
  "8": "America/New_York", // DET
  "9": "America/New_York", // GB
  "10": "America/Chicago", // TEN
  "11": "America/New_York", // IND
  "12": "America/Chicago", // KC
  "13": "America/Los_Angeles", // LV
  "14": "America/Los_Angeles", // LAR
  "15": "America/New_York", // MIA
  "16": "America/Chicago", // MIN
  "17": "America/New_York", // NE
  "18": "America/Chicago", // NO
  "19": "America/New_York", // NYG
  "20": "America/New_York", // NYJ
  "21": "America/New_York", // PHI
  "22": "America/Phoenix", // ARI
  "23": "America/New_York", // PIT
  "24": "America/Los_Angeles", // LAC
  "25": "America/Los_Angeles", // SF
  "26": "America/Los_Angeles", // SEA
  "27": "America/New_York", // TB
  "28": "America/New_York", // WAS
  "29": "America/New_York", // CAR
  "30": "America/New_York", // JAX
  "33": "America/New_York", // BAL
  "34": "America/Chicago", // HOU
};

function getTimeZone(
  homeTeamId: string,
  venue?: string,
): string {
  const venueLower =
    (venue ?? "").toLowerCase();

  if (
    venueLower.includes("tottenham") ||
    venueLower.includes("wembley") ||
    venueLower.includes("london")
  ) {
    return "Europe/London";
  }

  if (
    venueLower.includes("allianz") ||
    venueLower.includes("munich")
  ) {
    return "Europe/Berlin";
  }

  if (
    venueLower.includes("sao") ||
    venueLower.includes("paulo")
  ) {
    return "America/Sao_Paulo";
  }

  return (
    TEAM_TIME_ZONES[homeTeamId] ??
    "America/Chicago"
  );
}

function getLocalDate(
  isoTime: string,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date(isoTime));
}

/*
 * IEM station closest to each NFL stadium.
 *
 * These are airport ASOS/METAR stations, which are the standard
 * automated surface observations used for historical weather.
 *
 * International games use their primary nearby airport station.
 */
const STADIUM_STATIONS: Record<
  string,
  string
> = {
  "1": "KATL",
  "2": "KBUF",
  "3": "KORD",
  "4": "KLUK",
  "5": "KCLE",
  "6": "KDFW",
  "7": "KDEN",
  "8": "KDTW",
  "9": "KGRB",
  "10": "KBNA",
  "11": "KIND",
  "12": "KMCI",
  "13": "KLAS",
  "14": "KLAX",
  "15": "KMIA",
  "16": "KMSP",
  "17": "KBOS",
  "18": "KMSY",
  "19": "KTEB",
  "20": "KTEB",
  "21": "KPHL",
  "22": "KPHX",
  "23": "KPIT",
  "24": "KLAX",
  "25": "KSFO",
  "26": "KSEA",
  "27": "KTPA",
  "28": "KDCA",
  "29": "KCLT",
  "30": "KJAX",
  "33": "KBWI",
  "34": "KHOU",

  // International NFL games
  "TOTTENHAM": "EGLL",
  "WEMBLEY": "EGLL",
  "ALLIANZ": "EDDM",
  "SAOPAULO": "SBGR",
};

function getHistoricalStation(
  homeTeamId: string,
  venue?: string,
): string {
  const venueUpper =
    (venue ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  if (
    venueUpper.includes("TOTTENHAM") ||
    venueUpper.includes("WEMBLEY") ||
    venueUpper.includes("LONDON")
  ) {
    return "EGLL";
  }

  if (
    venueUpper.includes("ALLIANZ") ||
    venueUpper.includes("MUNICH")
  ) {
    return "EDDM";
  }

  if (
    venueUpper.includes("SAO") ||
    venueUpper.includes("PAULO")
  ) {
    return "SBGR";
  }

  return (
    STADIUM_STATIONS[homeTeamId] ??
    "KORD"
  );
}

function celsiusToFahrenheit(
  value: number,
): number {
  return (
    (value * 9) / 5 + 32
  );
}

function roundTemperature(
  value: number,
): number {
  return Math.round(value);
}

function weatherEmoji(
  condition: string,
): string {
  const lower =
    condition.toLowerCase();

  if (
    lower.includes("thunder") ||
    lower.includes("t-storm")
  ) {
    return "⛈️";
  }

  if (
    lower.includes("snow") ||
    lower.includes("sleet") ||
    lower.includes("ice")
  ) {
    return "❄️";
  }

  if (
    lower.includes("rain") ||
    lower.includes("shower") ||
    lower.includes("drizzle")
  ) {
    return "🌧️";
  }

  if (
    lower.includes("fog") ||
    lower.includes("mist")
  ) {
    return "🌫️";
  }

  if (
    lower.includes("cloud") ||
    lower.includes("overcast")
  ) {
    return "☁️";
  }

  if (
    lower.includes("partly") ||
    lower.includes("mostly sunny") ||
    lower.includes("mostly clear")
  ) {
    return "🌤️";
  }

  if (
    lower.includes("clear") ||
    lower.includes("sunny")
  ) {
    return "☀️";
  }

  return "🌤️";
}

/*
 * Convert an IEM METAR weather-code string into a readable
 * condition for the card.
 */
function iemCondition(
  row: Record<string, string>,
): string {
  const wx =
    String(
      row.wxcodes ??
        row.present_weather ??
        "",
    ).trim();

  if (!wx) {
    const sky =
      String(
        row.skyc1 ??
          "",
      ).toLowerCase();

    if (sky.includes("overcast")) {
      return "Overcast";
    }

    if (
      sky.includes("broken") ||
      sky.includes("few") ||
      sky.includes("scattered")
    ) {
      return "Partly Cloudy";
    }

    return "Clear";
  }

  const lower =
    wx.toLowerCase();

  if (
    lower.includes("ts") ||
    lower.includes("thunder")
  ) {
    return "Thunderstorms";
  }

  if (
    lower.includes("sn") ||
    lower.includes("snow")
  ) {
    return "Snow";
  }

  if (
    lower.includes("fz") ||
    lower.includes("ice")
  ) {
    return "Freezing";
  }

  if (
    lower.includes("ra") ||
    lower.includes("rain")
  ) {
    return "Rain";
  }

  if (
    lower.includes("dz") ||
    lower.includes("drizzle")
  ) {
    return "Drizzle";
  }

  if (
    lower.includes("fg") ||
    lower.includes("fog")
  ) {
    return "Fog";
  }

  if (
    lower.includes("br") ||
    lower.includes("mist")
  ) {
    return "Mist";
  }

  return "Clear";
}

function parseIemCsv(
  text: string,
): Array<Record<string, string>> {
  const lines =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headerIndex =
    lines.findIndex((line) =>
      line
        .toLowerCase()
        .startsWith("station,"),
    );

  if (headerIndex < 0) {
    return [];
  }

  const headers =
    lines[headerIndex]
      .split(",")
      .map((value) =>
        value.trim(),
      );

  const rows:
    Array<Record<string, string>> = [];

  for (
    let i = headerIndex + 1;
    i < lines.length;
    i += 1
  ) {
    const values =
      lines[i].split(",");

    if (
      values.length <
      headers.length
    ) {
      continue;
    }

    const row:
      Record<string, string> = {};

    headers.forEach(
      (header, index) => {
        row[header] =
          values[index]?.trim() ?? "";
      },
    );

    rows.push(row);
  }

  return rows;
}

/*
 * Historical IEM observation lookup.
 *
 * We request a compact window around the game date rather than
 * downloading a large historical file.
 */
async function fetchHistoricalIemWeather(
  station: string,
  gameTime: string,
  timeZone: string,
): Promise<GameWeather | null> {
  const gameDate =
    getLocalDate(
      gameTime,
      timeZone,
    );

  /*
   * Request the local calendar day plus a small amount of padding.
   * IEM accepts explicit UTC timestamps using sts/ets.
   */
  const dayStart =
    new Date(
      `${gameDate}T00:00:00`,
    );

  const startUtc =
    new Date(
      dayStart.getTime() -
        6 * 60 * 60 * 1000,
    );

  const endUtc =
    new Date(
      dayStart.getTime() +
        30 * 60 * 60 * 1000,
    );

  const url =
    new URL(
      "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py",
    );

  url.searchParams.set(
    "station",
    station,
  );

  url.searchParams.set(
    "data",
    "tmpf,wxcodes,skyc1",
  );

  url.searchParams.set(
    "sts",
    startUtc.toISOString(),
  );

  url.searchParams.set(
    "ets",
    endUtc.toISOString(),
  );

  url.searchParams.set(
    "tz",
    "Etc/UTC",
  );

  url.searchParams.set(
    "format",
    "onlycomma",
  );

  url.searchParams.set(
    "latlon",
    "no",
  );

  url.searchParams.set(
    "elev",
    "no",
  );

  url.searchParams.set(
    "missing",
    "M",
  );

  url.searchParams.set(
    "trace",
    "T",
  );

  url.searchParams.set(
    "report_type",
    "3",
  );

  url.searchParams.set(
    "report_type",
    "4",
  );

  const response =
    await fetch(
      url.toString(),
      {
        headers: {
          Accept:
            "text/csv,text/plain,*/*",
        },
        signal:
          AbortSignal.timeout(
            FETCH_TIMEOUT_MS,
          ),
      },
    );

  if (!response.ok) {
    throw new Error(
      `IEM HTTP ${response.status}`,
    );
  }

  const text =
    await response.text();

  const rows =
    parseIemCsv(text);

  if (rows.length === 0) {
    return null;
  }

  const validRows =
    rows
      .map((row) => {
        const temperature =
          Number.parseFloat(
            row.tmpf ?? "",
          );

        const timestamp =
          row.valid ?? "";

        return {
          row,
          temperature:
            Number.isFinite(
              temperature,
            )
              ? temperature
              : null,
          timestamp,
        };
      })
      .filter(
        (item) =>
          item.temperature !== null &&
          Boolean(item.timestamp),
      );

  if (validRows.length === 0) {
    return null;
  }

  /*
   * Find the observation closest to kickoff.
   *
   * This is intentionally based on the actual game start time,
   * not when the user happens to open the page.
   */
  const gameMs =
    new Date(
      gameTime,
    ).getTime();

  let closest =
    validRows[0];

  let closestDistance =
    Number.POSITIVE_INFINITY;

  for (
    const item of validRows
  ) {
    const observationMs =
      new Date(
        item.timestamp,
      ).getTime();

    const distance =
      Math.abs(
        observationMs -
          gameMs,
      );

    if (
      distance <
      closestDistance
    ) {
      closest =
        item;

      closestDistance =
        distance;
    }
  }

  const localRows =
    validRows.filter(
      (item) =>
        getLocalDate(
          item.timestamp,
          timeZone,
        ) === gameDate,
    );

  const dayRows =
    localRows.length > 0
      ? localRows
      : validRows;

  const temperatures =
    dayRows
      .map(
        (item) =>
          item.temperature,
      )
      .filter(
        (
          value,
        ): value is number =>
          value !== null,
      );

  const high =
    temperatures.length > 0
      ? Math.max(
          ...temperatures,
        )
      : null;

  const low =
    temperatures.length > 0
      ? Math.min(
          ...temperatures,
        )
      : null;

  const condition =
    iemCondition(
      closest.row,
    );

  return {
    isIndoor: false,

    temperature:
      closest.temperature !== null
        ? roundTemperature(
            closest.temperature,
          )
        : null,

    condition,

    emoji:
      weatherEmoji(
        condition,
      ),

    high:
      high !== null
        ? roundTemperature(high)
        : null,

    low:
      low !== null
        ? roundTemperature(low)
        : null,

    capturedAt:
      closest.timestamp ||
      new Date().toISOString(),
  };
}

/*
 * NWS current observation + forecast.
 *
 * NWS is only used for U.S. games. It is free/open data and
 * does not require an API key.
 */
async function fetchNwsWeather(
  latitude: number,
  longitude: number,
  gameTime?: string | null,
): Promise<GameWeather | null> {
  const headers = {
    Accept:
      "application/geo+json, application/json",
    "User-Agent":
      "GamblingNFL weather service",
  };

  const point =
    await fetchJson<NwsPointData>(
      `https://api.weather.gov/points/${latitude},${longitude}`,
      headers,
    );

  const properties =
    point.properties;

  if (!properties) {
    return null;
  }

  const forecastHourlyUrl =
    properties.forecastHourly;

  const observationStationsUrl =
    properties.observationStations;

  if (!forecastHourlyUrl) {
    return null;
  }

  const [
    forecast,
    stationList,
  ] =
    await Promise.all([
      fetchJson<NwsForecast>(
        forecastHourlyUrl,
        headers,
      ),

      observationStationsUrl
        ? fetchJson<NwsStationList>(
            observationStationsUrl,
            headers,
          )
        : Promise.resolve(null),
    ]);

  const periods =
    forecast.properties
      ?.periods ??
    [];

  if (periods.length === 0) {
    return null;
  }

  /*
   * If the game is scheduled/live, select the forecast period
   * closest to the actual game time.
   */
  let selected =
    periods[0];

  if (gameTime) {
    const targetMs =
      new Date(
        gameTime,
      ).getTime();

    let bestDistance =
      Number.POSITIVE_INFINITY;

    for (
      const period of periods
    ) {
      if (!period.startTime) {
        continue;
      }

      const periodMs =
        new Date(
          period.startTime,
        ).getTime();

      const distance =
        Math.abs(
          periodMs -
            targetMs,
        );

      if (
        distance <
        bestDistance
      ) {
        bestDistance =
          distance;

        selected =
          period;
      }
    }
  }

  /*
   * Get today's forecast high/low from the hourly forecast.
   */
  const selectedDate =
    selected.startTime
      ? new Date(
          selected.startTime,
        ).toLocaleDateString(
          "en-CA",
          {
            timeZone:
              properties.timeZone ??
              "America/Chicago",
          },
        )
      : null;

  const sameDayPeriods =
    selectedDate
      ? periods.filter(
          (period) =>
            period.startTime &&
            new Date(
              period.startTime,
            ).toLocaleDateString(
              "en-CA",
              {
                timeZone:
                  properties.timeZone ??
                  "America/Chicago",
              },
            ) === selectedDate,
        )
      : periods.slice(0, 4);

  const forecastTemps =
    sameDayPeriods
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
          value !== null,
      );

  const high =
    forecastTemps.length > 0
      ? Math.max(
          ...forecastTemps,
        )
      : null;

  const low =
    forecastTemps.length > 0
      ? Math.min(
          ...forecastTemps,
        )
      : null;

  /*
   * For live/current games, prefer the actual latest NWS
   * observation instead of a forecast.
   */
  let currentTemperature =
    typeof selected.temperature ===
    "number"
      ? selected.temperature
      : null;

  let currentCondition =
    selected.shortForecast ??
    "Weather";

  let capturedAt =
    new Date().toISOString();

  const stationId =
    stationList?.features?.[0]
      ?.properties
      ?.stationIdentifier;

  if (stationId) {
    try {
      const observation =
        await fetchJson<NwsObservation>(
          `https://api.weather.gov/stations/${encodeURIComponent(
            stationId,
          )}/observations/latest`,
          headers,
        );

      const observationTemperature =
        observation.properties
          ?.temperature
          ?.value;

      if (
        typeof observationTemperature ===
        "number"
      ) {
        currentTemperature =
          roundTemperature(
            celsiusToFahrenheit(
              observationTemperature,
            ),
          );
      }

      if (
        observation.properties
          ?.textDescription
      ) {
        currentCondition =
          observation.properties
            .textDescription;
      }

      if (
        observation.properties
          ?.timestamp
      ) {
        capturedAt =
          observation.properties
            .timestamp;
      }
    } catch {
      /*
       * Forecast remains usable if the latest
       * observation endpoint fails.
       */
    }
  }

  return {
    isIndoor: false,

    temperature:
      currentTemperature,

    condition:
      currentCondition,

    emoji:
      weatherEmoji(
        currentCondition,
      ),

    high:
      high !== null
        ? roundTemperature(high)
        : null,

    low:
      low !== null
        ? roundTemperature(low)
        : null,

    capturedAt,
  };
}

/*
 * Determines whether the stadium is in the United States.
 *
 * International venues are routed directly to IEM historical/
 * METAR handling instead of NWS.
 */
function isInternationalVenue(
  venue?: string,
): boolean {
  const value =
    (venue ?? "").toLowerCase();

  return (
    value.includes("tottenham") ||
    value.includes("wembley") ||
    value.includes("london") ||
    value.includes("allianz") ||
    value.includes("munich") ||
    value.includes("sao paulo") ||
    value.includes("são paulo")
  );
}

/*
 * Main weather function used by games.$gameId.tsx.
 */
export async function fetchGameWeather(
  params: {
    gameId: string;
    homeTeamId: string;
    venue?: string;
    status: string;
  },
): Promise<GameWeather> {
  const stadium =
    getStadiumForGame(
      params.homeTeamId,
      params.venue,
    );

  /*
   * Indoor stadiums never need an external weather request.
   */
  if (stadium.isIndoor) {
    return {
      isIndoor: true,
      temperature: 72,
      condition: "Indoor",
      emoji: "🏟️",
      high: null,
      low: null,
      capturedAt:
        new Date().toISOString(),
    };
  }

  /*
   * Get the real ESPN game timestamp.
   *
   * This is especially important for historical games because
   * weather must correspond to the game, not page-view time.
   */
  const espnInfo =
    await fetchEspnGameInfo(
      params.gameId,
    );

  const statusLower =
    params.status.toLowerCase();

  const isCompleted =
    Boolean(
      espnInfo.completed ||
      statusLower.includes("final") ||
      statusLower.includes("completed") ||
      statusLower.includes("complete"),
    );

  /*
   * COMPLETED GAME
   *
   * Use historical ASOS/METAR observations.
   */
  if (
    isCompleted &&
    espnInfo.startTime
  ) {
    try {
      const timeZone =
        getTimeZone(
          params.homeTeamId,
          params.venue,
        );

      const station =
        getHistoricalStation(
          params.homeTeamId,
          params.venue,
        );

      /*
       * If ESPN gives us an actual end timestamp,
       * use it. Otherwise kickoff is the reliable fallback.
       *
       * In either case, the page-view time is never used.
       */
      const historicalTime =
        espnInfo.endTime ??
        espnInfo.startTime;

      const historical =
        await fetchHistoricalIemWeather(
          station,
          historicalTime,
          timeZone,
        );

      if (historical) {
        return historical;
      }
    } catch (error) {
      console.error(
        "[WEATHER] Historical IEM lookup failed:",
        error,
      );
    }
  }

  /*
   * UPCOMING/LIVE U.S. GAME
   *
   * Use NWS.
   */
  if (
    !isInternationalVenue(
      params.venue,
    )
  ) {
    try {
      const gameTime =
        espnInfo.startTime;

      const liveOrForecast =
        await fetchNwsWeather(
          stadium.latitude,
          stadium.longitude,
          gameTime,
        );

      if (liveOrForecast) {
        return liveOrForecast;
      }
    } catch (error) {
      console.error(
        "[WEATHER] NWS lookup failed:",
        error,
      );
    }
  }

  /*
   * INTERNATIONAL OR NWS FALLBACK
   *
   * For international games, IEM provides global
   * METAR/ASOS observations.
   *
   * For an upcoming game, we can only show an actual
   * observation here rather than pretending it is a forecast.
   */
  try {
    const station =
      getHistoricalStation(
        params.homeTeamId,
        params.venue,
      );

    const referenceTime =
      espnInfo.startTime ??
      new Date().toISOString();

    const timeZone =
      getTimeZone(
        params.homeTeamId,
        params.venue,
      );

    const iem =
      await fetchHistoricalIemWeather(
        station,
        referenceTime,
        timeZone,
      );

    if (iem) {
      return iem;
    }
  } catch (error) {
    console.error(
      "[WEATHER] IEM fallback failed:",
      error,
    );
  }

  /*
   * Final graceful fallback.
   */
  return {
    isIndoor: false,
    temperature: null,
    condition:
      "Weather unavailable",
    emoji: "🌡️",
    high: null,
    low: null,
    capturedAt:
      new Date().toISOString(),
  };
}
