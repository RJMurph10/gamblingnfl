/**
 * ESPN's college baseball teams (id, names, abbreviation, logo) for matching ESPN's games to the NCAA's
 * and for team logos. ESPN's college baseball team ids are their own: they don't match the ids in
 * ESPN's logo URLs (Oklahoma baseball is 112, but teamlogos/ncaa/500/112.png is Tufts), so the logo
 * comes from ESPN's own team record.
 *
 *   node scripts/cbase/espn-teams.mjs <out-dir>   → <out-dir>/espn-teams.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = process.argv[2] ?? "out";
const url =
  "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/teams?limit=1000";
let data = null;
for (let i = 1; i <= 4 && !data; i++) {
  try {
    const r = await fetch(url);
    if (r.ok) data = await r.json();
  } catch {
    // retry
  }
  if (!data) await new Promise((res) => setTimeout(res, i * 3000));
}
const teams = (data?.sports?.[0]?.leagues?.[0]?.teams ?? []).map(({ team: x }) => {
  const logos = x.logos ?? [];
  const logo = (logos.find((l) => (l.rel ?? []).includes("default")) ?? logos[0])?.href ?? "";
  return {
    id: String(x.id),
    location: x.location ?? "",
    name: x.name ?? "",
    nickname: x.nickname ?? "",
    abbr: x.abbreviation ?? "",
    display: x.displayName ?? "",
    short: x.shortDisplayName ?? "",
    logo,
  };
});
if (!teams.length) {
  console.error("ESPN teams: none returned");
  process.exit(1);
}
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "espn-teams.json"), JSON.stringify(teams));
console.log(`ESPN teams: ${teams.length}, ${teams.filter((t) => t.logo).length} with logos`);
const ou = teams.find((t) => t.location === "Oklahoma");
if (ou) console.log(`  e.g. ${ou.display}: ${ou.id} → ${ou.logo}`);
