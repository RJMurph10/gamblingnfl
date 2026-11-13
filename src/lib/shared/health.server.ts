/** Server-only: the latest health report from the props-site branch (written hourly by health.yml). */
import type { HealthReport } from "./health";

const URL = "https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/health/status.json";
const TTL = 2 * 60_000;
let hit: { at: number; value: Promise<HealthReport | null> } | null = null;

export function fetchHealth(): Promise<HealthReport | null> {
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = fetch(`${URL}?t=${Math.floor(Date.now() / TTL)}`, {
    headers: { "User-Agent": "GamblingNFL/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => (r.ok ? (r.json() as Promise<HealthReport>) : null))
    .catch(() => null);
  hit = { at: Date.now(), value };
  return value;
}
