import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { playerPropsOf } from "../../scripts/line-history/sgo-games.mjs";

const event = {
  eventID: "e1",
  teams: { home: { teamID: "DUKE_NCAAB" }, away: { teamID: "UNC_NCAAB" } },
  players: {
    COOPER_FLAGG_1_NCAAB: { name: "Cooper Flagg", teamID: "DUKE_NCAAB" },
    RJ_DAVIS_1_NCAAB: { name: "RJ Davis", teamID: "UNC_NCAAB" },
  },
  odds: {
    "points-COOPER_FLAGG_1_NCAAB-game-ou-over": {
      statID: "points", playerID: "COOPER_FLAGG_1_NCAAB", periodID: "game", betTypeID: "ou", sideID: "over",
      byBookmaker: { draftkings: { overUnder: "19.5", odds: "-115" }, fanduel: { overUnder: "20.5", odds: "+100" } },
    },
    "points-COOPER_FLAGG_1_NCAAB-game-ou-under": {
      statID: "points", playerID: "COOPER_FLAGG_1_NCAAB", periodID: "game", betTypeID: "ou", sideID: "under",
      byBookmaker: { draftkings: { overUnder: "19.5", odds: "-105" }, fanduel: { overUnder: "20.5", odds: "-120" } },
    },
    "rebounds-RJ_DAVIS_1_NCAAB-1h-ou-over": {
      statID: "rebounds", playerID: "RJ_DAVIS_1_NCAAB", periodID: "1h", betTypeID: "ou", sideID: "over",
      byBookmaker: { draftkings: { overUnder: "2.5", odds: "-110" } },
    },
    "threePointersMade-RJ_DAVIS_1_NCAAB-game-ou-over": {
      statID: "threePointersMade", playerID: "RJ_DAVIS_1_NCAAB", periodID: "game", betTypeID: "ou", sideID: "over",
      byBookmaker: { draftkings: { overUnder: "2.5", odds: "+120", available: false }, betmgm: { overUnder: "2.5", odds: "+115" } },
    },
    "points-home-game-sp-home": {
      statID: "points", periodID: "game", betTypeID: "sp", sideID: "home",
      byBookmaker: { draftkings: { spread: "-4.5", odds: "-110" } },
    },
  },
};

describe("college player props from the SportsGameOdds pull", () => {
  it("keeps full-game player over/unders per book with both prices", () => {
    expect(playerPropsOf(event).sort()).toEqual(
      [
        ["Cooper Flagg", "home", "points", 19.5, -115, -105, "draftkings"],
        ["Cooper Flagg", "home", "points", 20.5, 100, -120, "fanduel"],
        ["RJ Davis", "away", "threePointersMade", 2.5, 115, null, "betmgm"],
      ].sort(),
    );
  });
});
