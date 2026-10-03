import { describe, expect, it } from "vitest";
import { divisions, teams } from "@/data/teams";

describe("NFL team reference data", () => {
  it("covers all 32 franchises", () => {
    expect(teams).toHaveLength(32);
  });

  it("has a unique slug and abbreviation per team", () => {
    expect(new Set(teams.map((t) => t.id)).size).toBe(32);
    expect(new Set(teams.map((t) => t.abbr)).size).toBe(32);
  });

  it("puts exactly 4 teams in each of the 8 divisions", () => {
    expect(divisions).toHaveLength(8);
    for (const { conference, division } of divisions) {
      const group = teams.filter(
        (t) => t.conference === conference && t.division === division,
      );
      expect(group).toHaveLength(4);
    }
  });
});
