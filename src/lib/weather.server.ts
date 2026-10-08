import { createServerFn } from "@tanstack/react-start";
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
  pickcenter?: unknown;
}

interface IemObservation {
  valid?: string;
  tmpf?: string | number | null;
  sknt?: string | number | null;
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
      details?: {
        precipitation_amount?: number;
      };
    };
    next_6_hours?: {
      summary?: {
        symbol_code?: string;
      };
      details?: {
        precipitation_amount?: number;
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

interface NwsPoint {
  properties?: {
    forecast?: string;
    forecastHourly?: string;
    observationStations?: string;
  };
}

interface NwsForecastPeriod {
  startTime?: string;
  endTime?: string;
  temperature?: number;
  temperatureUnit?: string;
  shortForecast?: string;
  detailedForecast?: string;
  isDaytime?: boolean;
}

interface NwsForecast {
  properties?: {
    periods?: NwsForecastPeriod[];
  };
}

interface NwsObservation {
  properties?: {
    timestamp?: string;
    temperature?: {
      value?: number | null;
      unitCode?: string;
    };
    textDescription?: string;
  };
}

interface NwsStations {
  features?: Array<{
    id?: string;
  }>;
}

const NWS_USER_AGENT =
  "GamblingNFL/1.0 (weather data for gamblingnfl.lovable.app)";

const MET_USER_AGENT =
  "GamblingNFL/1.0 (https://gamblingnfl.lovable.app/)";

function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

function fahrenheitFromNws(
  value: number | null | undefined,
  unit?: string,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (unit?.toLowerCase().includes("degc")) {
    return Math.round((value * 9) / 5 + 32);
  }

  return Math.round(value);
}

function normalizeStatus(status: string): string {
  return status.toLowerCase();
}

function isCompletedStatus(status: string): boolean {
  const value = normalizeStatus(status);

  return (
    value.includes("final") ||
    value.includes("complete") ||
    value.includes("post") ||
    value === "completed"
  );
}

function isLiveStatus(status: string): boolean {
  const value = normalizeStatus(status);

  return (
    value.includes("in progress") ||
    value.includes("live") ||
    value.includes("halftime") ||
    value.includes("progress")
  );
}

function isUpcomingStatus(status: string): boolean {
  return !isCompletedStatus(status) && !isLiveStatus(status);
}

function normalizeVenue(venue?: string): string {
  return (venue ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * International stadiums must be detected from the VENUE first.
 * This is important because ESPN may designate one of the NFL teams
 * as the "home" team even though the game is actually overseas.
 */
function getInternationalVenue(venue?: string) {
  const normalized = normalizeVenue(venue);

  if (
    normalized.includes("tottenham") ||
    normalized.includes("tottenhamhotspur")
  ) {
    return {
      name: "Tottenham Hotspur Stadium",
      latitude: 51.6043,
      longitude: -0.0661,
      timeZone: "Europe/London",
      iemStation: "EGLC",
    };
  }

  if (normalized.includes("wembley")) {
    return {
      name: "Wembley Stadium",
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
      name: "Allianz Arena",
      latitude: 48.2188,
      longitude: 11.6247,
      timeZone: "Europe/Berlin",
      iemStation: "EDDM",
    };
  }

  if (
    normalized.includes("corinthians") ||
    normalized.includes("neoquimica") ||
    normalized.includes("saopaulo") ||
    normalized.includes("sao paulo")
  ) {
    return {
      name: "Neo Química Arena",
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
): { latitude: number; longitude: number } | null {
  if (!stadium) {
    return null;
  }

  const latitude =
    typeof stadium.latitude === "number"
      ? stadium.latitude
      : typeof stadium.lat === "number"
        ? stadium.lat
        : typeof stadium.coordinates?.latitude === "number"
          ? stadium.coordinates.latitude
          : typeof stadium.coordinates?.lat === "number"
            ? stadium.coordinates.lat
            : null;

  const longitude =
    typeof stadium.longitude === "number"
      ? stadium.longitude
      : typeof stadium.lon === "number"
        ? stadium.lon
        : typeof stadium.lng === "number"
          ? stadium.lng
          : typeof stadium.coordinates?.longitude === "number"
            ? stadium.coordinates.longitude
            : typeof stadium.coordinates?.lon === "number"
              ? stadium.coordinates.lon
              : typeof stadium.coordinates?.lng === "number"
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

function getTimeZoneForLocation(
  latitude: number,
  longitude: number,
  venue?: string,
): string {
  const international = getInternationalVenue(venue);

  if (international) {
    return international.timeZone;
  }

  /*
   * NFL stadium timezone fallback.
   *
   * This covers the four major U.S. time zones used by NFL stadiums.
   */
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

/**
 * Convert an ISO timestamp into the local hour at the stadium.
 *
 * hourCycle h23 is intentional so midnight is represented as 00,
 * not 24. This avoids the common Intl.DateTimeFormat midnight bug.
 */
function getLocalHour(
  iso: string | null | undefined,
  timeZone: string,
): number | null {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const hourText = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);

  const hour = Number(hourText);

  return Number.isFinite(hour) ? hour : null;
}

function isNightAtTime(
  iso: string | null | undefined,
  timeZone: string,
): boolean {
  const hour = getLocalHour(iso, timeZone);

  if (hour === null) {
    return false;
  }

  /*
   * NFL games are generally considered nighttime once local time
   * reaches 6 PM. This also correctly handles October games where
   * sunset can occur before 7 PM.
   */
  return hour >= 18 || hour < 6;
}

function weatherEmoji(
  condition: string,
  referenceTime?: string | null,
  timeZone?: string,
): string {
  const value = condition.toLowerCase();

  const night =
    referenceTime && timeZone
      ? isNightAtTime(referenceTime, timeZone)
      : false;

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

  if (
    value.includes("partly cloudy") ||
    value.includes("partly clear") ||
    value.includes("mostly clear") ||
    value.includes("mostly sunny")
  ) {
    return night ? "🌙" : "🌤️";
  }

  if (
    value.includes("overcast") ||
    value.includes("cloudy")
  ) {
    return "☁️";
  }

  if (
    value.includes("clear") ||
    value.includes("sunny")
  ) {
    return night ? "🌙" : "☀️";
  }

  return night ? "🌙" : "🌤️";
}

function conditionFromNws(
  shortForecast?: string,
): string {
  if (!shortForecast) {
    return "Weather unavailable";
  }

  return shortForecast;
}

function conditionFromMetSymbol(
  symbol?: string,
): string {
  if (!symbol) {
    return "Weather unavailable";
  }

  const value = symbol.toLowerCase();

  if (value.includes("thunder")) {
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
    value.includes("drizzle")
  ) {
    return "Rain";
  }

  if (
    value.includes("fog")
  ) {
    return "Fog";
  }

  if (
    value.includes("clearsky")
  ) {
    return "Clear";
  }

  if (
    value.includes("fair")
  ) {
    return "Mostly Clear";
  }

  if (
    value.includes("partlycloudy")
  ) {
    return "Partly Cloudy";
  }

  if (
    value.includes("cloudy")
  ) {
    return "Cloudy";
  }

  return "Weather unavailable";
}

function conditionFromIem(
  row: IemObservation,
): string {
  const wx = (row.wxcodes ?? "").toLowerCase();

  if (
    wx.includes("ts") ||
    wx.includes("thunder")
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
    wx.includes("rain") ||
    wx.includes("sh")
  ) {
    return "Rain";
  }

  if (
    wx.includes("fg") ||
    wx.includes("fog") ||
    wx.includes("br")
  ) {
    return "Fog";
  }

  const skyCodes = [
    row.skyc1,
    row.skyc2,
    row.skyc3,
    row.skyc4,
  ]
    .filter(Boolean)
    .map((value) => value!.toUpperCase());

  if (skyCodes.some((value) => value === "OVC")) {
    return "Overcast";
  }

  if (
    skyCodes.some(
      (value) =>
        value === "BKN" ||
        value === "SCT",
    )
  ) {
    return "Partly Cloudy";
  }

  if (
    skyCodes.some(
      (value) =>
        value === "FEW" ||
        value === "CLR" ||
        value === "SKC",
    )
  ) {
    return "Clear";
  }

  return "Weather unavailable";
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `HTTP ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  return response.json() as Promise<T>;
}

async function fetchEspnSummary(
  gameId: string,
): Promise<EspnSummary | null> {
  try {
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(
        gameId,
      )}`;

    return await fetchJson<EspnSummary>(url);
  } catch {
    return null;
  }
}

function getGameStartTime(
  summary: EspnSummary | null,
): string | null {
  return (
    summary?.header?.competitions?.[0]?.date ??
    null
  );
}

function getVenueFromSummary(
  summary: EspnSummary | null,
): string | undefined {
  return summary
    ?.header
    ?.competitions?.[0]
    ?.venue
    ?.fullName;
}

async function fetchNwsForecast(
  latitude: number,
  longitude: number,
  gameTime: string,
  timeZone: string,
): Promise<GameWeather> {
  const pointsUrl =
    `https://api.weather.gov/points/${latitude.toFixed(
      4,
    )},${longitude.toFixed(4)}`;

  const points = await fetchJson<NwsPoint>(
    pointsUrl,
    {
      headers: {
        "User-Agent": NWS_USER_AGENT,
        Accept: "application/geo+json",
      },
    },
  );

  const forecastUrl =
    points.properties?.forecastHourly ??
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
          "User-Agent": NWS_USER_AGENT,
          Accept: "application/geo+json",
        },
      },
    );

  const periods =
    forecast.properties?.periods ?? [];

  if (!periods.length) {
    throw new Error(
      "NWS returned no forecast periods",
    );
  }

  const target =
    new Date(gameTime).getTime();

  let selected = periods[0];
  let closestDistance = Infinity;

  for (const period of periods) {
    if (!period.startTime) {
      continue;
    }

    const time =
      new Date(period.startTime).getTime();

    const distance = Math.abs(
      time - target,
    );

    if (distance < closestDistance) {
      closestDistance = distance;
      selected = period;
    }
  }

  const selectedTime =
    selected.startTime ?? gameTime;

  const temperature =
    typeof selected.temperature === "number"
      ? fahrenheitFromNws(
          selected.temperature,
          selected.temperatureUnit,
        )
      : null;

  /*
   * Find the forecast periods on the same local
   * calendar date as kickoff so H/L represent
   * the game's forecast day rather than the current day.
   */
  const targetLocalDate =
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(gameTime));

  const sameDayPeriods =
    periods.filter((period) => {
      if (!period.startTime) {
        return false;
      }

      const localDate =
        new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(
          new Date(period.startTime),
        );

      return localDate === targetLocalDate;
    });

  const temperatures = sameDayPeriods
    .map((period) =>
      fahrenheitFromNws(
        period.temperature,
        period.temperatureUnit,
      ),
    )
    .filter(
      (value): value is number =>
        typeof value === "number",
    );

  const high =
    temperatures.length
      ? Math.max(...temperatures)
      : null;

  const low =
    temperatures.length
      ? Math.min(...temperatures)
      : null;

  const condition =
    conditionFromNws(
      selected.shortForecast,
    );

  return {
    isIndoor: false,
    temperature,
    high,
    low,
    condition,
    emoji: weatherEmoji(
      condition,
      selectedTime,
      timeZone,
    ),
  };
}

async function fetchInternationalForecast(
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
          "User-Agent": MET_USER_AGENT,
          Accept: "application/json",
        },
      },
    );

  const timeseries =
    forecast.properties?.timeseries ?? [];

  if (!timeseries.length) {
    throw new Error(
      "MET Norway returned no forecast data",
    );
  }

  /*
   * IMPORTANT:
   * MET Norway timestamps are UTC.
   * We compare their absolute timestamps against
   * the ESPN kickoff timestamp, so the selected
   * temperature is the forecast closest to kickoff.
   */
  const target =
    new Date(gameTime).getTime();

  let selected = timeseries[0];
  let closestDistance = Infinity;

  for (const item of timeseries) {
    const itemTime =
      new Date(item.time).getTime();

    const distance = Math.abs(
      itemTime - target,
    );

    if (distance < closestDistance) {
      closestDistance = distance;
      selected = item;
    }
  }

  const details =
    selected.data?.instant?.details;

  const celsiusTemperature =
    details?.air_temperature;

  const temperature =
    typeof celsiusTemperature === "number"
      ? celsiusToFahrenheit(
          celsiusTemperature,
        )
      : null;

  const symbol =
    selected.data?.next_1_hours
      ?.summary?.symbol_code ??
    selected.data?.next_6_hours
      ?.summary?.symbol_code;

  const condition =
    conditionFromMetSymbol(symbol);

  /*
   * Build H/L from the forecast's available
   * temperatures for the same local calendar day.
   */
  const targetLocalDate =
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(gameTime));

  const sameDay = timeseries.filter(
    (item) => {
      const localDate =
        new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(item.time));

      return localDate === targetLocalDate;
    },
  );

  const forecastTemperatures: number[] =
    [];

  for (const item of sameDay) {
    const instantTemp =
      item.data?.instant?.details
        ?.air_temperature;

    if (typeof instantTemp === "number") {
      forecastTemperatures.push(
        celsiusToFahrenheit(
          instantTemp,
        ),
      );
    }

    const max =
      item.data?.next_6_hours
        ?.details?.air_temperature_max;

    const min =
      item.data?.next_6_hours
        ?.details?.air_temperature_min;

    if (typeof max === "number") {
      forecastTemperatures.push(
        celsiusToFahrenheit(max),
      );
    }

    if (typeof min === "number") {
      forecastTemperatures.push(
        celsiusToFahrenheit(min),
      );
    }
  }

  const high =
    forecastTemperatures.length
      ? Math.max(
          ...forecastTemperatures,
        )
      : null;

  const low =
    forecastTemperatures.length
      ? Math.min(
          ...forecastTemperatures,
        )
      : null;

  return {
    isIndoor: false,
    temperature,
    high,
    low,
    condition,
    emoji: weatherEmoji(
      condition,
      gameTime,
      timeZone,
    ),
  };
}

async function fetchIemHistorical(
  station: string,
  gameTime: string,
  timeZone: string,
): Promise<GameWeather> {
  const gameDate = new Date(gameTime);

  if (Number.isNaN(gameDate.getTime())) {
    throw new Error(
      "Invalid game time for IEM historical weather",
    );
  }

  const localDate =
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(gameDate);

  const [year, month, day] =
    localDate.split("-").map(Number);

  const start =
    `${year}-${String(month).padStart(
      2,
      "0",
    )}-${String(day).padStart(2, "0")}`;

  const nextDay =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + 1,
      ),
    );

  const end =
    `${nextDay.getUTCFullYear()}-${String(
      nextDay.getUTCMonth() + 1,
    ).padStart(2, "0")}-${String(
      nextDay.getUTCDate(),
    ).padStart(2, "0")}`;

  const url =
    `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${encodeURIComponent(
      station,
    )}&data=tmpf&data=wxcodes&data=skyc1&data=skyc2&data=skyc3&data=skyc4&year1=${year}&month1=${month}&day1=${day}&year2=${nextDay.getUTCFullYear()}&month2=${nextDay.getUTCMonth() + 1}&day2=${nextDay.getUTCDate()}&tz=UTC&format=json&latlon=no&elev=no&missing=M&trace=T&report_type=3&report_type=4`;

  const response =
    await fetch(url, {
      headers: {
        "User-Agent": MET_USER_AGENT,
        Accept: "application/json",
      },
    });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `IEM HTTP ${response.status}: ${body.slice(
        0,
        500,
      )}`,
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
      `IEM returned no observations for ${station} on ${localDate}`,
    );
  }

  const target =
    gameDate.getTime();

  let selected =
    observations[0];

  let closestDistance =
    Infinity;

  for (const observation of observations) {
    if (!observation.valid) {
      continue;
    }

    const timestamp =
      new Date(
        observation.valid,
      ).getTime();

    if (Number.isNaN(timestamp)) {
      continue;
    }

    const distance =
      Math.abs(timestamp - target);

    if (distance < closestDistance) {
      closestDistance = distance;
      selected = observation;
    }
  }

  const temperature =
    typeof selected.tmpf === "number"
      ? Math.round(selected.tmpf)
      : typeof selected.tmpf === "string" &&
          selected.tmpf.trim() !== ""
        ? Math.round(
            Number(selected.tmpf),
          )
        : null;

  /*
   * Daily high/low from the actual observations.
   */
  const temperatures =
    observations
      .map((observation) => {
        if (
          typeof observation.tmpf ===
          "number"
        ) {
          return observation.tmpf;
        }

        if (
          typeof observation.tmpf ===
            "string" &&
          observation.tmpf.trim() !== ""
        ) {
          const value =
            Number(observation.tmpf);

          return Number.isFinite(value)
            ? value
            : null;
        }

        return null;
      })
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value),
      );

  const high =
    temperatures.length
      ? Math.round(
          Math.max(...temperatures),
        )
      : null;

  const low =
    temperatures.length
      ? Math.round(
          Math.min(...temperatures),
        )
      : null;

  const condition =
    conditionFromIem(selected);

  const selectedTime =
    selected.valid ?? gameTime;

  return {
    isIndoor: false,
    temperature,
    high,
    low,
    condition,
    emoji: weatherEmoji(
      condition,
      selectedTime,
      timeZone,
    ),
  };
}

function getIemStationForTeam(
  teamId: string,
): string | null {
  /*
   * Primary airport/ASOS station near each NFL stadium.
   *
   * These are used only for HISTORICAL observations.
   * Upcoming U.S. games use NWS directly at the stadium.
   */
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
    "22": "KMIN",
    "23": "KNAS",
    "24": "KNYC",
    "25": "KJFK",
    "26": "KORF",
    "27": "KPIT",
    "28": "KSFO",
    "29": "KSTL",
    "30": "KSEA",
    "31": "KTBM",
    "32": "KCLT",
  };

  return (
    stations[teamId] ??
    null
  );
}

async function fetchGameWeather(
  data: WeatherRequest,
): Promise<GameWeather> {
  const {
    gameId,
    homeTeamId,
    venue,
    status,
  } = data;

  /*
   * Get ESPN's actual kickoff time first.
   * This is essential for:
   * - historical observations
   * - game-time forecasts
   * - correct day/night emoji
   */
  const summary =
    await fetchEspnSummary(gameId);

  const gameTime =
    getGameStartTime(summary);

  const summaryVenue =
    getVenueFromSummary(summary);

  const actualVenue =
    venue ??
    summaryVenue;

  /*
   * INTERNATIONAL VENUE CHECK MUST COME FIRST.
   *
   * ESPN can designate an NFL team as the home
   * team even though the game is in London/Germany/etc.
   */
  const international =
    getInternationalVenue(
      actualVenue,
    );

  if (international) {
    /*
     * International stadiums that are actually
     * indoor/covered are not currently included here.
     * All venues above are treated as outdoor.
     */
    if (!gameTime) {
      throw new Error(
        "ESPN did not provide a game start time",
      );
    }

    if (
      isUpcomingStatus(status) ||
      isLiveStatus(status)
    ) {
      return fetchInternationalForecast(
        international.latitude,
        international.longitude,
        gameTime,
        international.timeZone,
      );
    }

    return fetchIemHistorical(
      international.iemStation,
      gameTime,
      international.timeZone,
    );
  }

  /*
   * Normal U.S. stadium handling.
   */
  const stadium =
    getStadiumForGame(
      homeTeamId,
      actualVenue,
    );

  if (stadium?.isIndoor) {
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
    getStadiumCoordinates(stadium);

  if (!coordinates) {
    throw new Error(
      `No valid stadium coordinates for team ${homeTeamId}`,
    );
  }

  const timeZone =
    getTimeZoneForLocation(
      coordinates.latitude,
      coordinates.longitude,
      actualVenue,
    );

  if (!gameTime) {
    throw new Error(
      "ESPN did not provide a game start time",
    );
  }

  /*
   * Completed games:
   * use actual historical observations from IEM.
   */
  if (isCompletedStatus(status)) {
    const station =
      getIemStationForTeam(
        homeTeamId,
      );

    if (!station) {
      throw new Error(
        `No IEM station configured for ${homeTeamId}`,
      );
    }

    return fetchIemHistorical(
      station,
      gameTime,
      timeZone,
    );
  }

  /*
   * Upcoming/live U.S. games:
   * use NWS forecast at the actual stadium coordinates.
   *
   * The selected temperature is the forecast period
   * closest to actual kickoff.
   */
  return fetchNwsForecast(
    coordinates.latitude,
    coordinates.longitude,
    gameTime,
    timeZone,
  );
}

export {
  fetchGameWeather,
};
