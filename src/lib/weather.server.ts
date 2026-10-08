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

export async function fetchGameWeather(params: {
  gameId: string;
  homeTeamId: string;
  venue?: string;
  status: string;
}): Promise<GameWeather> {
  const stadium = getStadiumForGame(
    params.homeTeamId,
    params.venue,
  );

  /*
   * INDOOR TEST
   * Keep the existing indoor behavior exactly as-is.
   */
  if (stadium.isIndoor) {
    return {
      isIndoor: true,
      temperature: DEFAULT_INDOOR_TEMPERATURE,
      condition: "Indoor",
      emoji: "🏟️",
      high: null,
      low: null,
      capturedAt: new Date().toISOString(),
    };
  }

  /*
   * OUTDOOR DIAGNOSTIC TEST
   *
   * IMPORTANT:
   * This intentionally does NOT contact Open-Meteo.
   *
   * If this appears on your phone, we know the problem
   * is specifically with the external weather request.
   */
  return {
    isIndoor: false,
    temperature: 72,
    condition: "Weather Test",
    emoji: "☀️",
    high: 75,
    low: 60,
    capturedAt: new Date().toISOString(),
  };
}
