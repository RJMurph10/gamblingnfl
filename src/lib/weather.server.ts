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

/* =========================================================
   ESPN GAME INFORMATION
   ========================================================= */

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

    return {
      startTime:
        typeof startTime ===
        "string"
          ? startTime
          : null,

      endTime:
        typeof endTime ===
        "string"
          ? endTime
          : null,

      completed,
    };
  } catch (error) {
    console.error(
      "[WEATHER] ESPN ERROR",
      error,
    );

    return {
      startTime: null,
      endTime: null,
      completed: false,
    };
  }
}

/* =========================================================
   TIME ZONES
   ========================================================= */

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

/* =========================================================
   INTERNATIONAL VENUE DETECTION
   ========================================================= */

function normalizeVenue(
  venue?: string,
): string {
  return (
    venue ?? ""
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .replace(
      /[^a-z0-9]/g,
      "",
    );
}

function getInternationalLocation(
  venue?: string,
): {
  city: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  station: string;
} | null {
  const value =
    normalizeVenue(venue);

  /*
   * Tottenham Hotspur Stadium
   */
  if (
    value.includes("tottenham") ||
    value.includes("london")
  ) {
    return {
      city: "London",
      latitude: 51.6043,
      longitude: -0.0661,
      timeZone: "Europe/London",
      station: "EGLL",
    };
  }

  /*
   * Wembley Stadium
   */
  if (
    value.includes("wembley")
  ) {
    return {
      city: "London",
      latitude: 51.556,
      longitude: -0.2796,
      timeZone: "Europe/London",
      station: "EGLL",
    };
  }

  /*
   * Allianz Arena
   */
  if (
    value.includes("allianz") ||
    value.includes("munich")
  ) {
    return {
      city: "Munich",
      latitude: 48.2188,
      longitude: 11.6247,
      timeZone: "Europe/Berlin",
      station: "EDDM",
    };
  }

  /*
   * São Paulo / Corinthians
   */
  if (
    value.includes("saopaulo") ||
    value.includes("paulo") ||
    value.includes("corinthians") ||
    value.includes("arenacorinthians")
  ) {
    return {
      city: "Sao Paulo",
      latitude: -23.5456,
      longitude: -46.4748,
      timeZone: "America/Sao_Paulo",
      station: "SBSP",
    };
  }

  return null;
}

function isInternationalVenue(
  venue?: string,
): boolean {
  return Boolean(
    getInternationalLocation(
      venue,
    ),
  );
}

/* =========================================================
   STADIUM COORDINATE EXTRACTION
   ========================================================= */

/*
 * The existing stadiums.ts has changed its coordinate
 * property naming during development.
 *
 * Read the values defensively so the weather system
 * doesn't depend on one exact property name.
 */
function getStadiumCoordinates(
  stadium: unknown,
): {
  latitude: number;
  longitude: number;
} | null {
  const raw =
    stadium as Record<
      string,
      unknown
    >;

  const latitudeCandidates = [
    raw.latitude,
    raw.lat,
    (
      raw.coordinates as
        | Record<string, unknown>
        | undefined
    )?.latitude,
    (
      raw.coordinates as
        | Record<string, unknown>
        | undefined
    )?.lat,
  ];

  const longitudeCandidates = [
    raw.longitude,
    raw.lon,
    raw.lng,
    (
      raw.coordinates as
        | Record<string, unknown>
        | undefined
    )?.longitude,
    (
      raw.coordinates as
        | Record<string, unknown>
        | undefined
    )?.lon,
    (
      raw.coordinates as
        | Record<string, unknown>
        | undefined
    )?.lng,
  ];

  const latitude =
    latitudeCandidates
      .map(Number)
      .find(Number.isFinite);

  const longitude =
    longitudeCandidates
      .map(Number)
      .find(Number.isFinite);

  if (
    latitude === undefined ||
    longitude === undefined
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

/* =========================================================
   WEATHER EMOJI
   ========================================================= */

function weatherEmoji(
  condition: string,
  referenceTime?: string | null,
  timeZone?: string,
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
    /*
     * A clear night should not display a sun.
     */
    if (
      referenceTime &&
      timeZone
    ) {
      const hour =
        Number(
          new Intl.DateTimeFormat(
            "en-US",
            {
              timeZone,
              hour: "numeric",
              hour12: false,
            },
          ).format(
            new Date(
              referenceTime,
            ),
          ),
        );

      if (
        hour >= 20 ||
        hour < 6
      ) {
        return "🌙";
      }
    }

    return "☀️";
  }

  return "🌤️";
}

/* =========================================================
   IEM CSV PARSER
   ========================================================= */

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

  const headerIndex =
    lines.findIndex(
      (line) => {
        const lower =
          line.toLowerCase();

        return (
          lower.startsWith(
            "station,",
          ) ||
          lower.includes(
            "station,valid",
          )
        );
      },
    );

  if (headerIndex === -1) {
    return [];
  }

  const headers =
    lines[headerIndex]
      .split(",")
      .map(
        (value) =>
          value.trim(),
      );

  const rows:
    Array<
      Record<string, string>
    > = [];

  for (
    let i =
      headerIndex + 1;
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
      Record<string, string> =
      {};

    for (
      let j = 0;
      j < headers.length;
      j += 1
    ) {
      row[headers[j]] =
        values[j]?.trim() ??
        "";
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

  if (
    sky.includes("ovc")
  ) {
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

/* =========================================================
   HISTORICAL IEM WEATHER
   ========================================================= */

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

  const [
    year,
    month,
    day,
  ] =
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
    "[WEATHER] IEM HISTORICAL",
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

  if (
    rows.length === 0
  ) {
    throw new Error(
      `IEM returned no observations for ${station} on ${localDate}`,
    );
  }

  const usable =
    rows
      .map(
        (row) => {
          const temperature =
            Number.parseFloat(
              row.tmpf ?? "",
            );

          return {
            row,
            temperature:
              Number.isFinite(
                temperature,
              )
                ? temperature
                : null,
            timestamp:
              row.valid ?? "",
          };
        },
      )
      .filter(
        (item) =>
          item.temperature !==
            null &&
          item.timestamp,
      );

  if (
    usable.length === 0
  ) {
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
        closest.timestamp,
        timeZone,
      ),

    high:
      Math.round(high),

    low:
      Math.round(low),

    capturedAt:
      closest.timestamp,
  };
}

/* =========================================================
   NWS — UPCOMING/LIVE UNITED STATES
   ========================================================= */

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

  if (
    !properties?.forecastHourly
  ) {
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

  if (
    periods.length === 0
  ) {
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

  /*
   * Use the observation only for the current
   * temperature. Do not replace a future game
   * forecast with today's observation.
   */
  let temperature =
    selected.temperature ??
    null;

  let condition =
    selected.shortForecast ??
    "Weather";

  let capturedAt =
    selected.startTime ??
    new Date().toISOString();

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

  /*
   * Only use latest observation when the game
   * is essentially happening now.
   */
  if (
    station &&
    gameTime
  ) {
    const gameMs =
      new Date(
        gameTime,
      ).getTime();

    const nowMs =
      Date.now();

    const isNearGame =
      Math.abs(
        nowMs -
          gameMs,
      ) <
      3 *
        60 *
        60 *
        1000;

    if (isNearGame) {
      try {
        const observation =
          await fetchJson<NwsObservation>(
            `https://api.weather.gov/stations/${encodeURIComponent(
              station,
            )}/observations/latest`,
            headers,
          );

        const celsius =
          observation
            .properties
            ?.temperature
            ?.value;

        if (
          typeof celsius ===
          "number"
        ) {
          temperature =
            Math.round(
              (celsius * 9) /
                5 +
                32,
            );
        }

        if (
          observation
            .properties
            ?.textDescription
        ) {
          condition =
            observation
              .properties
              .textDescription;
        }

        if (
          observation
            .properties
            ?.timestamp
        ) {
          capturedAt =
            observation
              .properties
              .timestamp;
        }
      } catch {
        /*
         * Forecast remains valid if observation
         * lookup fails.
         */
      }
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
        selected.startTime,
        properties.timeZone ??
          "America/Chicago",
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

/* =========================================================
   MET.NO / YR — UPCOMING INTERNATIONAL
   ========================================================= */

interface MetForecast {
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

function conditionFromMetSymbol(
  symbol?: string,
): string {
  const value =
    (
      symbol ?? ""
    ).toLowerCase();

  if (
    value.includes("thunder")
  ) {
    return "Thunderstorms";
  }

  if (
    value.includes("snow") ||
    value.includes("sleet")
  ) {
    return "Snow";
  }

  if (
    value.includes("rain") ||
    value.includes("shower")
  ) {
    return "Rain";
  }

  if (
    value.includes("fog")
  ) {
    return "Fog";
  }

  if (
    value.includes("overcast")
  ) {
    return "Overcast";
  }

  if (
    value.includes("cloudy") ||
    value.includes("partly")
  ) {
    return "Partly Cloudy";
  }

  if (
    value.includes("clear")
  ) {
    return "Clear";
  }

  return "Weather";
}

async function fetchInternationalForecast(
  latitude: number,
  longitude: number,
  gameTime: string | null,
  timeZone: string,
): Promise<GameWeather | null> {
  const url =
    new URL(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact",
    );

  url.searchParams.set(
    "lat",
    latitude.toFixed(4),
  );

  url.searchParams.set(
    "lon",
    longitude.toFixed(4),
  );

  const data =
    await fetchJson<MetForecast>(
      url.toString(),
      {
        Accept:
          "application/json",
        "User-Agent":
          "GamblingNFL/1.0 github.com/RJMurph10/gamblingnfl",
      },
    );

  const timeseries =
    data.properties
      ?.timeseries ??
    [];

  if (
    timeseries.length === 0
  ) {
    throw new Error(
      "MET Norway returned no forecast periods",
    );
  }

  let selected =
    timeseries[0];

  if (gameTime) {
    const target =
      new Date(
        gameTime,
      ).getTime();

    let best =
      Infinity;

    for (
      const item of timeseries
    ) {
      if (!item.time) {
        continue;
      }

      const distance =
        Math.abs(
          new Date(
            item.time,
          ).getTime() -
            target,
        );

      if (
        distance < best
      ) {
        best =
          distance;

        selected =
          item;
      }
    }
  }

  const temperature =
    selected.data
      ?.instant
      ?.details
      ?.air_temperature;

  const symbol =
    selected.data
      ?.next_1_hours
      ?.summary
      ?.symbol_code;

  const condition =
    conditionFromMetSymbol(
      symbol,
    );

  /*
   * Build H/L from the same game day.
   */
  const targetDate =
    selected.time
      ? getLocalDate(
          selected.time,
          timeZone,
        )
      : null;

  const sameDay =
    targetDate
      ? timeseries.filter(
          (item) =>
            item.time &&
            getLocalDate(
              item.time,
              timeZone,
            ) === targetDate,
        )
      : [];

  const dayTemperatures =
    sameDay
      .map(
        (item) =>
          item.data
            ?.instant
            ?.details
            ?.air_temperature,
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

    temperature:
      typeof temperature ===
      "number"
        ? Math.round(
            temperature,
          )
        : null,

    condition,

    emoji:
      weatherEmoji(
        condition,
        selected.time,
        timeZone,
      ),

    high:
      dayTemperatures.length
        ? Math.round(
            Math.max(
              ...dayTemperatures,
            ),
          )
        : typeof temperature ===
            "number"
          ? Math.round(
              temperature,
            )
          : null,

    low:
      dayTemperatures.length
        ? Math.round(
            Math.min(
              ...dayTemperatures,
            ),
          )
        : typeof temperature ===
            "number"
          ? Math.round(
              temperature,
            )
          : null,

    capturedAt:
      selected.time ??
      new Date().toISOString(),
  };
}

/* =========================================================
   MAIN WEATHER FUNCTION
   ========================================================= */

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
    "[WEATHER] GAME",
    {
      gameId:
        params.gameId,
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
   * -------------------------------------------------------
   * INTERNATIONAL VENUE OVERRIDES
   *
   * This is the important fix for:
   * Eagles @ Jaguars -> Tottenham, London
   *
   * Jacksonville is technically the home team,
   * but the actual venue is London.
   * -------------------------------------------------------
   */
  const international =
    getInternationalLocation(
      params.venue,
    );

  /*
   * Indoor games still return immediately.
   */
  if (
    stadium.isIndoor &&
    !international
  ) {
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
   * -------------------------------------------------------
   * COMPLETED INTERNATIONAL GAMES
   * -------------------------------------------------------
   */

  if (
    completed &&
    espn.startTime &&
    international
  ) {
    try {
      const result =
        await fetchIemHistorical(
          international.station,
          espn.startTime,
          international.timeZone,
        );

      if (result) {
        return result;
      }
    } catch (error) {
      console.error(
        "[WEATHER] INTERNATIONAL HISTORICAL ERROR",
        error,
      );
    }
  }

  /*
   * -------------------------------------------------------
   * COMPLETED U.S. GAMES
   * -------------------------------------------------------
   */

  if (
    completed &&
    espn.startTime
  ) {
    try {
      const station =
        getStationForTeam(
          params.homeTeamId,
        );

      const timeZone =
        getTimeZone(
          params.homeTeamId,
          params.venue,
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
        "[WEATHER] U.S. HISTORICAL ERROR",
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
   * -------------------------------------------------------
   * UPCOMING/LIVE INTERNATIONAL
   *
   * Uses a real forecast, NOT the historical archive.
   * -------------------------------------------------------
   */

  if (
    international
  ) {
    try {
      const result =
        await fetchInternationalForecast(
          international.latitude,
          international.longitude,
          espn.startTime,
          international.timeZone,
        );

      if (result) {
        return result;
      }
    } catch (error) {
      console.error(
        "[WEATHER] INTERNATIONAL FORECAST ERROR",
        error,
      );

      return {
        isIndoor: false,
        temperature: null,
        condition:
          `INTL WEATHER ERROR: ${
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
   * -------------------------------------------------------
   * UPCOMING/LIVE U.S.
   * -------------------------------------------------------
   */

  try {
    const coordinates =
      getStadiumCoordinates(
        stadium,
      );

    if (!coordinates) {
      throw new Error(
        `Invalid stadium coordinates for ${stadium.name}`,
      );
    }

    console.log(
      "[WEATHER] NWS COORDINATES",
      coordinates,
    );

    const result =
      await fetchNws(
        coordinates.latitude,
        coordinates.longitude,
        espn.startTime,
      );

    if (result) {
      return result;
    }
  } catch (error) {
    console.error(
      "[WEATHER] NWS ERROR",
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

/* =========================================================
   TEAM -> IEM STATION
   ========================================================= */

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

function getStationForTeam(
  homeTeamId: string,
): string {
  return (
    STADIUM_STATIONS[
      homeTeamId
    ] ?? "KORD"
  );
}
