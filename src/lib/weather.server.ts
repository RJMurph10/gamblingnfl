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

const FETCH_TIMEOUT_MS = 12000;

function makeTimeoutSignal(ms = FETCH_TIMEOUT_MS) {
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
  const { signal, cleanup } =
    makeTimeoutSignal();

  try {
    const response = await fetch(url, {
      headers,
      signal,
    });

    if (!response.ok) {
      const body =
        await response.text();

      throw new Error(
        `HTTP ${response.status}: ${body.slice(
          0,
          250,
        )}`,
      );
    }

    return (await response.json()) as T;
  } finally {
    cleanup();
  }
}

interface EspnGameInfo {
  startTime: string | null;
  endTime: string | null;
  completed: boolean;
}

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
        status?.type?.name ===
          "STATUS_FINAL",
      );

    console.log(
      "[WEATHER DEBUG] ESPN",
      {
        gameId,
        startTime,
        endTime,
        completed,
      },
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
      "[WEATHER DEBUG] ESPN ERROR",
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
 */
const TEAM_TIME_ZONES: Record<
  string,
  string
> = {
  "1": "America/New_York",
  "2": "America/New_York",
  "3": "America/Chicago",
  "4": "America/New_York",
  "5": "America/New_York",
  "6": "America/Chicago",
  "7": "America/Denver",
  "8": "America/New_York",
  "9": "America/New_York",
  "10": "America/Chicago",
  "11": "America/New_York",
  "12": "America/Chicago",
  "13": "America/Los_Angeles",
  "14": "America/Los_Angeles",
  "15": "America/New_York",
  "16": "America/Chicago",
  "17": "America/New_York",
  "18": "America/Chicago",
  "19": "America/New_York",
  "20": "America/New_York",
  "21": "America/New_York",
  "22": "America/Phoenix",
  "23": "America/New_York",
  "24": "America/Los_Angeles",
  "25": "America/Los_Angeles",
  "26": "America/Los_Angeles",
  "27": "America/New_York",
  "28": "America/New_York",
  "29": "America/New_York",
  "30": "America/New_York",
  "33": "America/New_York",
  "34": "America/Chicago",
};

function getTimeZone(
  homeTeamId: string,
  venue?: string,
): string {
  const value =
    (venue ?? "").toLowerCase();

  if (
    value.includes("tottenham") ||
    value.includes("wembley") ||
    value.includes("london")
  ) {
    return "Europe/London";
  }

  if (
    value.includes("allianz") ||
    value.includes("munich")
  ) {
    return "Europe/Berlin";
  }

  if (
    value.includes("sao") ||
    value.includes("são") ||
    value.includes("paulo")
  ) {
    return "America/Sao_Paulo";
  }

  return (
    TEAM_TIME_ZONES[homeTeamId] ??
    "America/Chicago"
  );
}

/*
 * Closest major airport ASOS/METAR station.
 *
 * IEM's ASOS archive is global and provides historical
 * observations including temperature and present-weather codes.
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
};

function getStation(
  homeTeamId: string,
  venue?: string,
): string {
  const value =
    (venue ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  if (
    value.includes("tottenham") ||
    value.includes("wembley") ||
    value.includes("london")
  ) {
    return "EGLL";
  }

  if (
    value.includes("allianz") ||
    value.includes("munich")
  ) {
    return "EDDM";
  }

  if (
    value.includes("sao") ||
    value.includes("paulo")
  ) {
    return "SBGR";
  }

  return (
    STADIUM_STATIONS[homeTeamId] ??
    "KORD"
  );
}

function getLocalDate(
  iso: string,
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
  ).format(new Date(iso));
}

function weatherEmoji(
  condition: string,
): string {
  const value =
    condition.toLowerCase();

  if (
    value.includes("thunder") ||
    value.includes("storm") ||
    value.includes("tstm")
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
    value.includes("shower") ||
    value.includes("drizzle")
  ) {
    return "🌧️";
  }

  if (
    value.includes("fog") ||
    value.includes("mist")
  ) {
    return "🌫️";
  }

  if (
    value.includes("cloud") ||
    value.includes("overcast")
  ) {
    return "☁️";
  }

  if (
    value.includes("partly") ||
    value.includes("mostly")
  ) {
    return "🌤️";
  }

  if (
    value.includes("clear") ||
    value.includes("sunny")
  ) {
    return "☀️";
  }

  return "🌤️";
}

function parseCsv(
  text: string,
): Array<Record<string, string>> {
  const lines =
    text
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim().length > 0,
      );

  if (lines.length < 2) {
    return [];
  }

  /*
   * IEM may prepend comments/metadata.
   * Find the actual CSV header.
   */
  const headerIndex =
    lines.findIndex((line) => {
      const lower =
        line.toLowerCase();

      return (
        lower.startsWith("station,") ||
        lower.includes(
          "station,valid",
        )
      );
    });

  if (headerIndex === -1) {
    return [];
  }

  const headers =
    lines[headerIndex]
      .split(",")
      .map((value) =>
        value.trim(),
      );

  const rows:
    Array<Record<string, string>> =
    [];

  for (
    let i = headerIndex + 1;
    i < lines.length;
    i += 1
  ) {
    const line =
      lines[i].trim();

    if (!line) {
      continue;
    }

    const values =
      line.split(",");

    const row:
      Record<string, string> = {};

    for (
      let j = 0;
      j < headers.length;
      j += 1
    ) {
      row[headers[j]] =
        values[j]?.trim() ?? "";
    }

    rows.push(row);
  }

  return rows;
}

function conditionFromRow(
  row: Record<string, string>,
): string {
  const wx =
    (
      row.wxcodes ??
      ""
    ).toLowerCase();

  if (
    wx.includes("ts") ||
    wx.includes("tstm")
  ) {
    return "Thunderstorms";
  }

  if (
    wx.includes("sn") ||
    wx.includes("snow")
  ) {
    return "Snow";
  }

  if (
    wx.includes("ra") ||
    wx.includes("rain")
  ) {
    return "Rain";
  }

  if (
    wx.includes("dz") ||
    wx.includes("drizzle")
  ) {
    return "Drizzle";
  }

  if (
    wx.includes("fg") ||
    wx.includes("fog")
  ) {
    return "Fog";
  }

  if (
    wx.includes("br") ||
    wx.includes("mist")
  ) {
    return "Mist";
  }

  const sky =
    (
      row.skyc1 ??
      ""
    ).toLowerCase();

  if (sky.includes("ovc")) {
    return "Overcast";
  }

  if (
    sky.includes("bkn") ||
    sky.includes("sct") ||
    sky.includes("few")
  ) {
    return "Partly Cloudy";
  }

  return "Clear";
}

/*
 * Historical IEM request.
 *
 * IMPORTANT:
 * IEM documents year1/month1/day1 and
 * year2/month2/day2 as the date-range interface.
 */
async function fetchIemHistorical(
  station: string,
  referenceTime: string,
  timeZone: string,
): Promise<GameWeather | null> {
  const localDate =
    getLocalDate(
      referenceTime,
      timeZone,
    );

  const [year, month, day] =
    localDate
      .split("-")
      .map(Number);

  if (
    !year ||
    !month ||
    !day
  ) {
    throw new Error(
      `Could not parse local date: ${localDate}`,
    );
  }

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
    "tmpf",
  );

  url.searchParams.append(
    "data",
    "wxcodes",
  );

  url.searchParams.append(
    "data",
    "skyc1",
  );

  url.searchParams.set(
    "year1",
    String(year),
  );

  url.searchParams.set(
    "month1",
    String(month),
  );

  url.searchParams.set(
    "day1",
    String(day),
  );

  /*
   * End date is exclusive.
   * Request exactly one local calendar day.
   */
  const nextDay =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + 1,
      ),
    );

  url.searchParams.set(
    "year2",
    String(
      nextDay.getUTCFullYear(),
    ),
  );

  url.searchParams.set(
    "month2",
    String(
      nextDay.getUTCMonth() + 1,
    ),
  );

  url.searchParams.set(
    "day2",
    String(
      nextDay.getUTCDate(),
    ),
  );

  url.searchParams.set(
    "tz",
    timeZone,
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

  url.searchParams.append(
    "report_type",
    "3",
  );

  url.searchParams.append(
    "report_type",
    "4",
  );

  console.log(
    "[WEATHER DEBUG] IEM URL",
    url.toString(),
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

  const body =
    await response.text();

  console.log(
    "[WEATHER DEBUG] IEM RESPONSE",
    {
      status:
        response.status,
      body:
        body.slice(0, 1000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `IEM HTTP ${response.status}: ${body.slice(
        0,
        220,
      )}`,
    );
  }

  const rows =
    parseCsv(body);

  console.log(
    "[WEATHER DEBUG] IEM ROWS",
    rows.length,
  );

  if (rows.length === 0) {
    throw new Error(
      `IEM returned no observations for ${station} on ${localDate}`,
    );
  }

  const usable =
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
          item.timestamp,
      );

  if (usable.length === 0) {
    throw new Error(
      `IEM returned ${rows.length} rows but no valid temperatures`,
    );
  }

  const targetMs =
    new Date(
      referenceTime,
    ).getTime();

  let closest =
    usable[0];

  let closestDistance =
    Infinity;

  for (
    const item of usable
  ) {
    const timeMs =
      new Date(
        item.timestamp,
      ).getTime();

    const distance =
      Math.abs(
        timeMs -
          targetMs,
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

  const temperatures =
    usable.map(
      (item) =>
        item.temperature!,
    );

  const high =
    Math.max(
      ...temperatures,
    );

  const low =
    Math.min(
      ...temperatures,
    );

  const condition =
    conditionFromRow(
      closest.row,
    );

  return {
    isIndoor: false,

    temperature:
      Math.round(
        closest.temperature!,
      ),

    condition,

    emoji:
      weatherEmoji(
        condition,
      ),

    high:
      Math.round(high),

    low:
      Math.round(low),

    capturedAt:
      closest.timestamp,
  };
}

/*
 * NWS structures.
 */
interface NwsPoint {
  properties?: {
    forecastHourly?: string;
    observationStations?: string;
    timeZone?: string;
  };
}

interface NwsForecast {
  properties?: {
    periods?: Array<{
      startTime?: string;
      temperature?: number;
      shortForecast?: string;
    }>;
  };
}

interface NwsStations {
  features?: Array<{
    properties?: {
      stationIdentifier?: string;
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

async function fetchNws(
  latitude: number,
  longitude: number,
  gameTime: string | null,
): Promise<GameWeather | null> {
  const headers = {
    Accept:
      "application/geo+json",
    "User-Agent":
      "GamblingNFL/1.0 weather",
  };

  const point =
    await fetchJson<NwsPoint>(
      `https://api.weather.gov/points/${latitude},${longitude}`,
      headers,
    );

  const properties =
    point.properties;

  if (!properties?.forecastHourly) {
    throw new Error(
      "NWS /points did not return forecastHourly",
    );
  }

  const forecast =
    await fetchJson<NwsForecast>(
      properties.forecastHourly,
      headers,
    );

  const periods =
    forecast.properties
      ?.periods ??
    [];

  if (periods.length === 0) {
    throw new Error(
      "NWS returned no hourly forecast periods",
    );
  }

  let selected =
    periods[0];

  if (gameTime) {
    const target =
      new Date(
        gameTime,
      ).getTime();

    let best =
      Infinity;

    for (
      const period of periods
    ) {
      if (
        !period.startTime
      ) {
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
        distance < best
      ) {
        best =
          distance;

        selected =
          period;
      }
    }
  }

  const stationResponse =
    properties.observationStations
      ? await fetchJson<NwsStations>(
          properties.observationStations,
          headers,
        )
      : null;

  const station =
    stationResponse
      ?.features?.[0]
      ?.properties
      ?.stationIdentifier;

  let temperature =
    selected.temperature ??
    null;

  let condition =
    selected.shortForecast ??
    "Weather";

  let capturedAt =
    selected.startTime ??
    new Date().toISOString();

  /*
   * Prefer the latest actual observation.
   */
  if (station) {
    try {
      const observation =
        await fetchJson<NwsObservation>(
          `https://api.weather.gov/stations/${encodeURIComponent(
            station,
          )}/observations/latest`,
          headers,
        );

      const celsius =
        observation.properties
          ?.temperature
          ?.value;

      if (
        typeof celsius ===
        "number"
      ) {
        temperature =
          Math.round(
            (celsius * 9) / 5 +
              32,
          );
      }

      if (
        observation.properties
          ?.textDescription
      ) {
        condition =
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
    } catch (error) {
      console.warn(
        "[WEATHER DEBUG] NWS observation failed; using forecast",
        error,
      );
    }
  }

  const targetDate =
    selected.startTime
      ? getLocalDate(
          selected.startTime,
          properties.timeZone ??
            "America/Chicago",
        )
      : null;

  const sameDay =
    targetDate
      ? periods.filter(
          (period) =>
            period.startTime &&
            getLocalDate(
              period.startTime,
              properties.timeZone ??
                "America/Chicago",
            ) === targetDate,
        )
      : [];

  const temps =
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

  return {
    isIndoor: false,

    temperature,

    condition,

    emoji:
      weatherEmoji(
        condition,
      ),

    high:
      temps.length
        ? Math.max(
            ...temps,
          )
        : temperature,

    low:
      temps.length
        ? Math.min(
            ...temps,
          )
        : temperature,

    capturedAt,
  };
}

function isInternational(
  venue?: string,
): boolean {
  const value =
    (venue ?? "").toLowerCase();

  return (
    value.includes("london") ||
    value.includes("tottenham") ||
    value.includes("wembley") ||
    value.includes("munich") ||
    value.includes("allianz") ||
    value.includes("sao") ||
    value.includes("são") ||
    value.includes("paulo")
  );
}

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

  console.log(
    "[WEATHER DEBUG] GAME",
    {
      gameId: params.gameId,
      homeTeamId:
        params.homeTeamId,
      venue:
        params.venue,
      stadium:
        stadium.name,
      isIndoor:
        stadium.isIndoor,
      status:
        params.status,
    },
  );

  /*
   * Indoor games.
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

  const espn =
    await fetchEspnGameInfo(
      params.gameId,
    );

  const status =
    params.status.toLowerCase();

  const completed =
    espn.completed ||
    status.includes("final") ||
    status.includes("complete");

  /*
   * HISTORICAL
   */
  if (
    completed &&
    espn.startTime
  ) {
    try {
      const station =
        getStation(
          params.homeTeamId,
          params.venue,
        );

      const timeZone =
        getTimeZone(
          params.homeTeamId,
          params.venue,
        );

      console.log(
        "[WEATHER DEBUG] HISTORICAL",
        {
          station,
          timeZone,
          gameTime:
            espn.startTime,
        },
      );

      const result =
        await fetchIemHistorical(
          station,
          espn.startTime,
          timeZone,
        );

      if (result) {
        return result;
      }
    } catch (error) {
      console.error(
        "[WEATHER DEBUG] HISTORICAL ERROR",
        error,
      );

      return {
        isIndoor: false,
        temperature: null,
        condition:
          `IEM ERROR: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`.slice(0, 180),
        emoji: "⚠️",
        high: null,
        low: null,
        capturedAt:
          new Date().toISOString(),
      };
    }
  }

  /*
   * UPCOMING/LIVE U.S.
   */
  if (
    !isInternational(
      params.venue,
    )
  ) {
    try {
      console.log(
        "[WEATHER DEBUG] NWS",
        {
          latitude:
            stadium.latitude,
          longitude:
            stadium.longitude,
          gameTime:
            espn.startTime,
        },
      );

      const result =
        await fetchNws(
          stadium.latitude,
          stadium.longitude,
          espn.startTime,
        );

      if (result) {
        return result;
      }
    } catch (error) {
      console.error(
        "[WEATHER DEBUG] NWS ERROR",
        error,
      );

      return {
        isIndoor: false,
        temperature: null,
        condition:
          `NWS ERROR: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`.slice(0, 180),
        emoji: "⚠️",
        high: null,
        low: null,
        capturedAt:
          new Date().toISOString(),
      };
    }
  }

  /*
   * INTERNATIONAL / FALLBACK
   */
  try {
    const station =
      getStation(
        params.homeTeamId,
        params.venue,
      );

    const timeZone =
      getTimeZone(
        params.homeTeamId,
        params.venue,
      );

    const reference =
      espn.startTime ??
      new Date().toISOString();

    console.log(
      "[WEATHER DEBUG] IEM FALLBACK",
      {
        station,
        timeZone,
        reference,
      },
    );

    const result =
      await fetchIemHistorical(
        station,
        reference,
        timeZone,
      );

    if (result) {
      return result;
    }
  } catch (error) {
    console.error(
      "[WEATHER DEBUG] IEM FALLBACK ERROR",
      error,
    );

    return {
      isIndoor: false,
      temperature: null,
      condition:
        `IEM ERROR: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`.slice(0, 180),
      emoji: "⚠️",
      high: null,
      low: null,
      capturedAt:
        new Date().toISOString(),
    };
  }

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
