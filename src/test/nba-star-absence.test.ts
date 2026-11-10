import { describe, expect, it } from "vitest";
import { outChance, starAdjust, STAR_COEF, type StarFile } from "@/lib/nba/star-absence";

const stars: StarFile = {
  builtAt: "",
  teams: {
    LAL: [
      { id: "1", name: "Luka Doncic", ppg: 30, missed: 0 },
      { id: "2", name: "Austin Reaves", ppg: 22, missed: 0.5 },
    ],
    DEN: [{ id: "3", name: "Nikola Jokic", ppg: 25, missed: 0 }],
  },
};

describe("star absences", () => {
  it("reads ESPN statuses", () => {
    expect(outChance("Out")).toBe(1);
    expect(outChance("Day-To-Day")).toBe(0);
    expect(outChance("Suspension")).toBe(1);
  });
  it("a star newly out lowers the total; one back from a long absence raises it", () => {
    // Doncic out (30 ppg, never missed), Reaves playing after missing half the recent games (+11 back)
    const a = starAdjust("LAL", "DEN", stars, [
      { athleteId: "1", name: "", team: "LAL", status: "Out" },
    ]);
    expect(a.points).toBeCloseTo(Math.round(STAR_COEF * (30 - 11) * 10) / 10, 6);
    expect(a.why).toContain("Luka Doncic out (30 ppg)");
    expect(a.why).toContain("Austin Reaves back (22 ppg)");
  });
  it("no injuries and no recent absences: no change", () => {
    expect(starAdjust("DEN", "DEN", stars, []).points).toBe(0);
    expect(starAdjust("LAL", "DEN", null, []).points).toBe(0);
  });
});
