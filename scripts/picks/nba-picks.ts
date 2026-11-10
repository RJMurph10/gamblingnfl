/**
 * NBA picks at the opener: run a few times a day (GitHub Actions, scripts/picks workflow). Uses the
 * site's own model code on ESPN's live schedule, records each spread/total pick the first time it
 * appears (with the opening line and the time), and sends a phone alert for new ★ picks.
 *
 *   npx tsx scripts/picks/nba-picks.ts <out-dir>      (out-dir = the picks folder on props-site)
 *   NTFY_TOPIC=...   optional: push alerts through ntfy.sh (free app; subscribe to the same topic)
 *
 * <out-dir>/nba/<ET day>.json: { day, picks: [{ id, game, tip, market, pick, line, open, model,
 *   edge, best, firstSeen, latest, latestAt, alerted }] }. A pick keeps its first-seen line; later
 *   runs only update `latest` (the current line), so the file is a record of the price you could have
 *   bet when the pick went out, and of how the line moved after.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { etDayKey } from "../../src/lib/nba/nba";
import { runNbaModel } from "../../src/lib/nba/nba-model";
import { fetchNbaInjuries, fetchNbaPriorTeams, fetchNbaSchedule } from "../../src/lib/nba/nba.server";
import { starAdjust, type StarFile } from "../../src/lib/nba/star-absence";

const OUT = process.argv[2] ?? "picks";
const TOPIC = process.env.NTFY_TOPIC ?? "";
const HOURS = 36;
const signed = (n: number) => (n === 0 ? "PK" : n > 0 ? `+${n}` : String(n));

interface Saved {
  id: string;
  game: string;
  tip: string;
  market: "spread" | "total";
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
  const [games, prior, injuries] = await Promise.all([
    fetchNbaSchedule(),
    fetchNbaPriorTeams(),
    fetchNbaInjuries().catch(() => []),
  ]);
  // this season's stars, built just before by nba-stars.mjs
  let stars: StarFile | null = null;
  try {
    if (process.env.STARS_FILE) stars = JSON.parse(await readFile(process.env.STARS_FILE, "utf8"));
  } catch {
    stars = null;
  }
  const now = Date.now();
  const rows = runNbaModel(games, prior, (g) =>
    starAdjust(g.home.team.abbr, g.away.team.abbr, stars, injuries),
  ).filter(
    (r) => r.game.status === "scheduled" && Date.parse(r.game.date) - now < HOURS * 3_600_000,
  );
  const stamp = new Date().toISOString();
  const byDay = new Map<string, Saved[]>();
  for (const r of rows) {
    const g = r.game;
    const name = `${g.away.team.abbr} @ ${g.home.team.abbr}`;
    const day = etDayKey(g.date);
    const list = byDay.get(day) ?? [];
    if (r.total)
      list.push({
        id: `${g.id}-total`,
        game: name,
        tip: g.date,
        market: "total",
        pick: `${r.total.pick === "over" ? "Over" : "Under"} ${r.total.line}`,
        line: r.total.line,
        open: g.odds?.totalOpen ?? null,
        model: Math.round(r.pred.total * 10) / 10,
        edge: Math.round(r.total.edge * 10) / 10,
        best: r.total.best,
        firstSeen: stamp,
        latest: g.odds?.total ?? null,
        latestAt: stamp,
        alerted: false,
      });
    if (r.spread)
      list.push({
        id: `${g.id}-spread`,
        game: name,
        tip: g.date,
        market: "spread",
        pick: `${r.spread.pick === "home" ? g.home.team.abbr : g.away.team.abbr} ${signed(r.spread.pick === "home" ? r.spread.line : -r.spread.line)}`,
        line: r.spread.line,
        open: g.odds?.spreadOpen ?? null,
        model: Math.round(r.pred.margin * 10) / 10,
        edge: Math.round(r.spread.edge * 10) / 10,
        best: r.spread.best,
        firstSeen: stamp,
        latest: g.odds?.spread ?? null,
        latestAt: stamp,
        alerted: false,
      });
    byDay.set(day, list);
  }
  await mkdir(join(OUT, "nba"), { recursive: true });
  const fresh: Saved[] = [];
  for (const [day, found] of byDay) {
    const file = join(OUT, "nba", `${day}.json`);
    let saved: Saved[] = [];
    try {
      saved = JSON.parse(await readFile(file, "utf8")).picks ?? [];
    } catch {
      // first run of the day
    }
    const byId = new Map(saved.map((p) => [p.id, p]));
    for (const p of found) {
      const old = byId.get(p.id);
      if (old) {
        // keep the first-seen pick and line; track where the line is now
        old.latest = p.latest;
        old.latestAt = stamp;
      } else {
        byId.set(p.id, p);
        if (p.best && p.market === "total") fresh.push(p);
      }
    }
    const picks = [...byId.values()].sort(
      (a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id),
    );
    await writeFile(file, JSON.stringify({ day, updated: stamp, picks }, null, 1));
    console.log(`${day}: ${picks.length} picks (${found.length} now on the board)`);
  }
  if (!fresh.length) {
    console.log("no new ★ picks");
    return;
  }
  const lines = fresh.map((p) => `★ ${p.pick} · ${p.game} (model ${p.model}, ${p.edge} off)`);
  console.log(lines.join("\n"));
  if (!TOPIC) {
    console.log("NTFY_TOPIC not set: no phone alert");
    return;
  }
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(TOPIC)}`, {
    method: "POST",
    headers: { Title: `NBA ★ totals: ${fresh.length} new`, Tags: "basketball", Priority: "high" },
    body: `${lines.join("\n")}\nBet near this number: the edge is at the opener.`,
  });
  console.log(`ntfy: ${res.status}`);
  if (res.ok) {
    // mark them alerted
    for (const [day] of byDay) {
      const file = join(OUT, "nba", `${day}.json`);
      const data = JSON.parse(await readFile(file, "utf8"));
      for (const p of data.picks) if (fresh.some((f) => f.id === p.id)) p.alerted = true;
      await writeFile(file, JSON.stringify(data, null, 1));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
