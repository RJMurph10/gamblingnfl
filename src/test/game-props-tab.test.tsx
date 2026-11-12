import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Game } from "@/data/shared/games";
import type { Team } from "@/data/shared/teams";
import { findPropGame } from "@/components/shared/GamePropsTab";
import { GamePropLines } from "@/components/shared/PropHistory";
import type { UpcomingPropGame } from "@/lib/shared/prop-history.server";

const board: UpcomingPropGame = {
  id: "401773100",
  date: "2026-11-13T01:15:00Z",
  name: "Washington Commanders at New York Giants",
  at: "2026-11-11T22:17:00Z",
  away: { abbr: "WSH", name: "Washington Commanders" },
  home: { abbr: "NYG", name: "New York Giants" },
  props: [
    ["Cam Skattebo", "NYG", "Carries", 15.5, -102, -125, 13.5],
    [
      "Malik Nabers",
      "NYG",
      "Rec yds",
      69.5,
      -111,
      -113,
      69.5,
      [
        [59.5, -160],
        [79.5, +130],
      ],
    ],
    ["Jayden Daniels", "WSH", "Pass yds", 200.5, -113, -111, 212.5],
    ["Stefon Diggs", "WSH", "Rec yds", 39.5, -114, -110, 46.5],
  ],
};
const team = (abbr: string) => ({ abbr }) as Team;

describe("NFL game page props tab", () => {
  it("finds the game's saved lines by ESPN id, else by teams and date", () => {
    const g = { id: "espn-401773100", kickoffIso: board.date } as Game;
    expect(findPropGame([board], g, team("WSH"), team("NYG"))?.id).toBe("401773100");
    const other = { id: "espn-999", kickoffIso: "2026-11-13T00:00:00Z" } as Game;
    expect(findPropGame([board], other, team("WSH"), team("NYG"))?.id).toBe("401773100");
    expect(findPropGame([board], other, team("DAL"), team("NYG"))).toBeUndefined();
    const nextYear = { id: "espn-998", kickoffIso: "2027-11-13T00:00:00Z" } as Game;
    expect(findPropGame([board], nextYear, team("WSH"), team("NYG"))).toBeUndefined();
  });

  it("shows line, opener and move, and filters by team and market", () => {
    render(<GamePropLines league="nfl" game={board} title="Player props" />);
    expect(screen.getByText("Player props")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(5); // header + 4
    expect(screen.getByTitle("Down 12 since it opened")).toBeTruthy(); // Daniels 212.5 → 200.5
    fireEvent.click(screen.getByRole("button", { name: "WSH players" }));
    expect(screen.queryByText("Cam Skattebo")).toBeNull();
    expect(screen.getByText(/Jayden Daniels/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Rec yds$/i }));
    expect(screen.getAllByRole("row")).toHaveLength(2); // Diggs only
  });
});
