import { describe, expect, it } from "vitest";
import { currentRun, latestMadeShot, liveBadge, nbaTimeoutsLeft } from "@/lib/nba/nba-live";
import type { NbaGame, NbaPlay } from "@/lib/nba/nba";

const team = (id: string, abbr: string) => ({
  id,
  abbr,
  name: abbr,
  nickname: abbr,
  location: "",
  color: "#000000",
  logo: "",
});
function game(period: number, clock: string, statusDetail = ""): NbaGame {
  return {
    id: "1",
    date: "2026-10-28T02:30Z",
    status: "live",
    statusDetail,
    period,
    clock,
    part: "reg",
    away: { team: team("26", "UTA"), score: 60, periods: [] },
    home: { team: team("29", "MEM"), score: 75, periods: [] },
  } as NbaGame;
}
let n = 0;
const play = (
  period: number,
  clock: string,
  text: string,
  teamId?: string,
  extra: Partial<NbaPlay> = {},
): NbaPlay => ({
  id: String(++n),
  period,
  clock,
  text,
  teamId,
  awayScore: null,
  homeScore: null,
  scoring: false,
  scoreValue: 0,
  ...extra,
});
const made = (teamId: string, value: number, shot?: { x: number; y: number }) =>
  play(3, "9:00", "makes shot", teamId, { scoring: true, scoreValue: value, shot });

describe("NBA live court helpers", () => {
  it("counts timeouts left, giving back a won challenge's timeout", () => {
    const plays = [
      play(1, "7:40", "Jazz Full timeout", "26"),
      play(
        1,
        "3:52",
        "(03:52) [Jazz] COACH'S CHALLENGE (CALL OVERTURNED) [Jazz] retain their timeout",
        "26",
      ),
      play(1, "4:26", "Grizzlies Full timeout", "29"),
      play(2, "6:36", "Grizzlies Full timeout", "29"),
      play(2, "2:27", "Jazz Full timeout", "26"),
      play(3, "9:24", "Jazz Full timeout", "26"),
      play(3, "5:00", "Grizzlies Full timeout", "29"),
      play(
        3,
        "5:00",
        "(05:00) [Grizzlies] COACH'S CHALLENGE (CALL OVERTURNED) [Grizzlies] retain their timeout",
        "29",
      ),
    ];
    expect(nbaTimeoutsLeft(plays, game(3, "4:00"))).toEqual({ away: 4, home: 5 });
  });

  it("caps timeouts at 4 in the 4th quarter, 2 in its last 3 minutes and 2 per overtime", () => {
    const plays = [play(4, "9:00", "Jazz Full timeout", "26")];
    expect(nbaTimeoutsLeft(plays, game(4, "8:00"))).toEqual({ away: 3, home: 4 });
    expect(nbaTimeoutsLeft(plays, game(4, "2:30"))).toEqual({ away: 2, home: 2 });
    expect(
      nbaTimeoutsLeft([...plays, play(5, "4:00", "Grizzlies Full timeout", "29")], game(5, "3:00")),
    ).toEqual({ away: 2, home: 1 });
  });

  it("shows only the newest made basket, skipping free throws", () => {
    const plays = [
      made("26", 3, { x: 47, y: 7 }),
      made("29", 3, { x: 13, y: 21 }),
      play(3, "9:20", "Ja Morant makes free throw 1 of 1", "29", {
        scoring: true,
        scoreValue: 1,
        shot: { x: 25, y: 13.75 },
      }),
      play(3, "9:10", "Collin Sexton misses 25-foot three", "26", { shot: { x: 30, y: 24 } }),
    ];
    expect(latestMadeShot(plays)).toMatchObject({ teamId: "29", x: 13, y: 21, value: 3 });
    // The newest basket has no court spot: show nothing rather than an older one.
    expect(latestMadeShot([...plays, made("26", 2)])).toBeUndefined();
  });

  it("reports unanswered runs of 6 or more", () => {
    expect(currentRun([made("26", 3), made("29", 2), made("29", 3), made("29", 3)])).toEqual({
      teamId: "29",
      points: 8,
    });
    expect(currentRun([made("29", 3), made("26", 2)])).toBeUndefined();
  });

  it("badges timeouts, quarter ends and halftime", () => {
    expect(liveBadge([play(3, "9:24", "Jazz Full timeout", "26")], game(3, "9:24"))).toBe(
      "TIMEOUT · UTA",
    );
    expect(
      liveBadge([play(1, "0.0", "End of the 1st Quarter")], game(1, "0.0", "End of 1st Quarter")),
    ).toBe("END OF 1ST");
    expect(liveBadge([play(2, "0.0", "End of the 2nd Quarter")], game(2, "0.0", "Halftime"))).toBe(
      "END OF 2ND",
    );
    expect(liveBadge([made("26", 2)], game(3, "9:00"))).toBeUndefined();
  });
});
