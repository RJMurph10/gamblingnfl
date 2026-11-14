import { describe, expect, it } from "vitest";
import type { Game } from "@/data/shared/games";
import { scheduleBusy } from "@/lib/shared/schedule-busy";
import { gameCopyOk } from "@/lib/shared/query-persist";

const g = (status: string, kickoffIso?: string) => ({ status, kickoffIso }) as unknown as Game;
const now = Date.parse("2026-11-14T05:00:00Z");

describe("calm schedule refreshes", () => {
  it("is busy only while a game is on or about to start", () => {
    expect(scheduleBusy([g("final"), g("scheduled", "2026-11-15T18:00:00Z")], now)).toBe(false);
    expect(scheduleBusy([g("live")], now)).toBe(true);
    expect(scheduleBusy([g("scheduled", "2026-11-14T05:10:00Z")], now)).toBe(true);
    expect(scheduleBusy([g("scheduled", "2026-11-13T18:00:00Z")], now)).toBe(false); // stuck / postponed
  });
  it("keeps saved game pages only when they can't mislead", () => {
    expect(gameCopyOk(g("final"), now)).toBe(true);
    expect(gameCopyOk(g("scheduled", "2026-11-15T18:00:00Z"), now)).toBe(true);
    expect(gameCopyOk(g("live"), now)).toBe(false);
    expect(gameCopyOk(g("scheduled", "2026-11-14T04:00:00Z"), now)).toBe(false);
  });
});
