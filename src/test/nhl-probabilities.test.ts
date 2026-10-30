import { describe, expect, it } from "vitest";
import { buildNhlProbabilities, nhlChances, pregameRates } from "@/lib/nhl/nhl-probabilities";
import { noVigProb } from "@/lib/nhl/nhl-model";
import type { NhlGame, NhlPlay } from "@/lib/nhl/nhl";

const team = (id: string, abbr: string) => ({
  id,
  abbr,
  name: abbr,
  nickname: abbr,
  color: "#000000",
  logo: "",
});
const game = (status: NhlGame["status"], away: number | null, home: number | null): NhlGame => ({
  id: "1",
  date: "2026-10-28T23:00Z",
  status,
  statusDetail: "",
  period: 3,
  clock: "0:00",
  part: "reg",
  away: { team: team("2", "BUF"), score: away },
  home: { team: team("25", "ANA"), score: home },
  odds: { spread: 1.5, total: 6.5, mlHome: 136, mlAway: -162 },
});
const goal = (period: number, clock: string, a: number, h: number, teamId: string): NhlPlay => ({
  id: `${period}-${clock}`,
  period,
  clock,
  text: "goal",
  type: "Goal",
  teamId,
  awayScore: a,
  homeScore: h,
  scoring: true,
});

describe("NHL market probabilities", () => {
  it("matches the sportsbook's no-vig moneyline before puck drop", () => {
    const g = game("live", 0, 0);
    const rates = pregameRates(g)!;
    expect(rates.away + rates.home).toBeCloseTo(6.5 - 0.23, 5);
    expect(nhlChances(rates, 0, 0, 0, {}).homeWin).toBeCloseTo(noVigProb(136, -162), 3);
  });

  it("moves with the score and the clock", () => {
    const rates = { away: 3.1, home: 3.1 };
    // Tied with no time left: the overtime/shootout coin flip.
    expect(nhlChances(rates, 3600, 2, 2, {}).homeWin).toBeCloseTo(0.5, 5);
    // Up three with five minutes left is nearly certain; up one early is not.
    expect(nhlChances(rates, 3300, 1, 4, {}).homeWin).toBeGreaterThan(0.97);
    expect(nhlChances(rates, 600, 0, 1, {}).homeWin).toBeLessThan(0.75);
    // A tie gives the overtime winner one more goal: 3-3 into OT clears a 6.5 total.
    expect(nhlChances(rates, 3600, 3, 3, { total: 6.5 }).over).toBeCloseTo(1, 5);
  });

  it("builds a point per play and ends on the result", () => {
    const plays = [
      goal(1, "15:00", 1, 0, "2"),
      goal(2, "5:00", 1, 1, "25"),
      goal(3, "1:00", 1, 2, "25"),
    ];
    const g = game("final", 1, 2);
    const pts = buildNhlProbabilities(plays, g, pregameRates(g)!);
    expect(pts).toHaveLength(4);
    expect(pts[1].homeWinProbability).toBeLessThan(pts[0].homeWinProbability);
    const last = pts[pts.length - 1];
    expect(last.homeWinProbability).toBe(1);
    expect(last.homeCoverProbability).toBe(1); // ANA +1.5 won
    expect(last.overProbability).toBe(0); // 3 goals < 6.5
  });
});
