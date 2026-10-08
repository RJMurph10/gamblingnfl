import { getStadiumForGame, type StadiumInfo } from "./stadiums";

export interface GameWeather {
  isIndoor: boolean;
  temperature: number | null;
  condition: string;
  emoji: string;
  high: number | null;
  low: number | null;
  capturedAt: string;
}

/** Memory cache for frozen completed games (so final weather never changes). */
const completedGamesWeather = new Map<string, GameWeather>();

/** Live/upcoming weather cache with a 10-minute TTL. */
interface LiveCacheEntry {
  data: GameWeather;
  timestamp: number;
}
const liveWeatherCache = new Map<string, LiveCacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * WMO Weather interpretation codes (Open-Meteo standard)
 */
function mapWmoCode(code: number, isDay: boolean, windSpeedMph: number): { condition: string; emoji: string } {
  // Windy / Breezy override
  if (windSpeedMph >= 25 && code <= 3) {
    return { condition: "Windy", emoji: "💨" };
  }
  if (windSpeedMph >= 18 && code <= 3) {
    return { condition: "Breezy", emoji: "🌬️" };
  }

  switch (code) {
    case 0:
      return isDay ? { condition: "Sunny", emoji: "☀️" } : { condition: "Clear", emoji: "🌙" };
    case 1:
      return isDay ? { condition: "Mainly Clear", emoji: "🌤️" } : { condition: "Clear", emoji: "🌙" };
    case 2:
      return isDay ? { condition: "Partly Cloudy", emoji: "🌤️" } : { condition: "Partly Cloudy", emoji: "☁️" };
    case 3:
      return { condition: "Cloudy", emoji: "☁️" };
    case 45:
    case 48:
      return { condition: "Foggy", emoji: "🌫️" };
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return { condition: "Drizzle", emoji: "🌦️" };
    case 61:
    case 63:
    case 65:
      return { condition: "Rain", emoji: "🌧️" };
    case 66:
    case 67:
      return { condition: "Freezing Rain", emoji: "🌧️" };
    case 71:
    case 73:
    case 75:
    case 77:
      return { condition: "Snow", emoji: "🌨️" };
    case 80:
    case 81:
    case 82:
      return { condition: "Showers", emoji: "🌦️" };
    case 85:
    case 86:
      return { condition: "Snow Showers", emoji: "🌨️" };
    case 95:
    case 96:
    case 99:
      return { condition: "Thunderstorms", emoji: "⛈️" };
    default:
      return isDay ? { condition: "Clear", emoji: "☀️" } : { condition: "Clear", emoji: "🌙" };
  }
}

export async function fetchGameWeather(params: {
  gameId: string;
  homeTeamId: string;
  venue?: string;
  status: string;
}): Promise<GameWeather> {
  const stadium = getStadiumForGame(params.homeTeamId, params.venue);

  // Indoor / Climate-controlled stadiums
  if (stadium.isIndoor) {
    return {
      isIndoor: true,
      temperature: null,
      condition: "Indoor",
      emoji: "🏟️",
      high: null,
      low: null,
      capturedAt: new Date().toISOString(),
    };
  }

  const isFinal = params.status.toLowerCase() === "final";

  // If the game is completed and weather was already frozen, return permanently saved weather
  if (isFinal && completedGamesWeather.has(params.gameId)) {
    return completedGamesWeather.get(params.gameId)!;
  }

  // Check 10-minute live cache for active/upcoming games
  if (!isFinal) {
    const cached = liveWeatherCache.get(params.gameId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  // Open-Meteo free API call (server-side, zero keys)
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${stadium.lat}&longitude=${stadium.lon}&current=temperature_2m,weather_code,is_day,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": "GamblingNFL/1.0" } });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json();

    const temp = Math.round(data.current?.temperature_2m ?? 65);
    const code = Number(data.current?.weather_code ?? 0);
    const isDay = Number(data.current?.is_day ?? 1) === 1;
    const wind = Number(data.current?.wind_speed_10m ?? 0);
    const high = Math.round(data.daily?.temperature_2m_max?.[0] ?? temp);
    const low = Math.round(data.daily?.temperature_2m_min?.[0] ?? temp);

    const { condition, emoji } = mapWmoCode(code, isDay, wind);

    const weatherResult: GameWeather = {
      isIndoor: false,
      temperature: temp,
      condition,
      emoji,
      high,
      low,
      capturedAt: new Date().toISOString(),
    };

    if (isFinal) {
      // Permanently lock/freeze completed game weather
      completedGamesWeather.set(params.gameId, weatherResult);
    } else {
      liveWeatherCache.set(params.gameId, { data: weatherResult, timestamp: Date.now() });
    }

    return weatherResult;
  } catch (err) {
    console.warn("Weather fetch failed, using fallback:", err);
    return {
      isIndoor: false,
      temperature: 68,
      condition: "Clear",
      emoji: "☀️",
      high: 72,
      low: 55,
      capturedAt: new Date().toISOString(),
    };
  }
}
