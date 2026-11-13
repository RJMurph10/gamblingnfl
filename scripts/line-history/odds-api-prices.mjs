/**
 * Looks up DraftKings prices saved by odds-api-nfl.mjs and sgo-nfl-props.mjs, to fill in prop rows ESPN lists without prices.
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
  const files = dir
    ? (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json")).sort()
    : [];
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
      if (!slot)
        list.push(
          (slot = {
            t,
            map: new Map(),
            main: new Map(),
            alts: new Map(),
            td: null,
            tdOpen: new Map(),
            other: new Map(),
          }),
        );
      // other books' prices where DraftKings has none (newest pull wins)
      for (const [player, label, line, o, u, book] of g.others ?? [])
        slot.other.set(`${norm(player)}|${label}|${Number(line)}`, [o, u, book]);
      // newest pull's touchdown-scorer prices win; the first pull that had a player is where it opened
      if (g.td?.length) {
        slot.td = g.td;
        for (const r of g.td)
          if (!slot.tdOpen.has(norm(r[0]))) slot.tdOpen.set(norm(r[0]), r.slice(2, 6));
      }
      // newest pull's ladder wins (files are read oldest first)
      for (const [player, label, ladder] of g.alts ?? [])
        slot.alts.set(`${norm(player)}|${label}`, ladder);
      for (const [player, label, line, o, u] of g.props ?? []) {
        slot.map.set(`${norm(player)}|${label}|${line}`, [o, u]);
        // the player's main line in this pull: the most balanced priced pair
        if (o == null || u == null) continue;
        const k = `${norm(player)}|${label}`;
        const bal = Math.abs(imp(o) - imp(u));
        const cur = slot.main.get(k);
        if (!cur || cur.at < f || (cur.at === f && bal < cur.bal))
          slot.main.set(k, { at: f, bal, v: [line, o, u] });
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
      /**
       * The newest saved touchdown-scorer prices, with where each opened (the first saved pull):
       * [[player, team, anytime, first, 2+, last, open anytime, open first, open 2+, open last]] | null.
       */
      td(home, date) {
        const t = Date.parse(date);
        const slot = byHome.get(norm(home))?.find((s) => Math.abs(s.t - t) < 12 * 3_600_000);
        if (!slot?.td) return null;
        return slot.td.map((r) => [
          ...r.slice(0, 6),
          ...(slot.tdOpen.get(norm(r[0])) ?? [null, null, null, null]),
        ]);
      },
      /** Another book's prices at exactly this line, where DraftKings has none: [over, under, book tag] | null. */
      other(home, date, player, label, line) {
        const t = Date.parse(date);
        const slot = byHome.get(norm(home))?.find((s) => Math.abs(s.t - t) < 12 * 3_600_000);
        return slot?.other.get(`${norm(player)}|${label}|${Number(line)}`) ?? null;
      },
      /** The newest saved alternate over lines: [[line, over price], ...] | null. */
      ladder(home, date, player, label) {
        const t = Date.parse(date);
        const slot = byHome.get(norm(home))?.find((s) => Math.abs(s.t - t) < 12 * 3_600_000);
        return slot?.alts.get(`${norm(player)}|${label}`) ?? null;
      },
    },
  );
}
