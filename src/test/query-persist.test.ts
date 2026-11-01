import { describe, expect, it } from "vitest";
import { withoutStaleLive } from "@/lib/shared/query-persist";

describe("saved schedule copies", () => {
  const games = [
    { id: "1", status: "final" },
    { id: "2", status: "live" },
    { id: "3", status: "scheduled" },
  ];
  it("keeps live games in a fresh copy", () => {
    expect(withoutStaleLive({ data: games, updatedAt: 1_000_000 }, 1_000_000 + 60_000)).toHaveLength(3);
  });
  it("drops live games from an old copy", () => {
    const out = withoutStaleLive({ data: games, updatedAt: 0 }, 24 * 3_600_000) as typeof games;
    expect(out.map((g) => g.id)).toEqual(["1", "3"]);
  });
});
