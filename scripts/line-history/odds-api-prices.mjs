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

/** Props only the SportsGameOdds pulls carry (ESPN's feed doesn't list them): added to the board as is. */
export const isPullOnly = (label) => /^(1H|1Q|2Q|3Q|4Q) /.test(label) || label === "Longest comp";

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
            otherMain: new Map(),
            opened: new Map(),
            sides: new Map(),
            tdb: new Map(),
          }),
        );
      for (const [n, side] of Object.entries(g.sides ?? {})) slot.sides.set(norm(n), [n, side]);
      for (const [n, side, price, book] of g.tdb ?? [])
        slot.tdb.set(norm(n), [n, side, price, book]);
      // other books' prices where DraftKings has none (newest pull wins)
      for (const [player, label, line, o, u, book] of g.others ?? []) {
        slot.other.set(`${norm(player)}|${label}|${Number(line)}`, [o, u, book]);
        if (isPullOnly(label)) {
          const k = `${norm(player)}|${label}`;
          slot.otherMain.set(k, [player, Number(line), o, u, book]);
          if (!slot.opened.has(k)) slot.opened.set(k, Number(line));
        }
      }
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
        if (isPullOnly(label)) {
          slot.names ??= new Map();
          slot.names.set(k, player);
        }
        const bal = Math.abs(imp(o) - imp(u));
        const cur = slot.main.get(k);
        if (!cur || cur.at < f || (cur.at === f && bal < cur.bal))
          slot.main.set(k, { at: f, bal, v: [line, o, u] });
      }
      // where a pull-only prop opened: its main line in the first pull that had it
      for (const [k, m] of slot.main)
        if (m.at === f && isPullOnly(k.split("|")[1]) && !slot.opened.has(`${k}|dk`))
          slot.opened.set(`${k}|dk`, m.v[0]);
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
        if (!slot?.td && !slot?.tdb.size) return null;
        const rows = (slot.td ?? []).map((r) => [
          ...r.slice(0, 6),
          ...(slot.tdOpen.get(norm(r[0])) ?? [null, null, null, null]),
        ]);
        // players DraftKings doesn't price, from the other books
        const have = new Set(rows.map((r) => norm(r[0])));
        for (const [k, [n, side]] of slot.tdb)
          if (!have.has(k)) rows.push([n, side, null, null, null, null, null, null, null, null]);
        // the best anytime price across the books, and which book: positions 10, 11
        return rows.map((r) => {
          const b = slot.tdb.get(norm(r[0]));
          return [...r, b ? b[2] : null, b ? b[3] : null];
        });
      },
      /**
       * Props only the pulls carry (1st-half / quarter props, longest completion), newest pull's main line:
       * [[player, home|away|"", label, line, over, under, opened, book tag | null]]. DraftKings first, else
       * another book's.
       */
      extra(home, date) {
        const t = Date.parse(date);
        const slot = byHome.get(norm(home))?.find((s) => Math.abs(s.t - t) < 12 * 3_600_000);
        if (!slot) return [];
        const out = new Map();
        for (const [k, m] of slot.main) {
          const [p, label] = k.split("|");
          if (!isPullOnly(label)) continue;
          const name = slot.names?.get(k) ?? p;
          out.set(k, [
            name,
            slot.sides.get(p)?.[1] ?? "",
            label,
            ...m.v,
            slot.opened.get(`${k}|dk`) ?? m.v[0],
            null,
          ]);
        }
        for (const [k, [name, line, o, u, book]] of slot.otherMain) {
          if (out.has(k) || o == null || u == null) continue;
          const p = k.split("|")[0];
          out.set(k, [
            name,
            slot.sides.get(p)?.[1] ?? "",
            k.split("|")[1],
            line,
            o,
            u,
            slot.opened.get(k) ?? line,
            book,
          ]);
        }
        return [...out.values()];
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
