import { describe, expect, it } from "vitest";
import { parseGameInfo } from "@/lib/shared/espn-core.server";

describe("ESPN's weather line", () => {
  it("reads the condition from conditionId and adds rain chance and gusts (WSH @ NYG, Nov 12 2026)", () => {
    const info = parseGameInfo({
      gameInfo: {
        weather: {
          temperature: 48,
          highTemperature: 48,
          lowTemperature: 48,
          conditionId: "Cloudy",
          gust: 13,
          precipitation: 85,
          link: { href: "http://www.accuweather.com/x", text: "Weather" },
        },
      },
    });
    expect(info?.weather?.summary).toBe("48°, Cloudy · 85% chance of rain · gusts 13 mph");
  });

  it("skips a bare AccuWeather icon code", () => {
    const info = parseGameInfo({
      gameInfo: { weather: { displayValue: "7", temperature: 48, conditionId: "Cloudy" } },
    });
    expect(info?.weather?.summary).toBe("48°, Cloudy");
  });
});
