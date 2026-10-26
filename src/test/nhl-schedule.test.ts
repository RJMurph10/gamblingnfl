import { describe, expect, it } from "vitest";
import { parseEvent, parseOdds } from "@/lib/nhl.server";

// ESPN-shaped fixtures (written from the feed's known structure; not a live capture).
const event = (over: Record<string, unknown> = {}, status: Record<string, unknown> = {}, odds?: unknown) => ({
  id: "401800001",
  date: "2026-10-26T23:00Z",
  season: { type: 2 },
  competitions: [
    {
      status: { period: 0, displayClock: "0:00", type: { name: "STATUS_SCHEDULED", state: "pre", detail: "Mon, October 26th at 7:00 PM EDT", ...status } },
      venue: { fullName: "TD Garden" },
      broadcasts: [{ names: ["ESPN"] }],
      competitors: [
        { homeAway: "home", score: "0", team: { id: "1", abbreviation: "BOS", displayName: "Boston Bruins", name: "Bruins", color: "ffb81c" }, records: [{ type: "total", summary: "3-1-1" }] },
        { homeAway: "away", score: "0", team: { id: "10", abbreviation: "NYR", displayName: "New York Rangers", name: "Rangers" } },
      ],
      ...(odds ? { odds: [odds] } : {}),
    },
  ],
  ...over,
});

describe("parseEvent", () => {
  it("reads a scheduled game without inventing scores or odds", () => {
    const g = parseEvent(event())!;
    expect(g.status).toBe("scheduled");
    expect(g.home.team.abbr).toBe("BOS");
    expect(g.away.team.nickname).toBe("Rangers");
    expect(g.home.score).toBeNull();
    expect(g.away.score).toBeNull();
    expect(g.odds).toBeUndefined();
    expect(g.venue).toBe("TD Garden");
    expect(g.home.record).toBe("3-1-1");
    expect(g.home.team.logo).toContain("bos.png");
  });
  it("reads live, final, overtime and postponed states", () => {
    const live = parseEvent(event({}, { name: "STATUS_IN_PROGRESS", state: "in", detail: "12:30 - 2nd Period" }))!;
    expect(live.status).toBe("live");
    const final = parseEvent(event({}, { name: "STATUS_FINAL", state: "post", completed: true, detail: "Final/OT" }))!;
    expect(final.status).toBe("final");
    expect(final.statusDetail).toBe("Final/OT");
    const ppd = parseEvent(event({}, { name: "STATUS_POSTPONED", state: "pre", detail: "Postponed" }))!;
    expect(ppd.status).toBe("postponed");
  });
  it("skips events that are missing a team", () => {
    const e: any = event();
    e.competitions[0].competitors.pop();
    expect(parseEvent(e)).toBeNull();
  });
  it("marks preseason and playoff games", () => {
    expect(parseEvent(event({ season: { type: 1 } }))!.part).toBe("pre");
    expect(parseEvent(event({ season: { type: 3 } }))!.part).toBe("post");
  });
});

describe("parseOdds", () => {
  it("does not mistake a moneyline in `details` for a puck line", () => {
    const o = parseOdds(
      { details: "BOS -150", overUnder: 6.5, spread: 1.5, homeTeamOdds: { favorite: true, moneyLine: -150, spreadOdds: 165 }, awayTeamOdds: { moneyLine: 130, spreadOdds: -195 } },
      "NYR",
      "BOS",
    )!;
    expect(o.spread).toBe(-1.5);
    expect(o.mlHome).toBe(-150);
    expect(o.mlAway).toBe(130);
    expect(o.total).toBe(6.5);
    expect(o.spreadOddsHome).toBe(165);
    expect(o.spreadOddsAway).toBe(-195);
  });
  it("puts the puck line on the away side when the away team is the favorite", () => {
    const o = parseOdds({ spread: 1.5, overUnder: 6, homeTeamOdds: { favorite: false }, awayTeamOdds: { favorite: true } }, "NYR", "BOS")!;
    expect(o.spread).toBe(1.5);
  });
  it("reads a small line from details and ignores a big one", () => {
    expect(parseOdds({ details: "BOS -1.5", overUnder: 6.5 }, "NYR", "BOS")!.spread).toBe(-1.5);
    expect(parseOdds({ details: "NYR -1.5", overUnder: 6.5 }, "NYR", "BOS")!.spread).toBe(1.5);
    expect(parseOdds({ details: "BOS -150", overUnder: 6.5 }, "NYR", "BOS")!.spread).toBeNull();
  });
  it("reads open and current numbers from the nested structure", () => {
    const o = parseOdds(
      {
        moneyline: { home: { open: { odds: "-130" }, close: { odds: "-150" } }, away: { open: { odds: "+110" }, close: { odds: "+130" } } },
        total: { over: { open: { line: "o6" }, close: { line: "o6.5", odds: "-105" } }, under: { close: { odds: "-115" } } },
        pointSpread: { home: { open: { line: "-1.5" }, close: { line: "-1.5", odds: "+165" } }, away: { close: { odds: "-195" } } },
      },
      "NYR",
      "BOS",
    )!;
    expect(o.mlHome).toBe(-150);
    expect(o.open?.mlHome).toBe(-130);
    expect(o.total).toBe(6.5);
    expect(o.open?.total).toBe(6);
    expect(o.overOdds).toBe(-105);
    expect(o.underOdds).toBe(-115);
    expect(o.spread).toBe(-1.5);
  });
  it("returns nothing when the book has no usable numbers", () => {
    expect(parseOdds({ provider: { name: "X" } }, "NYR", "BOS")).toBeUndefined();
    expect(parseOdds(undefined, "NYR", "BOS")).toBeUndefined();
  });
});
