import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
// @ts-expect-error plain .mjs script without types
import { tdOf } from "../../scripts/line-history/sgo-nfl-props.mjs";
import { touchdownsByPlayer } from "@/components/shared/GamePropsTab";
import { TdScorers } from "@/components/shared/TdScorers";
import type { UpcomingPropGame } from "@/lib/shared/prop-history.server";

const odd = (
  statID: string,
  betTypeID: string,
  sideID: string,
  odds: string,
  overUnder?: string,
) => ({
  statID,
  betTypeID,
  sideID,
  periodID: "game",
  playerID: "AE",
  byBookmaker: { draftkings: { odds, ...(overUnder ? { overUnder } : {}) } },
});

describe("touchdown scorers", () => {
  it("reads DraftKings' anytime, first, 2+ and last TD prices from SportsGameOdds", () => {
    const e = {
      teams: { home: { teamID: "NYG" }, away: { teamID: "WAS" } },
      players: { AE: { name: "Austin Ekeler", teamID: "WAS" } },
      odds: {
        a: odd("touchdowns", "yn", "yes", "+320"),
        b: odd("firstTouchdown", "yn", "yes", "+1300"),
        c: odd("touchdowns", "ou", "over", "+3000", "1.5"),
        d: odd("lastTouchdown", "yn", "yes", "+1400"),
        e: { ...odd("touchdowns", "yn", "yes", "+650"), periodID: "1h" },
      },
    };
    expect(tdOf(e)).toEqual([["Austin Ekeler", "away", 320, 1300, 3000, 1400]]);
  });

  it("counts rushing, receiving and return TDs (not passing) across a player's box-score lines", () => {
    const m = touchdownsByPlayer([
      { name: "James Cook III", stats: { rushingTouchdowns: "1", receivingTouchdowns: "0" } },
      { name: "James Cook III", stats: { receivingTouchdowns: "1" } },
      { name: "Josh Allen", stats: { passingTouchdowns: "2", rushingTouchdowns: "0" } },
    ]);
    expect(m.get("james cook")).toBe(2);
    expect(m.get("josh allen")).toBe(0);
  });

  it("marks cashed anytime and 2+ bets on a finished game", () => {
    const game = {
      id: "1",
      date: "2026-11-10T01:15:00Z",
      name: "BUF @ MIN",
      away: { abbr: "BUF", name: "Bills" },
      home: { abbr: "MIN", name: "Vikings" },
      props: [],
      td: [
        ["James Cook III", "BUF", -150, 450, 400, 600],
        ["Justin Jefferson", "MIN", 120, 750, 900, 800],
      ],
    } as UpcomingPropGame;
    render(<TdScorers game={game} touchdowns={new Map([["james cook", 2]])} />);
    expect(screen.getByText("-150").className).toMatch(/text-win/);
    expect(screen.getByText("+400").className).toMatch(/text-win/); // 2+ cashed
    expect(screen.getByText("+120").className).toMatch(/line-through/); // Jefferson: no TD
  });
});
