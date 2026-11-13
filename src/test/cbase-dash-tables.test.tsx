import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
}));

import { CbaseRecentGames } from "@/components/cbase/CbaseDashTables";
import { rowFromLined } from "@/components/cbase/CbaseBits";
import type { CbaseLinedGame, CbaseTeam } from "@/lib/cbase/cbase";

const team = (name: string, rank?: number): CbaseTeam => ({
  name,
  conf: "",
  espn: null,
  w: 0,
  l: 0,
  rs: 0,
  ra: 0,
  rank,
});
const teams = { unc: team("North Carolina", 4), ou: team("Oklahoma", 14) };
const game: CbaseLinedGame = {
  id: "1",
  espn: "9",
  date: "2026-06-22",
  start: "2026-06-22T23:00:00Z",
  home: "unc",
  away: "ou",
  hr: 2,
  ar: 13,
  book: "58",
  open: { mlH: -154, mlA: 130, rl: -1.5, rlH: 120, rlA: -145, tot: 10, ov: -110, un: -110 },
  close: { mlH: -154, mlA: 130, rl: -1.5, rlH: 120, rlA: -145, tot: 9.5, ov: -110, un: -110 },
  m: { h: 6.5, a: 5.6, p: 0.66, t: 12.1 },
  picks: [{ k: "ml", side: "home", edge: 0.08, price: -154, res: "L" }],
};

describe("college baseball dashboard tables", () => {
  it("colors the favorite's moneyline, run line and the total by result", () => {
    render(
      <CbaseRecentGames
        title="Recent games"
        rows={[rowFromLined(game, teams)]}
        teams={teams}
        empty="none"
      />,
    );
    const cells = screen.getAllByRole("cell");
    expect(cells[3].textContent).toMatch(/-154$/);
    expect(cells[3].className).toMatch(/text-loss/); // UNC lost
    expect(cells[4].textContent).toMatch(/-1\.5\+120/);
    expect(cells[4].className).toMatch(/text-loss/);
    expect(cells[5].textContent).toBe("9.5");
    expect(cells[5].className).toMatch(/text-win/); // 15 runs, over
    expect(cells[6].textContent).toMatch(/North Carolina ML -154/);
  });
});
