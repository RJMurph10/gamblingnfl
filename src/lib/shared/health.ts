/** Site health (scripts/health/check.mjs → props-site health/status.json), for the Status page. */
export type HealthStatus = "ok" | "warn" | "fail";

export interface HealthCheck {
  group: string;
  id: string;
  name: string;
  status: HealthStatus;
  detail: string;
  /** When the check last changed state (ISO). */
  since: string;
  /** The failed run, for jobs. */
  url?: string;
}

export interface HealthReport {
  checkedAt: string;
  summary: Record<HealthStatus, number>;
  checks: HealthCheck[];
}
