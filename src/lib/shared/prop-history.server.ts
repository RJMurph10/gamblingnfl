/* eslint-disable @typescript-eslint/no-explicit-any -- ESPN feed JSON is untyped */
/**
 * Server-only: historical player prop lines with results, for the "Prop history" pages. Read from the
 * repo's props-site branch (built from ESPN by scripts/line-history/build-props-site.mjs, refreshed
 * daily by .github/workflows/props-daily.yml). Past seasons are cached long-term.
 */
import { finalCached } from "./final-cache.server";
import { fetchNbaRoster } from "../nba/nba.server";
import { fetchTeamRoster } from "./espn-teams-players.server";

const BASE = "https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site";
const MINUTE = 60_000;

/** [player, team, market, line, over price, under price, actual] */
export type PropHistoryRow = [
  string,
  string,
  string,
  number,
  number | null,
  number | null,
  number | null,
];

export interface PropHistoryGame {
  id: string;
  date: string;
  name: string;
  away: { abbr: string; name: string; score: number | null };
  home: { abbr: string; name: string; score: number | null };
  props: PropHistoryRow[];
}

export interface PropHistoryDay {
  seasons: string[];
  season: string;
  days: string[];
  day: string | null;
  games: PropHistoryGame[];
}

const memo = new Map<string, { at: number; value: unknown }>();
async function getJson<T>(url: string, ttl: number): Promise<T | null> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const value = (await res.json()) as T;
    memo.set(url, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

export async function fetchPropHistory(
  league: "nba" | "nfl",
  season?: string,
  day?: string,
): Promise<PropHistoryDay> {
  const index = await getJson<{ seasons: Record<string, string[]> }>(
    `${BASE}/${league}/index.json`,
    15 * MINUTE,
  );
  const seasons = Object.keys(index?.seasons ?? {})
    .filter((s) => (index?.seasons[s]?.length ?? 0) > 0)
    .sort()
    .reverse();
  const s = season && seasons.includes(season) ? season : (seasons[0] ?? "");
  const days = index?.seasons[s] ?? [];
  const d = day && days.includes(day) ? day : (days[days.length - 1] ?? null);
  let games: PropHistoryGame[] = [];
  if (d) {
    const url = `${BASE}/${league}/${s}/${d}.json`;
    const isCurrent = s === seasons[0];
    games = isCurrent
      ? ((await getJson<PropHistoryGame[]>(url, 15 * MINUTE)) ?? [])
      : await finalCached(
          `prop-history-v1-${league}-${s}-${d}`,
          async () => {
            const g = await getJson<PropHistoryGame[]>(url, 60 * MINUTE);
            if (!g) throw new Error("prop history unavailable");
            return g;
          },
          (g) => g.length > 0,
        ).catch(() => []);
  }
  return { seasons, season: s, days, day: d, games };
}

/* ---------- upcoming games: DraftKings lines posted now ---------- */

/** [player, team, market, current line, over, under, opening line] */
export type UpcomingPropRow = [
  string,
  string,
  string,
  number,
  number | null,
  number | null,
  number | null,
];

export interface UpcomingPropGame {
  id: string;
  date: string;
  name: string;
  away: { abbr: string; name: string };
  home: { abbr: string; name: string };
  props: UpcomingPropRow[];
}

const SPORT = { nba: "basketball/nba", nfl: "football/nfl" } as const;
/** ESPN market name → short label (same markets as the history pages). */
const MARKET_LABELS: Record<"nba" | "nfl", Record<string, string>> = {
  nba: {
    "Total Points": "Points",
    "Total Rebounds": "Rebounds",
    "Total Assists": "Assists",
    "Total 3-Point Field Goals": "3-pointers",
    "Total Points, Rebounds, and Assists": "Pts+Reb+Ast",
    "Total Points and Rebounds": "Pts+Reb",
    "Total Points and Assists": "Pts+Ast",
    "Total Assists and Rebounds": "Reb+Ast",
    "Total Steals": "Steals",
    "Total Blocks": "Blocks",
    "Total Turnovers": "Turnovers",
  },
  nfl: {
    "Total Passing Yards (incl. overtime)": "Pass yds",
    "Total Passing Attempts (incl. overtime)": "Pass att",
    "Total Pass Completions (incl. overtime)": "Completions",
    "Total Passing Touchdowns (incl. overtime)": "Pass TDs",
    "Total Passing Interceptions (incl. overtime)": "Interceptions",
    "Total Rushing Yards (incl. overtime)": "Rush yds",
    "Total Carries (incl. overtime)": "Carries",
    "Total Receiving Yards (incl. overtime)": "Rec yds",
    "Total Receptions (incl. overtime)": "Receptions",
    "Total Rushing Plus Receiving Yards (incl. overtime)": "Rush+Rec yds",
    "Total Passing Plus Rushing Yards (incl. overtime)": "Pass+Rush yds",
  },
};

const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.espn.com/",
  Origin: "https://www.espn.com",
};
async function espn(url: string): Promise<any> {
  try {
    const r = await fetch(url, { headers: BROWSER });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
const american = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === "object") return american(v.american ?? v.alternateDisplayValue ?? v.value);
  const s = String(v).trim().toUpperCase();
  if (s === "EVEN") return 100;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
};
const lineOf = (b: any): number | null => {
  const v = Number(b?.target?.value ?? b?.target);
  return Number.isFinite(v) ? v : null;
};
const impliedOf = (o: number) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

/** Main line per player and market from one game's prop items (balanced priced pair, else the line listed). */
function mainUpcoming(items: any[], labels: Record<string, string>) {
  type P = {
    a: string;
    t: string;
    line: number;
    open: number | null;
    o: number | null;
    u: number | null;
  };
  const pairs = new Map<string, P>();
  const bare = new Map<string, Map<number, { n: number; open: number | null }>>();
  for (const x of items) {
    const t = String(x?.type?.name ?? "");
    if (!labels[t]) continue;
    const a =
      /\/athletes\/(\d+)/.exec(x?.athlete?.$ref ?? "")?.[1] ??
      (x?.athlete?.id ? String(x.athlete.id) : null);
    const line = lineOf(x?.current);
    if (!a || line === null) continue;
    const open = lineOf(x?.open);
    const o = american(x?.current?.over ?? x?.odds?.over);
    const u = american(x?.current?.under ?? x?.odds?.under);
    const key = `${a}|${t}`;
    if (o === null && u === null) {
      const m = bare.get(key) ?? new Map();
      const e = m.get(line) ?? { n: 0, open };
      e.n += 1;
      m.set(line, e);
      bare.set(key, m);
      continue;
    }
    const pk = `${key}|${line}`;
    const p = pairs.get(pk) ?? { a, t, line, open, o: null, u: null };
    if (o !== null) p.o = o;
    if (u !== null) p.u = u;
    pairs.set(pk, p);
  }
  const out = new Map<string, P>();
  const bal = (p: P) => Math.abs(impliedOf(p.o as number) - impliedOf(p.u as number));
  for (const p of pairs.values()) {
    if (p.o === null || p.u === null || bal(p) > 0.25) continue;
    const key = `${p.a}|${p.t}`;
    const cur = out.get(key);
    if (!cur || bal(p) < bal(cur)) out.set(key, p);
  }
  for (const [key, m] of bare) {
    if (out.has(key)) continue;
    const [line, e] = [...m.entries()].sort((x, y) => y[1].n - x[1].n || x[0] - y[0])[0];
    const [a, t] = key.split("|");
    out.set(key, { a, t, line, open: e.open, o: null, u: null });
  }
  return [...out.values()];
}

/** Today's and the next few days' games with the DraftKings player lines posted so far. */
export async function fetchUpcomingProps(league: "nba" | "nfl"): Promise<UpcomingPropGame[]> {
  const key = `upcoming-${league}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 5 * MINUTE) return hit.value as UpcomingPropGame[];
  const sport = SPORT[league];
  const days = league === "nfl" ? 7 : 2;
  const events: any[] = [];
  for (let d = 0; d <= days; d++) {
    const t = new Date(Date.now() - 5 * 3_600_000 + d * 86_400_000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "");
    const sb = await espn(
      `https://site.api.espn.com/apis/site/v2/sports/${sport}/scoreboard?dates=${t}`,
    );
    for (const e of sb?.events ?? [])
      if (e?.competitions?.[0]?.status?.type?.state === "pre") events.push(e);
  }
  const labels = MARKET_LABELS[league];
  const games = await Promise.all(
    events.slice(0, 20).map(async (e) => {
      const comp = e.competitions[0];
      const side = (h: string) => comp.competitors.find((c: any) => c.homeAway === h)?.team ?? {};
      const away = side("away");
      const home = side("home");
      const core = `https://sports.core.api.espn.com/v2/sports/${sport.replace("/", "/leagues/")}/events/${e.id}/competitions/${e.id}/odds/100/propBets?limit=1000`;
      const first = await espn(core);
      const items: any[] = [...(first?.items ?? [])];
      for (let p = 2; p <= Math.min(Number(first?.pageCount) || 1, 5); p++)
        items.push(...((await espn(`${core}&page=${p}`))?.items ?? []));
      const lines = mainUpcoming(items, labels);
      if (!lines.length) return null;
      const people = new Map<string, { name: string; team: string }>();
      if (league === "nba") {
        for (const t of [away, home])
          for (const p of await fetchNbaRoster(String(t.id)).catch(() => []))
            people.set(p.id, { name: p.name, team: p.teamAbbr });
      } else {
        for (const t of [away, home])
          for (const p of await fetchTeamRoster(String(t.abbreviation)).catch(() => []))
            people.set(String(p.id), { name: p.name, team: String(t.abbreviation) });
      }
      const props: UpcomingPropRow[] = [];
      for (const l of lines) {
        const who = people.get(l.a);
        if (!who) continue;
        props.push([who.name, who.team, labels[l.t], l.line, l.o, l.u, l.open]);
      }
      props.sort(
        (x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]),
      );
      return {
        id: String(e.id),
        date: String(e.date),
        name: String(e.shortName ?? ""),
        away: { abbr: String(away.abbreviation ?? ""), name: String(away.displayName ?? "") },
        home: { abbr: String(home.abbreviation ?? ""), name: String(home.displayName ?? "") },
        props,
      } as UpcomingPropGame;
    }),
  );
  const value = games.filter((g): g is UpcomingPropGame => Boolean(g && g.props.length));
  value.sort((a, b) => a.date.localeCompare(b.date));
  memo.set(key, { at: Date.now(), value });
  return value;
}
