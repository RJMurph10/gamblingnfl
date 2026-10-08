import { describe, expect, it } from "vitest";
import { showGameStatistics } from "@/lib/game-visibility";

describe("game statistics visibility", () => {
  it("hides statistics before a scheduled game starts", () => {
    expect(showGameStatistics("scheduled")).toBe(false);
  });

  it("shows statistics as soon as a game is live", () => {
    expect(showGameStatistics("live")).toBe(true);
  });

  it("keeps statistics available after the game finishes", () => {
    expect(showGameStatistics("final")).toBe(true);
  });
});