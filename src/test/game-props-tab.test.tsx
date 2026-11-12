import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Game } from "@/data/shared/games";
import type { Team } from "@/data/shared/teams";
import { findPropGame, historyKey, resultsOf } from "@/components/shared/GamePropsTab";
import { GamePropLines } from "@/components/shared/PropHistory";
import type { PropHistoryGame, UpcomingPropGame } from "@/lib/shared/prop-history.server";

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

describe("finished games", () => {
  it("finds the prop-history day and season like the history builder (US date, NFL season year)", () => {
    expect(historyKey("2026-11-10T01:15:00Z")).toEqual({ season: "2026", day: "2026-11-09" });
    expect(historyKey("2027-01-04T18:00:00Z")).toEqual({ season: "2026", day: "2027-01-04" });
    expect(historyKey("2026-09-10T00:20:00Z")).toEqual({ season: "2026", day: "2026-09-09" });
  });

  it("shows the closing line, the player's number and over/under", () => {
    const past = {
      id: board.id,
      date: board.date,
      name: board.name,
      away: { abbr: "WSH", name: "Washington Commanders", score: 17 },
      home: { abbr: "NYG", name: "New York Giants", score: 20 },
      props: [
        ["Cam Skattebo", "NYG", "Carries", 13.5, null, null, 18],
        ["Jayden Daniels", "WSH", "Pass yds", 212.5, null, null, 188],
        ["Stefon Diggs", "WSH", "Rec yds", 46.5, null, null, 39.5],
      ],
    } as PropHistoryGame;
    const results = resultsOf(past);
    render(<GamePropLines league="nfl" game={board} title="Player props" results={results} />);
    expect(screen.getByText("Close")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
    const row = (name: string) => screen.getByText(new RegExp(name)).closest("tr")!;
    expect(row("Cam Skattebo").textContent).toMatch(/18over/i); // 18 carries vs 15.5
    expect(row("Jayden Daniels").textContent).toMatch(/188under/i);
    expect(row("Stefon Diggs").textContent).toMatch(/39.5push/i); // 39.5 vs the 39.5 close
    expect(row("Malik Nabers").textContent).toMatch(/—$/); // no result yet
    expect(screen.getByText(/1 over/)).toBeTruthy();
    expect(screen.getByText(/1 under/)).toBeTruthy();
  });
});

describe("history-only games", () => {
  it("drops the Opened and Move columns when no line has an opener", () => {
    const noOpen = {
      ...board,
      props: board.props.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], null] as typeof r),
    };
    render(
      <GamePropLines
        league="nfl"
        game={noOpen}
        title="Player props"
        results={new Map()}
        lineLabel="Line"
      />,
    );
    expect(screen.queryByText("Opened")).toBeNull();
    expect(screen.queryByText("Move")).toBeNull();
    expect(screen.getByText("Line")).toBeTruthy();
  });
});
