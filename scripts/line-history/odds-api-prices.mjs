/**
 * Looks up DraftKings prices saved by odds-api-nfl.mjs, to fill in prop rows ESPN lists without prices.
 * Matches on home team, kickoff (within 12 hours), player name, market and the exact line.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

const imp = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

/** Returns lookup(homeName, isoDate, player, label, line) → [over, under] | null. */
export async function loadPrices(dir) {
  const files = dir ? (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json")).sort() : [];
  // newest pull wins: read oldest first and overwrite
  const byHome = new Map(); // home → [{ t, map }]
  for (const f of files) {
    let games;
    try {
      games = JSON.parse(await readFile(join(dir, f), "utf8"));
    } catch {
      continue;
    }
    for (const g of games) {
      const t = Date.parse(g.commence);
      const list = byHome.get(norm(g.home)) ?? [];
      let slot = list.find((s) => Math.abs(s.t - t) < 12 * 3_600_000);
      if (!slot) list.push((slot = { t, map: new Map(), main: new Map() }));
      for (const [player, label, line, o, u] of g.props) {
        slot.map.set(`${norm(player)}|${label}|${line}`, [o, u]);
        // the player's main line in this pull: the most balanced priced pair
        if (o == null || u == null) continue;
        const k = `${norm(player)}|${label}`;
        const bal = Math.abs(imp(o) - imp(u));
        const cur = slot.main.get(k);
        if (!cur || cur.at < f || (cur.at === f && bal < cur.bal)) slot.main.set(k, { at: f, bal, v: [line, o, u] });
      }
      byHome.set(norm(g.home), list);
    }
  }
  const size = [...byHome.values()].flat().length;
  return Object.assign(
    (home, date, player, label, line) => {
      const t = Date.parse(date);
      const slot = byHome.get(norm(home))?.find((s) => Math.abs(s.t - t) < 12 * 3_600_000);
      return slot?.map.get(`${norm(player)}|${label}|${Number(line)}`) ?? null;
    },
    {
      size,
      /** The player's priced main line from the newest pull before kickoff: [line, over, under] | null. */
      main(home, date, player, label) {
        const t = Date.parse(date);
        const slot = byHome.get(norm(home))?.find((s) => Math.abs(s.t - t) < 12 * 3_600_000);
        return slot?.main.get(`${norm(player)}|${label}`)?.v ?? null;
      },
    },
  );
}
