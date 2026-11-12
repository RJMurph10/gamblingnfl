// dry run: snapshot plan and credit estimate for the lacrosse historical pull (no Odds API calls)
import { execFileSync } from "node:child_process";
const runs = [
  ["lacrosse_pll", "2024-05-15", "2024-09-30"],
  ["lacrosse_pll", "2025-05-15", "2025-09-30"],
  ["lacrosse_pll", "2026-05-15", "2026-09-30"],
  ["lacrosse_ncaa", "2023-05-01", "2023-06-01"],
  ["lacrosse_ncaa", "2024-02-01", "2024-06-01"],
  ["lacrosse_ncaa", "2025-02-01", "2025-06-01"],
  ["lacrosse_ncaa", "2026-02-01", "2026-06-01"],
];
for (const [s, f, t] of runs)
  console.log(execFileSync("node", ["scripts/lacrosse/odds-history.mjs", "--sport", s, "--from", f, "--to", t, "--dry", "--out", "/tmp/lax"]).toString().trim());
