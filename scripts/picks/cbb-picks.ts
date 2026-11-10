/**
 * Men's college basketball ★ totals at the opener: run with the NBA picks job (GitHub Actions). Uses the
 * site's own model on the live schedule and records each ★ total (model 6+ points off the opening total)
 * the first time it appears, with the line and time, then tracks where the total goes until tip.
 * Same file format as nba-picks.ts: <out-dir>/cbb/<ET day>.json; graded by grade-picks.mjs.
 *
 *   npx tsx scripts/picks/cbb-picks.ts <out-dir>
 *   NTFY_TOPIC=...   optional phone alert for new ★ picks
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { etDayKey } from "../../src/lib/cbb/cbb";
import { runCbbModel } from "../../src/lib/cbb/cbb-model";
import { fetchCbbSchedule } from "../../src/lib/cbb/cbb.server";

const OUT = process.argv[2] ?? "picks";
const TOPIC = process.env.NTFY_TOPIC ?? "";
const HOURS = 36;

interface Saved {
  id: string;
  game: string;
  tip: string;
  market: "total";
  pick: string;
  line: number;
  open: number | null;
  model: number;
  edge: number;
  best: boolean;
  firstSeen: string;
  latest: number | null;
  latestAt: string;
  alerted: boolean;
}

async function main() {
  const { games } = await fetchCbbSchedule();
  const now = Date.now();
  const stamp = new Date().toISOString();
  const byDay = new Map<string, Saved[]>();
  for (const r of runCbbModel(games)) {
    const g = r.game;
    const b = r.best;
    if (!b || b.rule !== "edge" || g.status !== "scheduled" || g.nonDivisionI) continue;
    if (Date.parse(g.date) - now > HOURS * 3_600_000 || Date.parse(g.date) < now) continue;
    const day = etDayKey(g.date);
    const list = byDay.get(day) ?? [];
    const dir = b.pick === "over" ? 1 : -1;
    list.push({
      id: `${g.id}-total`,
      game: `${g.away.team.abbr} @ ${g.home.team.abbr}`,
      tip: g.date,
      market: "total",
      pick: `${b.pick === "over" ? "Over" : "Under"} ${b.line}`,
      line: b.line,
      open: g.open?.total ?? null,
      model: Math.round((b.line + dir * b.edge) * 10) / 10,
      edge: Math.round(b.edge * 10) / 10,
      best: true,
      firstSeen: stamp,
      latest: g.odds?.total ?? null,
      latestAt: stamp,
      alerted: false,
    });
    byDay.set(day, list);
  }
  // keep tracking the line for picks already saved, even ones the model has since dropped
  const live = new Map(
    games
      .filter((g) => g.status === "scheduled")
      .map((g) => [`${g.id}-total`, g.odds?.total ?? null]),
  );
  await mkdir(join(OUT, "cbb"), { recursive: true });
  const fresh: Saved[] = [];
  const days = new Set([
    ...byDay.keys(),
    etDayKey(new Date(now)),
    etDayKey(new Date(now + 86_400_000)),
  ]);
  for (const day of days) {
    const file = join(OUT, "cbb", `${day}.json`);
    let saved: Saved[] = [];
    try {
      saved = JSON.parse(await readFile(file, "utf8")).picks ?? [];
    } catch {
      // first run of the day
    }
    const byId = new Map(saved.map((p) => [p.id, p]));
    for (const p of byId.values())
      if (live.has(p.id) && live.get(p.id) != null) {
        p.latest = live.get(p.id)!;
        p.latestAt = stamp;
      }
    for (const p of byDay.get(day) ?? [])
      if (!byId.has(p.id)) {
        byId.set(p.id, p);
        fresh.push(p);
      }
    if (!byId.size) continue;
    const picks = [...byId.values()].sort(
      (a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id),
    );
    await writeFile(file, JSON.stringify({ day, updated: stamp, picks }, null, 1));
    console.log(`${day}: ${picks.length} ★ picks`);
  }
  if (!fresh.length || !TOPIC) return;
  const lines = fresh.map((p) => `★ ${p.pick} · ${p.game} (model ${p.model}, ${p.edge} off)`);
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(TOPIC)}`, {
    method: "POST",
    headers: {
      Title: `College hoops ★ totals: ${fresh.length} new`,
      Tags: "basketball",
      Priority: "high",
    },
    body: `${lines.join("\n")}\nBet near this number: the edge is at the opener.`,
  });
  console.log(`ntfy: ${res.status}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
