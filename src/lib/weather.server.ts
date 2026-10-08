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

function findWeatherObjects(
  value: unknown,
  path = "root",
  results: string[] = [],
): string[] {
  if (!value || typeof value !== "object") {
    return results;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      findWeatherObjects(
        value[i],
        `${path}[${i}]`,
        results,
      );
    }

    return results;
  }

  const object = value as Record<string, unknown>;

  for (const [key, child] of Object.entries(object)) {
    const lowerKey = key.toLowerCase();

    if (
      lowerKey.includes("weather") ||
      lowerKey.includes("temperature") ||
      lowerKey === "temp" ||
      lowerKey === "condition"
    ) {
      let preview = "";

      try {
        preview =
          typeof child === "object"
            ? JSON.stringify(child)
            : String(child);
      } catch {
        preview = "[unserializable]";
      }

      results.push(
        `${path}.${key} = ${preview.slice(0, 500)}`,
      );
    }

    findWeatherObjects(
      child,
      `${path}.${key}`,
      results,
    );
  }

  return results;
}

async function fetchEspnPackage(
  gameId: string,
): Promise<unknown> {
  const eventId =
    gameId.replace(/^espn-/, "");

  const url =
    `https://cdn.espn.com/core/nfl/game?xhr=1&gameId=${encodeURIComponent(eventId)}`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
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

    const text =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `ESPN CDN HTTP ${response.status}: ${text.slice(0, 300)}`,
      );
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
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
   * Keep indoor games working exactly as before.
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
   * TEMPORARY ESPN DIAGNOSTIC
   */
  try {
    const data =
      await fetchEspnPackage(
        params.gameId,
      );

    const matches =
      findWeatherObjects(data);

    console.log(
      "[ESPN WEATHER DIAGNOSTIC]",
      {
        gameId: params.gameId,
        stadium: stadium.name,
        matches,
      },
    );

    /*
     * Put the discovered ESPN fields directly into
     * the card temporarily so we can see them on mobile.
     */
    if (matches.length > 0) {
      return {
        isIndoor: false,
        temperature: null,
        condition:
          matches
            .join(" | ")
            .slice(0, 180),
        emoji: "🔎",
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
        "ESPN: No weather data found",
      emoji: "🔎",
      high: null,
      low: null,
      capturedAt:
        new Date().toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "[ESPN WEATHER DIAGNOSTIC ERROR]",
      message,
    );

    return {
      isIndoor: false,
      temperature: null,
      condition:
        `ESPN Error: ${message}`.slice(
          0,
          180,
        ),
      emoji: "⚠️",
      high: null,
      low: null,
      capturedAt:
        new Date().toISOString(),
    };
  }
}
