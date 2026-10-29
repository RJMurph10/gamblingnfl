import { describe, expect, it } from "vitest";
import { buildNbaProbabilities } from "@/lib/nba/nba-probabilities";
import type { NbaGame, NbaPlay } from "@/lib/nba/nba";

const team = (id: string, abbr: string) => ({ id, abbr, name: abbr, nickname: abbr, location: "", color: "#000000", logo: "" });
function game(away: number, home: number, spread: number, total: number): NbaGame {
  return {
    id: "1", date: "2026-10-28T02:30Z", status: "final", statusDetail: "Final", period: 4, clock: "0.0", part: "reg",
    away: { team: team("13", "LAL"), score: away, periods: [] }, home: { team: team("12", "LAC"), score: home, periods: [] },
    odds: { spread, total, mlHome: -112, mlAway: -108 },
  } as NbaGame;
}
/** Plays every ~2 minutes; the away team pulls away. */
function plays(): NbaPlay[] {
  const out: NbaPlay[] = [];
  let a = 0, h = 0;
  for (let q = 1; q <= 4; q++)
    for (let k = 0; k < 6; k++) {
      a += 5; h += 3;
      const secs = 720 - (k + 1) * 120;
      out.push({ id: `${q}-${k}`, period: q, clock: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, text: "shot", awayScore: a, homeScore: h, scoring: true, scoreValue: 2 });
    }
  return out;
}

describe("NBA market probabilities", () => {
  it("builds moneyline, cover and over/under for every play, ending on the result", () => {
    const ps = plays();
    const samples = ps.map((p, i) => ({ playId: p.id, homeWinPercentage: Math.max(0.01, 0.5 - i * 0.02) }));
    const g = game(120, 72, -1.5, 224.5);
    const out = buildNbaProbabilities(samples, ps, g);
    expect(out).toHaveLength(ps.length);
    for (const p of out) {
      expect(p.homeCoverProbability).toBeGreaterThanOrEqual(0);
      expect(p.homeCoverProbability).toBeLessThanOrEqual(1);
      expect(p.overProbability).toBeGreaterThanOrEqual(0);
    }
    const last = out[out.length - 1];
    expect(last.homeWinProbability).toBe(0); // away won
    expect(last.homeCoverProbability).toBe(0); // home -1.5 lost by 48
    expect(last.overProbability).toBe(0); // 192 < 224.5
    expect(out[0].quarter).toBe(1);
    expect(out[0].secondsLeft).toBe(3 * 720 + 600);
  });

  it("locks the over once the score passes the total, and stays locked", () => {
    const ps = plays();
    const samples = ps.map((p) => ({ playId: p.id, homeWinPercentage: 0.3 }));
    const out = buildNbaProbabilities(samples, ps, game(120, 72, -1.5, 150.5));
    const firstOver = out.findIndex((p) => (p.awayScore ?? 0) + (p.homeScore ?? 0) > 150.5);
    expect(firstOver).toBeGreaterThan(0);
    for (const p of out.slice(firstOver)) expect(p.overProbability).toBe(1);
    for (const p of out.slice(0, firstOver)) expect(p.overProbability!).toBeLessThan(1);
  });

  it("returns nothing without win probabilities", () => {
    expect(buildNbaProbabilities([], plays(), game(1, 2, -1, 200))).toEqual([]);
  });
});
