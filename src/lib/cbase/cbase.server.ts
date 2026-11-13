/**
 * Server-only college baseball data: the season files the "College baseball season" job publishes on the
 * props-site branch (cbase/index.json and cbase/season-<year>.json). Each file is about 1 MB, so pages get
 * trimmed views: the season without the full results list, one team with its games, one game.
 * Missing data stays missing: nothing is ever substituted.
 */
import type {
  CbaseLinedGame,
  CbaseResult,
  CbaseSeason,
  CbaseTeamPage,
  CbaseUpcoming,
} from "./cbase";

const FILES = "https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/cbase";
const TTL = 10 * 60_000;

type SeasonFile = Omit<CbaseSeason, "seasons"> & { games: CbaseResult[] };

const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = load().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${url}?t=${Math.floor(Date.now() / TTL)}`, {
    headers: { "User-Agent": "GamblingNFL/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`College baseball file failed [${res.status}] for ${url}`);
  return res.json() as Promise<T>;
}

const index = () =>
  cached("index", () => fetchJson<{ seasons: number[]; current: number }>(`${FILES}/index.json`));
const seasonFile = (y: number) =>
  cached(`season-${y}`, () => fetchJson<SeasonFile>(`${FILES}/season-${y}.json`));

async function resolve(season?: number) {
  const ix = await index();
  const y = season && ix.seasons.includes(season) ? season : ix.current;
  return { ix, y, file: await seasonFile(y) };
}

/** A season without its full results list (lined games, upcoming games, teams, record). */
export async function fetchCbaseSeason(season?: number): Promise<CbaseSeason> {
  const { ix, file } = await resolve(season);
  const { games: _games, ...rest } = file;
  return { ...rest, seasons: ix.seasons };
}

/** One team's season: every result, its lined games and upcoming games. */
export async function fetchCbaseTeam(key: string, season?: number): Promise<CbaseTeamPage | null> {
  const { ix, y, file } = await resolve(season);
  const team = file.teams[key];
  if (!team) return null;
  return {
    season: y,
    seasons: ix.seasons,
    key,
    team,
    teams: file.teams,
    results: file.games.filter((g) => g[2] === key || g[3] === key),
    lined: file.lined.filter((g) => g.home === key || g.away === key),
    upcoming: file.upcoming.filter((g) => g.home === key || g.away === key),
  };
}

export interface CbaseGamePage {
  season: number;
  teams: CbaseSeason["teams"];
  model: CbaseSeason["model"];
  lined?: CbaseLinedGame;
  upcoming?: CbaseUpcoming;
}

/** One game: an NCAA id (finished, with lines) or "e<ESPN id>" (upcoming). Looks in every season, newest first. */
export async function fetchCbaseGame(id: string): Promise<CbaseGamePage | null> {
  const ix = await index();
  for (const y of [...ix.seasons].reverse()) {
    const file = await seasonFile(y);
    const lined = file.lined.find((g) => g.id === id || `e${g.espn}` === id);
    const upcoming = lined ? undefined : file.upcoming.find((g) => `e${g.espn}` === id);
    if (lined || upcoming)
      return { season: y, teams: file.teams, model: file.model, lined, upcoming };
  }
  return null;
}
