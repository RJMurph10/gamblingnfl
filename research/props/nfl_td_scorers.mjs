#!/usr/bin/env node
/**
 * NFL touchdown-scorer props, graded: first TD scorer, last TD scorer and 2+ TDs, from ESPN's saved prop
 * history (props-history/nfl/<season>.jsonl.gz: every book's rows plus box scores). ESPN never kept prices
 * for anytime TDs, so those aren't here.
 *
 * Each game's first and last touchdown come from ESPN's scoring summary (the scorer's name opens the
 * play text: "Josh Allen 5 Yd Run", "Stefon Diggs 20 Yd pass from Josh Allen"). 2+ TDs = rushing +
 * receiving + kick / punt return touchdowns in the box score.
 *
 *   node research/props/nfl_td_scorers.mjs <props-history dir> <out dir> [season ...]
 *   Writes <out>/nfl/td-history/<season>.json and prints hit rates and returns against the prices.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const [SRC = "ph", OUT = "out", ...SEASONS] = process.argv.slice(2);
const seasons = SEASONS.length ? SEASONS : ["2023", "2024", "2025"];
/** Book preference: DraftKings (100 new, 40 old), ESPN BET, then the rest. */
const ORDER = ["100", "40", "58", "47", "48", "45", "1005"];
const MARKETS = {
  "First Touchdown Scorer": "first",
  "Last Touchdown Scorer": "last",
  "Player to score 2 or more touchdowns": "two",
};

export const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The scorer's name from a scoring play's text: everything before the yardage ("12 Yd ..."). */
export function scorerOf(text) {
  const m = String(text ?? "").match(/^(.+?)\s+\d+\s*(?:yds?|yards?|yrds?)\b/i);
  return m ? m[1].trim() : null;
}

/** First and last touchdown scorers of a game from ESPN's scoringPlays (null when no touchdown). */
export function firstLast(scoringPlays) {
  const tds = (scoringPlays ?? []).filter((p) => /touchdown/i.test(p?.type?.text ?? p?.scoringType?.displayName ?? ""));
  const name = (p) => scorerOf(p?.text);
  return { first: tds.length ? name(tds[0]) : null, last: tds.length ? name(tds[tds.length - 1]) : null, n: tds.length };
}

const tdsOf = (s = {}) =>
  ["rushing.TD", "receiving.TD", "kickReturns.TD", "puntReturns.TD"].reduce((n, k) => n + (Number(s[k]) || 0), 0);

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return await r.json();
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  return null;
}

const imp = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
const payout = (o) => (o < 0 ? 100 / -o : o / 100);

function summarize(label, bets) {
  const n = bets.length;
  if (!n) return `${label}: none`;
  const hits = bets.filter((b) => b.hit).length;
  const units = bets.reduce((u, b) => u + (b.hit ? payout(b.price) : -1), 0);
  const implied = bets.reduce((s, b) => s + imp(b.price), 0) / n;
  return `${label}: ${n} bets, ${hits} hits (${((100 * hits) / n).toFixed(1)}% vs ${(100 * implied).toFixed(1)}% implied), ROI ${((100 * units) / n).toFixed(1)}%`;
}

async function main() {
  const all = [];
  for (const season of seasons) {
    const text = gunzipSync(await readFile(join(SRC, "nfl", `${season}.jsonl.gz`))).toString("utf8");
    const games = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const out = [];
    for (let i = 0; i < games.length; i += 8) {
      await Promise.all(
        games.slice(i, i + 8).map(async (g) => {
          // each player's price per market from the most preferred book that has one
          const price = new Map(); // `${a}|${m}` → price
          const books = Object.keys(g.books ?? {}).sort(
            (x, y) => (ORDER.indexOf(x) + 99) % 99 - (ORDER.indexOf(y) + 99) % 99,
          );
          for (const pid of books)
            for (const r of g.books[pid].rows) {
              const m = MARKETS[r.t];
              const o = r.op?.[1];
              if (!m || !r.a || o == null || price.has(`${r.a}|${m}`)) continue;
              price.set(`${r.a}|${m}`, o);
            }
          if (!price.size) return;
          const s = await getJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${g.id}`);
          if (!s) return;
          const fl = firstLast(s.scoringPlays);
          const ids = new Set([...price.keys()].map((k) => k.split("|")[0]));
          const props = [];
          for (const a of ids) {
            const bx = g.box?.[a];
            if (!bx || bx.dnp) continue;
            const nm = norm(bx.n);
            const hit = (who) => (who ? norm(who) === nm || nm.endsWith(" " + norm(who)) : false);
            const row = {
              n: bx.n,
              tm: bx.tm,
              pos: bx.pos ?? "",
              home: bx.tm === g.home?.abbr,
              first: price.get(`${a}|first`) ?? null,
              last: price.get(`${a}|last`) ?? null,
              two: price.get(`${a}|two`) ?? null,
              firstHit: hit(fl.first),
              lastHit: hit(fl.last),
              tds: tdsOf(bx.s),
            };
            props.push(row);
            for (const m of ["first", "last", "two"])
              if (row[m] != null)
                all.push({
                  season,
                  m,
                  price: row[m],
                  pos: row.pos,
                  home: row.home,
                  hit: m === "first" ? row.firstHit : m === "last" ? row.lastHit : row.tds >= 2,
                });
          }
          // a game's first TD scorer must be one player at most; flag text that matched nobody
          out.push({ id: g.id, date: g.date, name: g.name, first: fl.first, last: fl.last, tds: fl.n, props });
        }),
      );
    }
    out.sort((x, y) => x.date.localeCompare(y.date));
    await mkdir(join(OUT, "nfl", "td-history"), { recursive: true });
    await writeFile(join(OUT, "nfl", "td-history", `${season}.json`), JSON.stringify(out));
    const matched = out.filter((g) => !g.first || g.props.some((p) => p.firstHit)).length;
    console.log(`nfl ${season}: ${out.length} games; first TD scorer matched to a priced player in ${matched}`);
  }
  // results
  for (const m of ["first", "last", "two"]) {
    const bets = all.filter((b) => b.m === m);
    if (!bets.length) continue;
    console.log(`\n== ${m === "two" ? "2+ TDs" : `${m} TD scorer`} ==`);
    console.log(summarize("all", bets));
    for (const s of seasons) console.log("  " + summarize(s, bets.filter((b) => b.season === s)));
    const bucket = (o) => (o <= 600 ? "+600 or shorter" : o <= 1000 ? "+650 to +1000" : o <= 2000 ? "+1100 to +2000" : "longer than +2000");
    for (const k of ["+600 or shorter", "+650 to +1000", "+1100 to +2000", "longer than +2000"])
      console.log("  " + summarize(k, bets.filter((b) => bucket(b.price) === k)));
    for (const p of ["QB", "RB", "WR", "TE"]) console.log("  " + summarize(p, bets.filter((b) => b.pos === p)));
    console.log("  " + summarize("home", bets.filter((b) => b.home)));
    console.log("  " + summarize("away", bets.filter((b) => !b.home)));
  }
}

if (process.argv[1]?.endsWith("nfl_td_scorers.mjs"))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
