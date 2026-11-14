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

describe("props: alternate lines at the best book", () => {
  it("shows each rung's best price with a short book tag", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const game: UpcomingPropGame = {
      ...board,
      props: [
        [
          "Trey McBride",
          "ARI",
          "Rec yds",
          64.5,
          -110,
          -110,
          64.5,
          [
            [49.5, -194, "DraftKings"],
            [69.5, 144, "FanDuel"],
            [79.5, 220],
          ],
        ],
      ],
      bp: { "Trey McBride|Rec yds": [-105, "BetMGM", -110, "DraftKings"] },
    };
    render(<GamePropLines league="nfl" game={game} title="Player props" />);
    fireEvent.click(screen.getByRole("tab", { name: "Receiving" }));
    fireEvent.click(screen.getByRole("button", { name: /alternate lines/i }));
    expect(screen.getByText("FD")).toBeTruthy();
    expect(screen.getAllByText("DK").length).toBe(2); // 50+ and the untagged 80+
    expect(screen.getByText("MGM")).toBeTruthy(); // the main line's best over
  });
});
