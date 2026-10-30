import { describe, expect, it } from "vitest";
import {
  latestGoal,
  liveBadge,
  nhlTimeoutsLeft,
  penaltyMinutes,
  powerPlay,
  shotsOnGoal,
} from "@/lib/nhl/nhl-live";
import type { NhlGame, NhlPlay } from "@/lib/nhl/nhl";

const team = (id: string, abbr: string) => ({
  id,
  abbr,
  name: abbr,
  nickname: abbr,
  color: "#000000",
  logo: "",
});
function game(
  period: number,
  clock: string,
  statusDetail = "",
  part: NhlGame["part"] = "reg",
): NhlGame {
  return {
    id: "1",
    date: "2026-10-28T23:00Z",
    status: "live",
    statusDetail,
    period,
    clock,
    part,
    away: { team: team("4", "CHI"), score: 1, record: "0-1-0" },
    home: { team: team("53", "UTA"), score: 3, record: "1-0-0" },
  };
}
let n = 0;
const play = (
  period: number,
  clock: string,
  type: string,
  text: string,
  teamId?: string,
  extra: Partial<NhlPlay> = {},
): NhlPlay => ({
  id: String(++n),
  period,
  clock,
  type,
  text,
  teamId,
  awayScore: null,
  homeScore: null,
  scoring: type === "Goal",
  ...extra,
});

describe("NHL live helpers", () => {
  it("reads penalty lengths", () => {
    expect(penaltyMinutes("Ian Cole Holding (2 min)")).toBe(2);
    expect(penaltyMinutes("Sean Durzi Fighting (5 min)")).toBe(5);
    expect(penaltyMinutes("High-sticking - double minor (4 min)")).toBe(4);
    expect(penaltyMinutes("Connor Murphy Misconduct (10 min)")).toBe(0);
  });

  it("finds a power play and its time left", () => {
    const plays = [play(2, "5:24", "Penalty", "Clayton Keller Roughing (2 min)", "53")];
    expect(powerPlay(plays, game(2, "4:54"))).toEqual({
      teamId: "4",
      secondsLeft: 90,
      skaters: "5-on-4",
    });
    expect(liveBadge(plays, game(2, "4:54"))).toEqual({
      text: "POWER PLAY · CHI 1:30",
      tone: "pp",
    });
    // Expired after two minutes.
    expect(powerPlay(plays, game(2, "3:20"))).toBeUndefined();
  });

  it("cancels offsetting penalties and ends a minor on a power-play goal", () => {
    const fight = [
      play(2, "5:24", "Penalty", "Sean Durzi Fighting (5 min)", "53"),
      play(2, "5:24", "Penalty", "Connor Murphy Fighting (5 min)", "4"),
    ];
    expect(powerPlay(fight, game(2, "4:00"))).toBeUndefined();
    const ppGoal = [
      play(1, "10:00", "Penalty", "Ian Cole Holding (2 min)", "53"),
      play(1, "9:00", "Goal", "Connor Bedard Wrist Shot", "4"),
    ];
    expect(powerPlay(ppGoal, game(1, "8:50"))).toBeUndefined();
  });

  it("counts shots on goal per period, goals included, shootout left out", () => {
    const plays = [
      play(1, "18:00", "Shot", "Bedard shot saved", "4"),
      play(1, "15:00", "Goal", "Keller goal", "53"),
      play(1, "12:00", "Missed Shot", "Wide", "53"),
      play(2, "10:00", "Shot", "Cooley shot saved", "53"),
      play(5, "0:00", "Goal", "Shootout goal", "4"),
    ];
    expect(shotsOnGoal(plays, game(2, "9:00"))).toEqual({
      away: [1, 0, 0],
      home: [1, 1, 0],
      awayTotal: 1,
      homeTotal: 2,
    });
    expect(latestGoal(plays, game(5, "0:00"))?.text).toBe("Keller goal");
  });

  it("tracks the one timeout per team and badges intermissions", () => {
    const plays = [play(3, "1:30", "Timeout", "Chicago Blackhawks Timeout", "4")];
    expect(nhlTimeoutsLeft(plays, game(3, "1:30"))).toEqual({ away: 0, home: 1 });
    expect(liveBadge(plays, game(3, "1:30"))).toEqual({ text: "TIMEOUT · CHI", tone: "plain" });
    expect(liveBadge([], game(1, "0:00", "End of 1st Period"))).toEqual({
      text: "END OF 1ST",
      tone: "plain",
    });
  });
});
