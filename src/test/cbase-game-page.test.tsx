import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: unknown }) => ({
    ...opts,
    useParams: () => ({ gameId: "e1" }),
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const team = (name: string, rank?: number) => ({
  name,
  conf: "SEC",
  espn: null,
  logo: null,
  town: name === "Georgia" ? "Athens, GA" : "Norman, OK",
  w: 40,
  l: 15,
  rs: 400,
  ra: 250,
  off: 2.1,
  dfn: 1.5,
  park: 0.4,
  rank,
});

vi.mock("@/lib/cbase/use-cbase", () => ({
  useCbaseGame: () => ({
    isLoading: false,
    data: {
      season: 2026,
      model: { mlEdge: 0.08, rlEdge: 0.08, totEdge: 0.08 },
      teams: { uga: team("Georgia", 2), ou: team("Oklahoma", 14) },
      upcoming: {
        espn: "1",
        start: "2026-06-13T22:00:00Z",
        home: "uga",
        away: "ou",
        homeName: "Georgia",
        awayName: "Oklahoma",
        book: "DraftKings",
        open: { mlH: -150, mlA: 125, rl: -1.5, rlH: 130, rlA: -160, tot: 12.5, ov: -115, un: -105 },
        m: { h: 7.1, a: 5.2, p: 0.66, t: 12.3, po: 0.41 },
        ctx: {
          sph: "K. Smith",
          spa: "J. Jones",
          temp: 84,
          wind: 12,
          windFrom: "SW",
          windRuns: 1.2,
        },
        picks: [{ k: "tot", side: "under", edge: 0.09, price: -105, line: 12.5 }],
      },
    },
  }),
}));

import { Route } from "@/routes/cbase.games.$gameId";

describe("college baseball game page", () => {
  it("shows the MLB-style header, model vs sportsbook and the information tab", () => {
    const Page = (Route as unknown as { component: () => JSX.Element }).component;
    render(<Page />);
    expect(screen.getAllByText(/Georgia/).length).toBeGreaterThan(0);
    expect(screen.getByText(/SP J\. Jones \(proj\.\)/)).toBeTruthy();
    expect(screen.getByText("Model vs sportsbook")).toBeTruthy();
    // the under is the watch pick, model 59% vs book's no-vig
    const under = screen
      .getAllByText(/Under 12\.5/)
      .map((e) => e.closest("tr"))
      .find(Boolean)!;
    expect(under.textContent).toMatch(/Watch/);
    expect(under.textContent).toMatch(/59\.0%/);
    fireEvent.click(screen.getByRole("button", { name: "Information" }));
    expect(screen.getByText(/Athens, GA/)).toBeTruthy();
    expect(screen.getByText(/84° · wind 12 mph from SW/)).toBeTruthy();
    expect(screen.getByText(/\+1\.2 runs to the total/)).toBeTruthy();
  });
});
