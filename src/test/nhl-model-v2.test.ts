import { describe, expect, it } from "vitest";
import type { NhlGame, NhlPlayerIndex, NhlTeamRef } from "@/lib/nhl/nhl";
import { projectGame } from "@/lib/nhl/nhl-model";
import {
  calibrateHomeCover,
  calibrateMoneyline,
  calibrateOver,
  compareNhlModels,
  goalieKey,
  inputsFromPlayerIndex,
  marketRowsV2,
  meansFromFeatures,
  projectGameV2,
  restDays,
  type NhlV2Features,
} from "@/lib/nhl/nhl-model-v2";
import { projectFromMeans, probHomeCovers, probOver } from "@/lib/nhl/nhl-model";

/** Cases computed by the Python fit (nhl_fit.py) from real 2009-2026 games. */
const CASES = [
 {
  "lamHome": 3.0920851961,
  "lamAway": 2.6312336912,
  "pHomeRaw": 0.5781051251,
  "pHome": 0.5815671239,
  "pOver": 0.472560515,
  "pHomeCover": 0.3614774793,
  "features": {
   "mu": 3.0347063310450038,
   "hGf": 0.9773892680067807,
   "hGa": 0.9763405796804354,
   "aGf": 0.8799002559549659,
   "aGa": 1.0952309256312083,
   "hSog": 1.0078713439531728,
   "hSoga": 1.0344084497738495,
   "aSog": 0.933502436522062,
   "aSoga": 0.926575802121411,
   "hSv": 1.004813467248235,
   "aSv": 0.9998256704099726,
   "hB2b": 0,
   "aB2b": 0,
   "hRest3": 0,
   "aRest3": 0,
   "totalLine": 6.5,
   "plHome": -1.5
  }
 },
 {
  "lamHome": 2.542347419,
  "lamAway": 2.4686646612,
  "pHomeRaw": 0.513461278,
  "pHome": 0.4976919378,
  "pOver": 0.53411781,
  "pHomeCover": 0.2822623694,
  "features": {
   "mu": 2.6500829187396353,
   "hGf": 1.0514267638339279,
   "hGa": 0.9534678928834914,
   "aGf": 1.1533325574651239,
   "aGa": 0.8294586602155133,
   "hSog": 1.0853128588732408,
   "hSoga": 0.9057729640084837,
   "aSog": 1.001994766082441,
   "aSoga": 0.9346208264511661,
   "hSv": 1.0052406476753637,
   "aSv": 1.0069373517462439,
   "hB2b": 0,
   "aB2b": 0,
   "hRest3": 0,
   "aRest3": 0,
   "totalLine": 5.0,
   "plHome": -1.5
  }
 },
 {
  "lamHome": 2.3613733063,
  "lamAway": 2.5028943968,
  "pHomeRaw": 0.4737502193,
  "pHome": 0.4463972003,
  "pOver": 0.5169391463,
  "features": {
   "mu": 2.6407185628742513,
   "hGf": 0.8770343334544016,
   "hGa": 0.8153546110603933,
   "aGf": 1.2356373706288672,
   "aGa": 0.9366648956359842,
   "hSog": 1.0258094238910156,
   "hSoga": 0.8957501898466073,
   "aSog": 1.0896563559444694,
   "aSoga": 0.9178149384239037,
   "hSv": 1.0023752773229175,
   "aSv": 1.0014162542441174,
   "hB2b": 0,
   "aB2b": 0,
   "hRest3": 0,
   "aRest3": 0,
   "totalLine": 5.0,
   "plHome": null
  }
 },
 {
  "lamHome": 2.9239336259,
  "lamAway": 2.7487843473,
  "pHomeRaw": 0.5299667726,
  "pHome": 0.5191162904,
  "pOver": 0.496258411,
  "features": {
   "mu": 2.7076822916666665,
   "hGf": 0.9239733653476405,
   "hGa": 1.102585049173406,
   "aGf": 1.051151377208058,
   "aGa": 1.0878169042993764,
   "hSog": 0.9762308332336596,
   "hSoga": 0.9710504871684078,
   "aSog": 1.0023684119480458,
   "aSoga": 1.0795554391829147,
   "hSv": 0.9991555743922204,
   "aSv": 1.0023496156315532,
   "hB2b": 0,
   "aB2b": 0,
   "hRest3": 0,
   "aRest3": 0,
   "totalLine": 5.5,
   "plHome": null
  }
 },
 {
  "lamHome": 3.3914667812,
  "lamAway": 2.3116366962,
  "pHomeRaw": 0.6787658741,
  "pHome": 0.7089976297,
  "pOver": 0.4989206349,
  "features": {
   "mu": 2.6908995815899583,
   "hGf": 1.1470128710389,
   "hGa": 0.9369939607808224,
   "aGf": 0.9425239295430577,
   "aGa": 1.0790230621312182,
   "hSog": 1.052950460935033,
   "hSoga": 0.9825051537625541,
   "aSog": 0.9782420525459407,
   "aSoga": 0.9962809826243505,
   "hSv": 1.00316444264129,
   "aSv": 0.9989990991082129,
   "hB2b": 0,
   "aB2b": 1,
   "hRest3": 1,
   "aRest3": 0,
   "totalLine": 5.5,
   "plHome": null
  }
 },
 {
  "lamHome": 2.994919693,
  "lamAway": 3.1644394985,
  "pHomeRaw": 0.4722113993,
  "pHome": 0.444420876,
  "pOver": 0.5380111697,
  "pHomeCover": 0.2713468023,
  "features": {
   "mu": 2.938992042440318,
   "hGf": 0.9946231362088812,
   "hGa": 1.0473027706806302,
   "aGf": 1.0022935609766124,
   "aGa": 1.0076634028466174,
   "hSog": 0.9925808572561706,
   "hSoga": 1.102683600832561,
   "aSog": 0.9830119383765502,
   "aSoga": 1.0485701345961416,
   "hSv": 1.0067301672125288,
   "aSv": 1.003988558059011,
   "hB2b": 1,
   "aB2b": 0,
   "hRest3": 0,
   "aRest3": 0,
   "totalLine": 6.0,
   "plHome": -1.5
  }
 }
];

const team = (abbr: string): NhlTeamRef => ({ id: abbr, abbr, name: abbr, nickname: abbr, color: "#000000", logo: "" });
function game(id: string, date: string, home: string, away: string, hs?: number, as?: number, extra: Partial<NhlGame> = {}): NhlGame {
  const final = hs !== undefined;
  return {
    id,
    date,
    status: final ? "final" : "scheduled",
    statusDetail: final ? "Final" : "Scheduled",
    period: final ? 3 : 0,
    clock: "",
    part: "reg",
    home: { team: team(home), score: hs ?? null },
    away: { team: team(away), score: as ?? null },
    ...extra,
  };
}

describe("v2 matches the Python fit", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const f = c.features;
    const features: NhlV2Features = {
      mu: f.mu,
      home: { gf: f.hGf, ga: f.hGa, sog: f.hSog, soga: f.hSoga, sv: f.hSv, b2b: f.hB2b === 1, rest3: f.hRest3 === 1, goalie: null },
      away: { gf: f.aGf, ga: f.aGa, sog: f.aSog, soga: f.aSoga, sv: f.aSv, b2b: f.aB2b === 1, rest3: f.aRest3 === 1, goalie: null },
      current: true,
    };
    const m = meansFromFeatures(features);
    expect(m.home).toBeCloseTo(c.lamHome, 9);
    expect(m.away).toBeCloseTo(c.lamAway, 9);
    const d = projectFromMeans(m.home, m.away);
    expect(d.pHome).toBeCloseTo(c.pHomeRaw, 9);
    expect(calibrateMoneyline(d.pHome)).toBeCloseTo(c.pHome, 9);
    if (f.totalLine !== null && "pOver" in c) {
      const o = probOver(d, f.totalLine);
      expect(calibrateOver(o.over / (o.over + o.under), f.totalLine)).toBeCloseTo(c.pOver as number, 9);
    }
    if (f.plHome !== null && "pHomeCover" in c) {
      const h = probHomeCovers(d, f.plHome);
      expect(calibrateHomeCover(h.win / (1 - h.push), f.plHome)).toBeCloseTo(c.pHomeCover as number, 9);
    }
  });
});

describe("v2 inputs and features", () => {
  const season = [
    game("1", "2026-10-10T23:00Z", "TOR", "BOS", 4, 2),
    game("2", "2026-10-11T23:00Z", "BOS", "MTL", 3, 1),
    game("3", "2026-10-12T23:00Z", "TOR", "MTL", 2, 3),
  ];
  it("counts days off, with 4 for a team's first game", () => {
    const next = game("4", "2026-10-12T23:30Z", "BOS", "OTT");
    expect(restDays([...season, next], next, "BOS")).toBe(0);
    expect(restDays([...season, next], next, "OTT")).toBe(4);
  });
  it("projects from opening night (last season carries in)", () => {
    const opener = game("0", "2026-10-07T23:00Z", "TOR", "BOS");
    const p = projectGameV2(opener, [opener], null);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.pHome + p.pAway).toBeCloseTo(1, 9);
      expect(p.pOvertime).toBeGreaterThan(0.18);
      const rows = marketRowsV2(opener, p);
      expect(rows.filter((r) => r.market === "Moneyline")).toHaveLength(2);
    }
  });
  it("reads shots and goalies only from this season's player stats", () => {
    const stats = (o: Record<string, number>) => ({
      gp: 3, toi: null, goals: null, assists: null, points: null, plusMinus: null, shots: null, shootingPct: null, pim: null, ppg: null,
      gs: null, wins: null, losses: null, otLosses: null, savePct: null, gaa: null, saves: null, shotsAgainst: null, shutouts: null, ...o,
    });
    const index: NhlPlayerIndex = {
      statsSeason: 2027,
      players: [
        { id: "1", name: "Skater One", teamId: "t", teamAbbr: "TOR", position: "C", headshot: "", stats: stats({ shots: 30 }) },
        { id: "2", name: "Jos\u00e9 Th\u00e9odore", teamId: "t", teamAbbr: "TOR", position: "G", headshot: "", stats: stats({ gs: 3, saves: 80, shotsAgainst: 88 }) },
      ],
    };
    const now = new Date("2026-10-20T12:00:00Z");
    const inputs = inputsFromPlayerIndex(index, now);
    expect(inputs.shots.TOR).toEqual({ sogFor: 30, sogAgainst: 88 });
    expect(inputs.goalies[0].key).toBe("josetheodore");
    expect(goalieKey("Calvin Petersen")).toBe("calpetersen");
    expect(inputsFromPlayerIndex({ ...index, statsSeason: 2026 }, now).goalies).toHaveLength(0);
  });
  it("keeps this season's shots and saves out of finished games", () => {
    const done = game("9", "2026-10-13T23:00Z", "TOR", "BOS", 3, 2);
    const inputs = { shots: { TOR: { sogFor: 999, sogAgainst: 1 }, BOS: { sogFor: 1, sogAgainst: 999 } }, goalies: [] };
    const a = projectGameV2(done, [...season, done], inputs);
    const b = projectGameV2(done, [...season, done], null);
    expect(a.ok && b.ok && a.pHome).toBeCloseTo(b.ok ? b.pHome : 0, 12);
  });
  it("grades v2 against v1, the close, and tracks 6+ point edges at the opening price", () => {
    const g = game("9", "2026-10-13T23:00Z", "TOR", "BOS", 3, 2, {
      odds: { spread: -1.5, total: 6, mlHome: -150, mlAway: 130, open: { mlHome: 200, mlAway: -240 } },
    });
    const all = [...season, g];
    const cmp = compareNhlModels(all, (x) => {
      const p = projectGame(x, all);
      return p.ok ? { ok: true, pHome: p.pHome } : { ok: true, pHome: 0.5 };
    }, null);
    expect(cmp.games).toBe(4);
    expect(cmp.book.games).toBe(1);
    expect(cmp.tracked.bets).toBe(1);
    expect(cmp.tracked.wins).toBe(1);
    expect(cmp.tracked.units).toBeCloseTo(2, 9);
    expect(cmp.tracked.movedToward).toBe(1);
  });
});
