import { describe, expect, it } from "vitest";
import { EARLY_GAMES, MARKET_WEIGHT, marketWeight } from "@/lib/cbb/cbb-model";

describe("college basketball early-season market weight", () => {
  it("leans on the market's view while either team has 8 or fewer games, then 50/50", () => {
    expect(marketWeight(3)).toBe(0.7);
    expect(marketWeight(EARLY_GAMES)).toBe(0.7);
    expect(marketWeight(EARLY_GAMES + 1)).toBe(MARKET_WEIGHT);
    expect(marketWeight(25)).toBe(0.5);
  });
});
