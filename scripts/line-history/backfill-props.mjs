#!/usr/bin/env node
/**
 * One-time backfill of historical player props from ESPN's core odds feed. ESPN keeps every book's
 * prop lines for finished games (NBA from 2022–23, NFL yardage props from 2024, NHL/MLB too), each with
 * its open and current (closing) line and price.
 *
 * For each finished game in the date range: list the books ESPN has odds from, pull every book's
 * propBets (inline with limit=1000, so 1–2 requests per book), and save compact rows plus the final
 * score to <out>/<league>/<season>/<YYYY-MM-DD>-<eventId>.json under "history".
 *
 *   node scripts/line-history/backfill-props.mjs --league nba --from 2022-10-01 --to 2023-06-30 --out data
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compactProp, LEAGUES } from "./snapshot.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const KEY = opt("league", "nba");
const FROM = opt("from");
const TO = opt("to");
const OUT = opt("out", "data");
const { sport, league, query } = LEAGUES[KEY];
const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.espn.com/",
  Origin: "https://www.espn.com",
};
let requests = 0;
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    requests += 1;
    try {
      const r = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

const HOUR = 3_600_000;
const etDay = (iso) => new Date(new Date(iso).getTime() - 5 * HOUR).toISOString().slice(0, 10);
function seasonOf(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (KEY === "mlb") return String(y);
  if (KEY === "nfl" || KEY === "cfb") return String(m <= 7 ? y - 1 : y);
  return m <= 7 ? `${y - 1}-${String(y).slice(2)}` : `${y}-${String(y + 1).slice(2)}`;
}
const core = (id) =>
  `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${id}/competitions/${id}/odds`;
const providerNames = new Map();

async function gameProps(id) {
  const list = await get(`${core(id)}?limit=50`);
  const ids = [
    ...new Set(
      (list?.items ?? [])
        .map((it) => String(it?.provider?.id ?? /\/odds\/(\d+)/.exec(it?.$ref ?? "")?.[1] ?? ""))
        .filter(Boolean),
    ),
  ];
  for (const it of list?.items ?? [])
    if (it?.provider?.id) providerNames.set(String(it.provider.id), it.provider.name);
  const books = {};
  for (const pid of ids) {
    const base = `${core(id)}/${pid}/propBets`;
    const first = await get(`${base}?limit=1000&page=1`, 2);
    if (!first?.items?.length) continue;
    const items = [...first.items];
    for (let p = 2; p <= Math.min(Number(first.pageCount) || 1, 10); p++)
      items.push(...((await get(`${base}?limit=1000&page=${p}`, 2))?.items ?? []));
    // Rare $ref-only items: resolve them.
    const full = [];
    for (let i = 0; i < items.length; i += 25) {
      const chunk = await Promise.all(
        items.slice(i, i + 25).map((x) => (!x?.type && x?.$ref ? get(x.$ref, 2) : x)),
      );
      full.push(...chunk.filter(Boolean));
    }
    books[pid] = {
      name: providerNames.get(pid) ?? null,
      count: full.length,
      rows: full.map(compactProp),
    };
  }
  return books;
}

function serialize(rec) {
  const lines = [];
  const copy = structuredClone(rec);
  const marks = [];
  for (const [pid, b] of Object.entries(copy.history?.books ?? {})) {
    marks.push([pid, b.rows]);
    b.rows = `@@ROWS_${pid}@@`;
  }
  let text = JSON.stringify(copy, null, 1);
  for (const [pid, rows] of marks)
    text = text.replace(
      `"@@ROWS_${pid}@@"`,
      `[\n${rows.map((r) => "  " + JSON.stringify(r)).join(",\n")}\n ]`,
    );
  lines.push(text);
  return `${lines.join("")}\n`;
}

async function main() {
  const start = new Date(`${FROM}T12:00:00Z`).getTime();
  const end = new Date(`${TO}T12:00:00Z`).getTime();
  let games = 0;
  let withProps = 0;
  let rows = 0;
  for (let t = start; t <= end; t += 24 * HOUR) {
    const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
    const sb = await get(
      `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${day}${query ? `&${query}` : ""}`,
    );
    const events = (sb?.events ?? []).filter((e) => e?.competitions?.[0]?.status?.type?.completed);
    // a few games at a time
    for (let i = 0; i < events.length; i += 4) {
      await Promise.all(
        events.slice(i, i + 4).map(async (ev) => {
          const comp = ev.competitions[0];
          const side = (h) => comp.competitors.find((c) => c.homeAway === h);
          const team = (c) => ({
            id: String(c?.team?.id ?? ""),
            abbr: String(c?.team?.abbreviation ?? ""),
            name: String(c?.team?.displayName ?? ""),
            score: c?.score != null && c.score !== "" ? Number(c.score) : null,
          });
          games += 1;
          const books = await gameProps(ev.id);
          const n = Object.values(books).reduce((s, b) => s + b.count, 0);
          if (!n) return;
          withProps += 1;
          rows += n;
          const path = join(OUT, KEY, seasonOf(ev.date), `${etDay(ev.date)}-${ev.id}.json`);
          let rec = {};
          try {
            rec = JSON.parse(await readFile(path, "utf8"));
          } catch {
            // new file
          }
          rec.id = String(ev.id);
          rec.league = KEY;
          rec.date = ev.date;
          rec.name = ev.shortName;
          rec.seasonType = ev.season?.type ?? null;
          rec.away = team(side("away"));
          rec.home = team(side("home"));
          rec.final = { away: rec.away.score, home: rec.home.score };
          // "op" = opening line/prices, "cur" = last line ESPN kept (the close for a finished game)
          rec.history = { source: "espn-core-propBets", fetched: new Date().toISOString(), books };
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, serialize(rec));
        }),
      );
    }
  }
  console.log(
    `${KEY} ${FROM}..${TO}: ${games} finished games, ${withProps} with props, ${rows} prop rows, ${requests} requests`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
