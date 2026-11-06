#!/usr/bin/env node
/**
 * One MLS season from ESPN (soccer/usa.1): every finished match with its score and every book's opening and
 * closing three-way moneylines (home / draw / away), total and spread, from ESPN's core odds. For research
 * (research/mls). Runs in GitHub Actions (.github/workflows/mls-history.yml).
 *   node scripts/mls/export-season.mjs 2025 out   → out/espn-2025.jsonl.gz
 * Row: { id, date, type, h: [id, abbr, goals], a: [...], books: [{ name, open: {...}, close: {...} }] }
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const YEAR = Number(process.argv[2]);
const OUT = process.argv[3] ?? "out";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1";
const CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/usa.1";

async function get(url) {
  for (let i = 0; i < 4; i += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "gamblingnfl-research" } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const side = (o) =>
  o
    ? {
        ml: num(o.moneyLine ?? o.odds?.american ?? o.american),
        spread: num(o.pointSpread?.american ?? o.spreadOdds),
      }
    : null;

function snap(o, when) {
  // ESPN's soccer odds keep "open" / "close" blocks inside homeTeamOdds, awayTeamOdds and drawOdds
  const pick = (x) => (when === "open" ? x?.open : x?.close ?? x?.current ?? x);
  const h = pick(o.homeTeamOdds);
  const a = pick(o.awayTeamOdds);
  const d = when === "open" ? o.drawOdds?.open : o.drawOdds?.close ?? o.drawOdds;
  const tot = when === "open" ? o.open : o.close ?? o.current ?? o;
  return {
    ml: [num(h?.moneyLine?.american ?? h?.moneyLine), num(d?.moneyLine?.american ?? d?.moneyLine), num(a?.moneyLine?.american ?? a?.moneyLine)],
    spread: num(h?.pointSpread?.alternateDisplayValue ?? h?.pointSpread?.american ?? (when === "close" ? o.spread : null)),
    total: num(tot?.total?.alternateDisplayValue ?? tot?.total?.american ?? (when === "close" ? o.overUnder : null)),
    over: num(tot?.over?.american ?? (when === "close" ? o.overOdds : null)),
    under: num(tot?.under?.american ?? (when === "close" ? o.underOdds : null)),
  };
}

const rows = [];
const start = Date.UTC(YEAR, 1, 10);
const end = Math.min(Date.now(), Date.UTC(YEAR, 11, 20));
const seen = new Set();
for (let t = start; t <= end; t += 7 * 86_400_000) {
  const ymd = (x) => new Date(x).toISOString().slice(0, 10).replace(/-/g, "");
  const sb = await get(`${SITE}/scoreboard?dates=${ymd(t)}-${ymd(Math.min(t + 6 * 86_400_000, end))}&limit=200`);
  for (const e of sb?.events ?? []) {
    const comp = e.competitions?.[0];
    if (!comp?.status?.type?.completed || seen.has(e.id)) continue;
    seen.add(e.id);
    const c = (x) => comp.competitors?.find((k) => k.homeAway === x);
    const H = c("home");
    const A = c("away");
    if (!H || !A) continue;
    const list = await get(`${CORE}/events/${e.id}/competitions/${comp.id}/odds?limit=50`);
    const books = [];
    for (const it of list?.items ?? []) {
      const o = it?.$ref ? await get(it.$ref) : it;
      if (!o) continue;
      books.push({ name: o.provider?.name ?? "", open: snap(o, "open"), close: snap(o, "close") });
    }
    rows.push({
      id: e.id,
      date: e.date,
      type: Number(e.season?.type ?? 1),
      h: [String(H.team?.id), H.team?.abbreviation ?? "", num(H.score)],
      a: [String(A.team?.id), A.team?.abbreviation ?? "", num(A.score)],
      books,
    });
  }
}
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, `espn-${YEAR}.jsonl.gz`), gzipSync(rows.map((r) => JSON.stringify(r)).join("\n")));
console.log(`MLS ${YEAR}: ${rows.length} matches, ${rows.filter((r) => r.books.length).length} with odds`);
