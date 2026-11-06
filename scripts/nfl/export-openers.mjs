#!/usr/bin/env node
/**
 * NFL opening and closing game lines from ESPN's core odds feed (DraftKings first, then ESPN BET), for every
 * regular-season game of one season, plus the final score. Used to test angles against the OPENER (e.g. the
 * quarterback-change angle: QB news often lands after the line opens).
 *   <out>/nfl-lines-<season>.json  [{ id, season, week, date, home, away, hs, as, book, open: [spread, total, mlHome, mlAway],
 *                                     close: [spread, total, mlHome, mlAway] }]   (spread = home's, negative = home favored)
 *
 *   node scripts/nfl/export-openers.mjs 2025 out
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const YEAR = Number(process.argv[2]);
const OUT = process.argv[3] ?? "out";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const H = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};
let requests = 0;
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    requests += 1;
    try {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  return null;
}
const american = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "object") return american(v.american ?? v.alternateDisplayValue ?? v.value);
  const s = String(v).trim().toUpperCase();
  if (s === "EVEN") return 100;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
};
const num = (v) => {
  if (v == null || v === "") return null;
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(v).replace(/^\s*[ou]\s*/i, ""));
  return m ? Number(m[1]) : null;
};
function homeSpread(raw, mlHome, mlAway, h, a) {
  let s = num(raw);
  if (s === null) return null;
  if (s !== 0 && mlHome !== null && mlAway !== null && mlHome !== mlAway) s = mlHome < mlAway ? -Math.abs(s) : Math.abs(s);
  else if (s !== 0 && h?.favorite === true) s = -Math.abs(s);
  else if (s !== 0 && a?.favorite === true) s = Math.abs(s);
  return s;
}
function lineOf(o) {
  const h = o?.homeTeamOdds ?? {};
  const a = o?.awayTeamOdds ?? {};
  const mlHome = american(h.moneyLine) ?? american(o?.moneyline?.home?.close?.odds);
  const mlAway = american(a.moneyLine) ?? american(o?.moneyline?.away?.close?.odds);
  const total = num(o?.overUnder) ?? num(o?.total?.over?.close?.line);
  const close = [homeSpread(o?.pointSpread?.home?.close?.line ?? o?.spread, mlHome, mlAway, h, a), total > 0 ? total : null, mlHome, mlAway];
  const oh = american(h.open?.moneyLine) ?? american(o?.moneyline?.home?.open?.odds);
  const oa = american(a.open?.moneyLine) ?? american(o?.moneyline?.away?.open?.odds);
  const ot = num(o?.open?.total?.american ?? o?.open?.total?.alternateDisplayValue) ?? num(o?.total?.over?.open?.line);
  const open = [
    homeSpread(h.open?.pointSpread?.american ?? h.open?.pointSpread?.alternateDisplayValue ?? o?.pointSpread?.home?.open?.line, oh, oa, h.open, a.open),
    ot > 0 ? ot : null,
    oh,
    oa,
  ];
  return { close, open, book: String(o?.provider?.name ?? "") };
}
async function lines(id) {
  const list = await get(`${CORE}/events/${id}/competitions/${id}/odds?limit=50`);
  const items = [];
  for (const it of list?.items ?? []) items.push(it?.$ref && Object.keys(it).length === 1 ? await get(it.$ref) : it);
  const books = items.filter(Boolean).filter((b) => !/live/i.test(String(b?.provider?.name ?? "")));
  const rank = (b) => (["100", "40"].includes(String(b?.provider?.id)) ? 0 : String(b?.provider?.id) === "58" ? 1 : 2);
  books.sort((x, y) => rank(x) - rank(y));
  for (const b of books) {
    const l = lineOf(b);
    if (l.open[0] !== null || l.close[0] !== null) return l;
  }
  return null;
}

async function main() {
  const games = [];
  for (let week = 1; week <= 18; week += 1) {
    const sb = await get(`${SITE}/scoreboard?dates=${YEAR}&seasontype=2&week=${week}`);
    const evs = (sb?.events ?? []).filter((e) => e?.competitions?.[0]?.status?.type?.completed);
    const rows = await Promise.all(
      evs.map(async (e) => {
        const c = e.competitions[0];
        const side = (s) => c.competitors.find((x) => x.homeAway === s);
        const l = await lines(e.id);
        return {
          id: e.id,
          season: YEAR,
          week,
          date: e.date,
          home: side("home")?.team?.abbreviation,
          away: side("away")?.team?.abbreviation,
          hs: Number(side("home")?.score),
          as: Number(side("away")?.score),
          book: l?.book ?? null,
          open: l?.open ?? null,
          close: l?.close ?? null,
        };
      }),
    );
    games.push(...rows);
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `nfl-lines-${YEAR}.json`), JSON.stringify(games));
  const withOpen = games.filter((g) => g.open?.[0] != null).length;
  console.log(`${YEAR}: ${games.length} games, ${withOpen} with an opening spread; books ${JSON.stringify([...new Set(games.map((g) => g.book))])}; ${requests} requests`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
