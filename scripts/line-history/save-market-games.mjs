#!/usr/bin/env node
/**
 * NFL "All lines": one file per game with every book's full-game spread / moneyline / total and every
 * half, quarter, team-total and special market (scripts/line-history/sgo-markets.mjs), kept after kickoff
 * so live and finished games still show them. Each pull before kickoff replaces the lines (the last one
 * is the close); the first pull's lines stay as the opener.
 *   <dir>/games/<ET day>-<away>-at-<home>.json
 *     { home, away, commence, at, full, books, mk, open: { at, books, mk } }
 *   <dir>/index.json  [{ f, home, away, commence }]  (newest season's games)
 *
 *   node save-market-games.mjs <dir> <more-markets snapshot> <best-lines snapshot>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [dir, morePath, bestPath] = process.argv.slice(2);
const read = async (p) => {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
};
const slug = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
/** The game's day in US Eastern time (UTC−5), so a late kickoff stays on its own day. */
const etDay = (iso) => new Date(Date.parse(iso) - 5 * 3_600_000).toISOString().slice(0, 10);
export const gameFile = (g) => `${etDay(g.commence)}-${slug(g.away)}-at-${slug(g.home)}.json`;

async function main() {
  const more = (await read(morePath))?.games ?? [];
  const best = (await read(bestPath))?.games ?? [];
  const at = (await read(morePath))?.at ?? new Date().toISOString();
  const now = Date.now();
  await mkdir(join(dir, "games"), { recursive: true });
  const index = (await read(join(dir, "index.json"))) ?? [];
  const byFile = new Map(index.map((r) => [r.f, r]));
  let n = 0;
  for (const g of more) {
    // only lines from before kickoff (in-game prices aren't the close)
    if (!(Date.parse(g.commence) > now)) continue;
    const f = gameFile(g);
    const path = join(dir, "games", f);
    const old = await read(path);
    const b = best.find(
      (x) =>
        x.home === g.home &&
        x.away === g.away &&
        Math.abs(Date.parse(x.commence) - Date.parse(g.commence)) < 6 * 3_600_000,
    );
    const books = b?.books ?? old?.books ?? [];
    const rec = {
      home: g.home,
      away: g.away,
      commence: g.commence,
      at: g.at ?? at,
      full: g.full ?? null,
      books,
      mk: g.mk ?? [],
      open: old?.open ?? { at: g.at ?? at, books, mk: g.mk ?? [] },
    };
    await writeFile(path, JSON.stringify(rec));
    byFile.set(f, { f, home: g.home, away: g.away, commence: g.commence });
    n += 1;
  }
  // keep about a season and a half of games in the index
  const cutoff = now - 500 * 86_400_000;
  const out = [...byFile.values()]
    .filter((r) => Date.parse(r.commence) > cutoff)
    .sort((a, b) => a.commence.localeCompare(b.commence));
  await writeFile(join(dir, "index.json"), JSON.stringify(out));
  console.log(`all lines: ${n} games saved, ${out.length} in the index`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
