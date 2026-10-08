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

const DEFAULT_INDOOR_TEMPERATURE = 72;

async function fetchWeatherApi(url: string): Promise<any> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 12000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${text.slice(0, 300)}`,
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Invalid JSON response: ${text.slice(0, 300)}`,
      );
    }
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "REQUEST TIMEOUT after 12 seconds",
      );
    }

    if (error instanceof Error) {
      throw new Error(error.message);
    }

    throw new Error(String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function mapWmoCode(
  code: number,
  isDay: boolean,
  windSpeedMph: number,
) {
  if (windSpeedMph >= 25 && code <= 3) {
    return {
      condition: "Windy",
      emoji: "💨",
    };
  }

  if (windSpeedMph >= 18 && code <= 3) {
    return {
      condition: "Breezy",
      emoji: "🌬️",
    };
  }

  switch (code) {
    case 0:
      return isDay
        ? { condition: "Sunny", emoji: "☀️" }
        : { condition: "Clear", emoji: "🌙" };

    case 1:
      return isDay
        ? { condition: "Mainly Clear", emoji: "🌤️" }
        : { condition: "Clear", emoji: "🌙" };

    case 2:
      return {
        condition: "Partly Cloudy",
        emoji: "🌤️",
      };

    case 3:
      return {
        condition: "Cloudy",
        emoji: "☁️",
      };

    case 45:
    case 48:
      return {
        condition: "Foggy",
        emoji: "🌫️",
      };

    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return {
        condition: "Drizzle",
        emoji: "🌦️",
      };

    case 61:
    case 63:
    case 65:
      return {
        condition: "Rain",
        emoji: "🌧️",
      };

    case 66:
    case 67:
      return {
        condition: "Freezing Rain",
        emoji: "🌧️",
      };

    case 71:
    case 73:
    case 75:
    case 77:
      return {
        condition: "Snow",
        emoji: "🌨️",
      };

    case 80:
    case 81:
    case 82:
      return {
        condition: "Showers",
        emoji: "🌦️",
      };

    case 85:
    case 86:
      return {
        condition: "Snow Showers",
        emoji: "🌨️",
      };

    case 95:
    case 96:
    case 99:
      return {
        condition: "Thunderstorms",
        emoji: "⛈️",
      };

    default:
      return isDay
        ? { condition: "Clear", emoji: "☀️" }
        : { condition: "Clear", emoji: "🌙" };
  }
}

async function fetchCurrentGameWeather(params: {
  lat: number;
  lon: number;
}): Promise<GameWeather> {
  const url = new URL(
    "https://api.open-meteo.com/v1/forecast",
  );

  url.searchParams.set(
    "latitude",
    String(params.lat),
  );

  url.searchParams.set(
    "longitude",
    String(params.lon),
  );

  url.searchParams.set(
    "current",
    "temperature_2m,weather_code,is_day,wind_speed_10m",
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
    "wind_speed_unit",
    "mph",
  );

  url.searchParams.set(
    "timezone",
    "auto",
  );

  const data =
    await fetchWeatherApi(url.toString());

  if (!data?.current) {
    throw new Error(
      "Open-Meteo returned no current object",
    );
  }

  const temperature =
    Number(data.current.temperature_2m);

  if (!Number.isFinite(temperature)) {
    throw new Error(
      "Open-Meteo returned invalid temperature",
    );
  }

  const weatherCode =
    Number(
      data.current.weather_code ?? 0,
    );

  const isDay =
    Number(
      data.current.is_day ?? 1,
    ) === 1;

  const windSpeed =
    Number(
      data.current.wind_speed_10m ?? 0,
    );

  const high =
    Number(
      data?.daily?.temperature_2m_max?.[0],
    );

  const low =
    Number(
      data?.daily?.temperature_2m_min?.[0],
    );

  const mapped =
    mapWmoCode(
      weatherCode,
      isDay,
      windSpeed,
    );

  return {
    isIndoor: false,
    temperature: Math.round(temperature),
    condition: mapped.condition,
    emoji: mapped.emoji,
    high: Number.isFinite(high)
      ? Math.round(high)
      : Math.round(temperature),
    low: Number.isFinite(low)
      ? Math.round(low)
      : Math.round(temperature),
    capturedAt: new Date().toISOString(),
  };
}

export async function fetchGameWeather(params: {
  gameId: string;
  homeTeamId: string;
  venue?: string;
  status: string;
}): Promise<GameWeather> {
  const stadium =
    getStadiumForGame(
      params.homeTeamId,
      params.venue,
    );

  /*
   * Indoor stadiums bypass the weather API.
   */
  if (stadium.isIndoor) {
    return {
      isIndoor: true,
      temperature:
        DEFAULT_INDOOR_TEMPERATURE,
      condition: "Indoor",
      emoji: "🏟️",
      high: null,
      low: null,
      capturedAt: new Date().toISOString(),
    };
  }

  /*
   * TEMPORARY DIAGNOSTIC:
   * Actually contact Open-Meteo and expose the exact
   * failure instead of hiding it behind "Unavailable".
   */
  try {
    return await fetchCurrentGameWeather({
      lat: stadium.lat,
      lon: stadium.lon,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "[Weather Diagnostic]",
      {
        gameId: params.gameId,
        homeTeamId: params.homeTeamId,
        stadium: stadium.name,
        lat: stadium.lat,
        lon: stadium.lon,
        error: message,
      },
    );

    return {
      isIndoor: false,
      temperature: null,
      condition: message.slice(0, 80),
      emoji: "⚠️",
      high: null,
      low: null,
      capturedAt: new Date().toISOString(),
    };
  }
}
