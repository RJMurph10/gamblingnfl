import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { mainLines } from "../../scripts/line-history/build-props-site.mjs";

// DraftKings' unlabeled sides: each item has px = [current price, open price], over first then under
const side = (a: string, line: number, price: number) => ({
  a,
  t: "Total Points",
  op: [line, null, null],
  px: [price, price],
});

describe("picking each player's main prop line", () => {
  it("keeps a lone line even when its prices are lopsided (1+ RBI style)", () => {
    const books = {
      "100": { name: "DraftKings", rows: [side("1", 0.5, 150), side("1", 0.5, -200)] },
    };
    expect(mainLines(books)).toEqual([
      expect.objectContaining({ a: "1", line: 0.5, o: 150, u: -200 }),
    ]);
  });

  it("among alternates, still takes the balanced line, not a lopsided one", () => {
    const books = {
      "100": {
        name: "DraftKings",
        rows: [
          side("2", 14.5, -400),
          side("2", 14.5, 290),
          side("2", 20.5, -112),
          side("2", 20.5, -108),
          side("2", 26.5, 330),
          side("2", 26.5, -450),
        ],
      },
    };
    expect(mainLines(books)).toEqual([
      expect.objectContaining({ a: "2", line: 20.5, o: -112, u: -108 }),
    ]);
  });
});

describe("closing board from the props history (MLB game pages)", () => {
  it("uses ESPN's last line and price as the close and keeps where it opened", async () => {
    // @ts-expect-error plain .mjs script without types
    const { closingBoard } = await import("../../scripts/line-history/build-props-site.mjs");
    // an item = one side: opened 5.5 (+121 / -155), closed 4.5 (-118 / -108)
    const item = (a: string, open: number, cur: number, price: number, openPrice: number) => ({
      a,
      t: "Total Points",
      op: [open, null, null],
      cur: [cur, null, null],
      px: [price, openPrice],
    });
    const g = {
      id: "9",
      date: "2026-09-15T23:05:00Z",
      name: "ATH @ TB",
      away: { abbr: "ATH", name: "Athletics" },
      home: { abbr: "TB", name: "Rays" },
      books: {
        "100": {
          name: "DraftKings",
          rows: [item("7", 5.5, 4.5, -118, 121), item("7", 5.5, 4.5, -108, -155)],
        },
      },
      box: { "7": { n: "Shane McClanahan", tm: "TB", s: {} } },
    };
    expect(closingBoard(g).props).toEqual([
      ["Shane McClanahan", "TB", "Points", 4.5, -118, -108, 5.5],
    ]);
  });
});
