import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GamePropLines } from "@/components/shared/PropHistory";
import type { UpcomingPropGame } from "@/lib/shared/prop-history.server";

const board: UpcomingPropGame = {
  id: "1",
  date: "2026-11-15T18:00:00Z",
  name: "Los Angeles Rams at Arizona Cardinals",
  away: { abbr: "LAR", name: "Los Angeles Rams" },
  home: { abbr: "ARI", name: "Arizona Cardinals" },
  props: [
    ["Matthew Stafford", "LAR", "Completions", 20.5, -101, -126, 20.5],
    ["Matthew Stafford", "LAR", "Pass yds", 240.5, -113, -113, 240.5],
    ["Kyren Williams", "LAR", "Rush yds", 70.5, -110, -110, 70.5],
  ],
  bp: {
    "Matthew Stafford|Completions": [115, "BetMGM", -126, "DraftKings"],
    "Matthew Stafford|Pass yds": [-113, "DraftKings", -110, "theScore Bet"],
  },
};

describe("props: best price across the big books", () => {
  it("shows the best price with its book underneath, else DraftKings'", () => {
    render(<GamePropLines league="nfl" game={board} title="Player props" />);
    expect(screen.getByText("+115")).toBeTruthy();
    expect(screen.getByText("BetMGM")).toBeTruthy();
    expect(screen.getByText("theScore Bet")).toBeTruthy();
    expect(screen.queryByText("-101")).toBeNull(); // DraftKings' worse over is replaced
    expect(screen.getAllByText("DraftKings").length).toBeGreaterThan(0);
  });
});
