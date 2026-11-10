#!/usr/bin/env node
/**
 * Alt-line tracker: grades DraftKings' alternate over lines (the "X+ yards" ladders saved by
 * sgo-nfl-props.mjs) against what the player actually did, by price bucket. Research found
 * receiving- and passing-yard alt overs at -175 to -250 beat their price in 2024 (71% vs 66% needed),
 * but there were no DraftKings ladder prices to confirm it; this builds that record from Nov 2026.
 *
 *   node scripts/nfl/alt-ladders.mjs --site <props-site checkout>
 *   -> <site>/nfl/alt-ladders-<season>.json
 * Each rung is graded at the newest price saved before kickoff; every rung counts as a 1u bet.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const SITE = args[args.indexOf("--site") + 1] ?? "props-site";
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
const etDay = (iso) => new Date(Date.parse(iso) - 5 * 3_600_000).toISOString().slice(0, 10);
const seasonOf = (day) => (Number(day.slice(5, 7)) >= 8 ? Number(day.slice(0, 4)) : Number(day.slice(0, 4)) - 1);
const payout = (o) => (o > 0 ? o / 100 : 100 / -o);
const implied = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

export const BUCKETS = [
  ["−400 or shorter", -Infinity, -400],
  ["−399 to −250", -399, -250],
  ["−249 to −175", -249, -175],
  ["−174 to −135", -174, -135],
  ["−134 to +100", -134, 100],
  ["+101 to +200", 101, 200],
  ["+201 to +400", 201, 400],
  ["+401 or longer", 401, Infinity],
];
const bucketOf = (o) => BUCKETS.findIndex(([, lo, hi]) => o >= lo && o <= hi);

async function main() {
  // newest ladder per (day, player, market): pulls are pregame only, named by time
  const dir = join(SITE, "nfl", "odds-api");
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith("-sgo.json")).sort();
  const ladders = new Map();
  for (const f of files) {
    for (const g of JSON.parse(await readFile(join(dir, f), "utf8"))) {
      if (!g.alts?.length || !g.commence) continue;
      const day = etDay(g.commence);
      for (const [player, market, ladder] of g.alts) ladders.set(`${day}|${norm(player)}|${market}`, { ladder, at: g.at });
    }
  }
  console.log(`${ladders.size} saved ladders from ${files.length} pulls`);
  const bySeason = new Map();
  const seasons = [...new Set([...ladders.keys()].map((k) => seasonOf(k.slice(0, 10))))];
  for (const season of seasons) {
    const sdir = join(SITE, "nfl", String(season));
    const days = (await readdir(sdir).catch(() => [])).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    const empty = () => BUCKETS.map(([label]) => ({ label, bets: 0, wins: 0, units: 0, needed: 0 }));
    const out = { season, updated: new Date().toISOString(), games: 0, buckets: empty(), byMarket: {}, recent: [] };
    for (const f of days) {
      for (const g of JSON.parse(await readFile(join(sdir, f), "utf8"))) {
        if (g.home?.score == null) continue;
        const day = etDay(g.date);
        let used = false;
        for (const [name, team, market, , , , actual] of g.props ?? []) {
          if (typeof actual !== "number") continue;
          const hit = ladders.get(`${day}|${norm(name)}|${market}`);
          if (!hit) continue;
          used = true;
          for (const [line, price] of hit.ladder) {
            const b = bucketOf(price);
            if (b < 0) continue;
            const win = actual > line;
            const units = win ? payout(price) : -1;
            for (const rec of [out.buckets[b], ((out.byMarket[market] ??= empty()))[b]]) {
              rec.bets++;
              rec.wins += win ? 1 : 0;
              rec.units += units;
              rec.needed += implied(price);
            }
            if (b === 2 && (market === "Rec yds" || market === "Pass yds"))
              out.recent.push([g.date, name, team, g.name, market, line, price, actual, win ? "win" : "loss"]);
          }
        }
        if (used) out.games++;
      }
    }
    const tidy = (list) =>
      list.map((r) => ({ ...r, units: Math.round(r.units * 100) / 100, needed: r.bets ? Math.round((r.needed / r.bets) * 1000) / 10 : null }));
    out.buckets = tidy(out.buckets);
    for (const m of Object.keys(out.byMarket)) out.byMarket[m] = tidy(out.byMarket[m]);
    out.recent.sort((a, b) => b[0].localeCompare(a[0]));
    out.recent = out.recent.slice(0, 200);
    bySeason.set(season, out);
    await writeFile(join(SITE, "nfl", `alt-ladders-${season}.json`), JSON.stringify(out));
    const tot = out.buckets.reduce((s, r) => s + r.bets, 0);
    console.log(`${season}: ${out.games} games, ${tot} graded rungs`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
