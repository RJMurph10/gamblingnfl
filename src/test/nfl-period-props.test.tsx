import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GamePropLines } from "@/components/shared/PropHistory";
import { TdScorers } from "@/components/shared/TdScorers";
import type { UpcomingPropGame } from "@/lib/shared/prop-history.server";
// @ts-expect-error plain JS module without types
import { footballPeriods } from "../../scripts/line-history/prop-markets.mjs";
// @ts-expect-error plain JS module without types
import { statsByLabel } from "../../scripts/line-history/prop-grading.mjs";
// @ts-expect-error plain JS module without types
import { loadPrices } from "../../scripts/line-history/odds-api-prices.mjs";

const who = (id: string) => ({ $ref: `http://x/athletes/${id}?lang=en` });
const play = (type: string, q: number, text: string, parts: [string, string][]) => ({
  type: { id: type },
  period: { number: q },
  text,
  statYardage: 99, // ESPN's number includes penalty yards: the text wins
  participants: parts.map(([t, id]) => ({ type: t, athlete: who(id) })),
});
const plays = [
  play("24", 1, "J.Hurts pass short right to A.Brown to DAL 30 for 12 yards (X).", [
    ["passer", "1"],
    ["receiver", "2"],
  ]),
  play("3", 1, "J.Hurts pass incomplete deep left to A.Brown.", [
    ["passer", "1"],
    ["receiver", "2"],
  ]),
  play("5", 2, "S.Barkley left tackle for 7 yards. PENALTY on DAL, 15 yards.", [["rusher", "3"]]),
  play("67", 3, "J.Hurts pass short middle to A.Brown for 41 yards, TOUCHDOWN.", [
    ["passer", "1"],
    ["receiver", "2"],
  ]),
  play("8", 3, "J.Hurts pass to A.Brown for 20 yards. PENALTY on PHI, Holding - No Play.", [
    ["passer", "1"],
    ["receiver", "2"],
  ]),
];
const box = {
  "1": {
    n: "Jalen Hurts",
    tm: "PHI",
    pos: "QB",
    s: { "passing.C/ATT": "2/3", "passing.YDS": "53", "passing.TD": "1", "passing.INT": "0" },
  },
  "2": {
    n: "A.J. Brown",
    tm: "PHI",
    pos: "WR",
    s: { "receiving.REC": "2", "receiving.YDS": "53" },
  },
  "3": { n: "Saquon Barkley", tm: "PHI", pos: "RB", s: { "rushing.CAR": "1", "rushing.YDS": "8" } },
};

describe("NFL 1st-half and quarter props", () => {
  it("adds up each player's quarters from the play-by-play and grades only what matches the box", () => {
    const ev = footballPeriods(plays, box);
    expect(ev.per["1"][1]).toMatchObject({ pa: 2, pc: 1, py: 12 });
    expect(ev.lc["1"]).toBe(41);
    expect(ev.bad["3"]).toEqual(["ry"]); // box says 8, the play says 7: Barkley's rushing stays ungraded
    const g = { box, ev };
    const f = statsByLabel("nfl");
    expect(f.get("1H Pass yds")(box["1"].s, { a: "1", g })).toBe(12);
    expect(f.get("3Q Rec yds")(box["2"].s, { a: "2", g })).toBe(41);
    expect(f.get("1Q Receptions")(box["2"].s, { a: "2", g })).toBe(1);
    expect(f.get("Longest comp")(box["1"].s, { a: "1", g })).toBe(41);
    expect(f.get("1H Rush yds")(box["3"].s, { a: "3", g })).toBeNull();
    expect(f.get("1H Pass yds")(box["1"].s, { a: "1", g: { box } })).toBeNull(); // no play-by-play
  });

  it("adds the props only the pulls carry, DraftKings first, with where each opened", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pulls-"));
    const game = (props: unknown[], others: unknown[]) => [
      {
        home: "Philadelphia Eagles",
        away: "Dallas Cowboys",
        commence: "2026-11-15T18:00:00Z",
        props,
        others,
        sides: { "Jalen Hurts": "home", "CeeDee Lamb": "away" },
        tdb: [["CeeDee Lamb", "away", 120, "FD"]],
        td: [["Jalen Hurts", "home", 300, 1200, 2000, 1200]],
      },
    ];
    writeFileSync(
      join(dir, "2026-11-13T15-sgo.json"),
      JSON.stringify(
        game(
          [["Jalen Hurts", "1H Pass yds", 110.5, -110, -110]],
          [["CeeDee Lamb", "1Q Rec yds", 14.5, -115, -105, "FD"]],
        ),
      ),
    );
    writeFileSync(
      join(dir, "2026-11-14T15-sgo.json"),
      JSON.stringify(
        game(
          [
            ["Jalen Hurts", "1H Pass yds", 115.5, -112, -108],
            ["Jalen Hurts", "Pass yds", 230.5, -110, -110],
          ],
          [],
        ),
      ),
    );
    const price = await loadPrices(dir);
    const extra = price.extra("Philadelphia Eagles", "2026-11-15T18:00:00Z");
    expect(extra).toContainEqual([
      "Jalen Hurts",
      "home",
      "1H Pass yds",
      115.5,
      -112,
      -108,
      110.5,
      null,
    ]);
    expect(extra).toContainEqual([
      "CeeDee Lamb",
      "away",
      "1Q Rec yds",
      14.5,
      -115,
      -105,
      14.5,
      "FD",
    ]);
    expect(extra.some((r: unknown[]) => r[2] === "Pass yds")).toBe(false);
    const td = price.td("Philadelphia Eagles", "2026-11-15T18:00:00Z");
    expect(td.find((r: unknown[]) => r[0] === "CeeDee Lamb")).toEqual([
      "CeeDee Lamb",
      "away",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      120,
      "FD",
    ]);
  });

  const board: UpcomingPropGame = {
    id: "1",
    date: "2026-11-15T18:00:00Z",
    name: "Dallas Cowboys at Philadelphia Eagles",
    away: { abbr: "DAL", name: "Dallas Cowboys" },
    home: { abbr: "PHI", name: "Philadelphia Eagles" },
    props: [
      ["Jalen Hurts", "PHI", "Pass yds", 230.5, -110, -110, 230.5],
      ["Jalen Hurts", "PHI", "Longest comp", 38.5, -110, -110, 38.5],
      ["Jalen Hurts", "PHI", "1H Pass yds", 115.5, -112, -108, 110.5],
      ["CeeDee Lamb", "DAL", "1Q Rec yds", 14.5, -115, -105, 14.5],
      ["CeeDee Lamb", "DAL", "3Q Rec yds", 12.5, -115, -105, 12.5],
    ],
    td: [["CeeDee Lamb", "DAL", null, null, null, null, null, null, null, null, 120, "FD"]],
  };

  it("shows them in their own tabs", () => {
    render(<GamePropLines league="nfl" game={board} title="Player props" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Passing",
      "1st Half",
      "1st Quarter",
      "Quarters",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Quarters" }));
    expect(screen.getByText(/3Q Rec yds/)).toBeTruthy();
  });

  it("shows the best anytime price across the books", () => {
    render(<TdScorers game={board} />);
    expect(screen.getByText("Best anytime")).toBeTruthy();
    expect(screen.getByText("+120")).toBeTruthy();
  });
});
