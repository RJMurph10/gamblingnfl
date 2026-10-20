import { useEffect, useState, useRef } from "react";

/**
 * Checks if an NFL play description indicates the clock should be stopped.
 */
function isClockStoppedByPlay(playText?: string): boolean {
  if (!playText) return false;
  const text = playText.toLowerCase();

  // Incomplete pass
  if (text.includes("incomplete") || text.includes("pass incomplete")) return true;
  // Out of bounds
  if (text.includes("out of bounds") || text.includes("ob")) return true;
  // Timeouts
  if (text.includes("timeout")) return true;
  // Scoring plays & change of possession
  if (text.includes("touchdown") || text.includes("field goal") || text.includes("safety")) return true;
  if (text.includes("punts") || text.includes("intercepted") || text.includes("fumble")) return true;
  // Two-minute warning & official reviews
  if (text.includes("two-minute warning") || text.includes("under review")) return true;

  return false;
}

/**
 * TV-style running clock hook.
 * Counts down second-by-second between ESPN updates, and re-anchors whenever
 * ESPN publishes a new play time.
 */
export function useRunningGameClock({
  clock,
  status,
  lastPlayText,
}: {
  clock?: string;
  status: string;
  lastPlayText?: string;
}): string {
  const rawClock = (clock ?? "").trim();

  // If game is not live, or at halftime / end of quarter / final, display as-is
  const isSpecialState =
    status !== "live" ||
    !rawClock ||
    /half|end|final|delayed|postponed/i.test(rawClock);

  // Parse quarter prefix and MM:SS (e.g. "1st 12:19", "4th 2:05", "12:19 - 1st Quarter")
  const parseTime = (str: string) => {
    // Match "12:19 - 1st Quarter" or "1st 12:19" or "OT 8:45"
    const m =
      str.match(/^(?:([1-4](?:st|nd|rd|th)|OT)\s+)?(\d{1,2}):(\d{2})$/i) ||
      str.match(/^(\d{1,2}):(\d{2})\s*-\s*(.+)$/i);

    if (!m) return null;

    let quarter = "";
    let mins = 0;
    let secs = 0;

    if (str.includes("-")) {
      // "12:19 - 1st Quarter"
      mins = parseInt(m[1], 10);
      secs = parseInt(m[2], 10);
      quarter = m[3].replace(/\s*Quarter\b/i, "").trim();
    } else {
      // "1st 12:19"
      quarter = m[1] ?? "";
      mins = parseInt(m[2], 10);
      secs = parseInt(m[3], 10);
    }

    return {
      quarter,
      totalSeconds: mins * 60 + secs,
    };
  };

  const parsed = !isSpecialState ? parseTime(rawClock) : null;
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(
    parsed?.totalSeconds ?? null,
  );
  const [quarterPrefix, setQuarterPrefix] = useState<string>(
    parsed?.quarter ?? "",
  );

  // Re-anchor whenever ESPN publishes a new clock string
  const lastRawClock = useRef(rawClock);
  useEffect(() => {
    if (rawClock !== lastRawClock.current) {
      lastRawClock.current = rawClock;
      const p = parseTime(rawClock);
      if (p) {
        setSecondsRemaining(p.totalSeconds);
        setQuarterPrefix(p.quarter);
      }
    }
  }, [rawClock]);

  // Tick down every second if clock is actively running
  useEffect(() => {
    if (isSpecialState || secondsRemaining === null || secondsRemaining <= 0) return;
    if (isClockStoppedByPlay(lastPlayText)) return;

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [isSpecialState, lastPlayText, secondsRemaining]);

  if (isSpecialState || secondsRemaining === null) {
    return rawClock || "Live";
  }

  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  const timeFormatted = `${m}:${s < 10 ? "0" : ""}${s}`;

  return quarterPrefix ? `${quarterPrefix} ${timeFormatted}` : timeFormatted;
}
