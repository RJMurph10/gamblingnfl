import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { CLUSTER, LEAD, snapshotTimes } from "../../scripts/lacrosse/odds-history.mjs";

const H = 3_600_000;
const t = (iso: string) => Date.parse(iso);

describe("lacrosse odds snapshot plan", () => {
  it("one snapshot before each cluster of start times, plus an early look before a weekend", () => {
    // Saturday: noon, 1pm and 3pm ET (one cluster), 7pm ET (another); Sunday 1pm
    const starts = [
      t("2026-06-06T16:00:00Z"),
      t("2026-06-06T17:00:00Z"),
      t("2026-06-06T19:00:00Z"),
      t("2026-06-06T23:00:00Z"),
      t("2026-06-07T17:00:00Z"),
    ];
    const snaps = snapshotTimes(starts);
    expect(CLUSTER).toBe(3 * H);
    expect(snaps).toContain(t("2026-06-06T16:00:00Z") - LEAD);
    expect(snaps).toContain(t("2026-06-06T23:00:00Z") - LEAD);
    expect(snaps).toContain(t("2026-06-07T17:00:00Z") - LEAD);
    expect(snaps).not.toContain(t("2026-06-06T17:00:00Z") - LEAD); // same cluster as noon
    // the weekend's first snapshot had nothing in the 48 hours before: an early look 2 days ahead
    expect(snaps).toContain(t("2026-06-06T16:00:00Z") - LEAD - 48 * H);
    expect(snaps).toHaveLength(4);
  });
});
