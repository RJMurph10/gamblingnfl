/**
 * When to place a ★ pick, from the opener-vs-close replays (claude/clv-timing.md):
 *  - "now": the line tends to move toward the pick (NBA / college basketball totals at the opener,
 *    NFL wind unders as the forecast firms up), so the opening number is the best one.
 *  - "late": the line tends to drift away from the pick before kickoff (NFL ★ spread rules), so wait.
 */
export type BetTimingKind = "now" | "late";

const TEXT: Record<BetTimingKind, { label: string; why: string }> = {
  now: {
    label: "Bet now",
    why: "The line usually moves toward this pick before game time, so the earliest number is the best one.",
  },
  late: {
    label: "Bet near kickoff",
    why: "The line usually drifts away from this pick during the week, so waiting gets a better number.",
  },
};

export function BetTiming({ kind, className = "" }: { kind: BetTimingKind; className?: string }) {
  const t = TEXT[kind];
  return (
    <span
      title={t.why}
      className={`inline-flex items-center rounded-full px-1.5 py-px font-mono text-[9px] uppercase tracking-wider ring-1 ${
        kind === "now" ? "bg-win/10 text-win ring-win/25" : "bg-line/5 text-mute ring-line/15"
      } ${className}`}
    >
      {t.label}
    </span>
  );
}
