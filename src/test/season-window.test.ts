import { describe, expect, it } from "vitest";
import { showUpcoming } from "@/lib/shared/season-window";

const now = Date.parse("2026-11-10T12:00:00Z");
const d = (days: number) => new Date(now + days * 86_400_000).toISOString();

describe("showUpcoming", () => {
  it("hides in the offseason until a week before the first game", () => {
    const games = [
      { when: d(-40), status: "final" },
      { when: d(130), status: "scheduled" },
    ];
    expect(showUpcoming(games, now)).toBe(false);
    expect(showUpcoming(games, now + 124 * 86_400_000)).toBe(true);
  });
  it("hides when the season is over and nothing is scheduled", () => {
    expect(showUpcoming([{ when: d(-3), status: "final" }], now)).toBe(false);
  });
  it("stays up through an in-season break", () => {
    const games = [
      { when: d(-2), status: "final" },
      { when: d(12), status: "scheduled" },
    ];
    expect(showUpcoming(games, now)).toBe(true);
  });
  it("ignores preseason games", () => {
    const games = [
      { when: d(-60), status: "final" },
      { when: d(2), status: "scheduled", preseason: true },
      { when: d(30), status: "scheduled" },
    ];
    expect(showUpcoming(games, now)).toBe(false);
  });
  it("shows during the season", () => {
    expect(showUpcoming([{ when: d(1), status: "scheduled" }], now)).toBe(true);
  });
});
