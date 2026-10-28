/**
 * Server-only: football player props (DraftKings via ESPN's odds feed) and which players are
 * available for a game (NFL and college).
 *
 * (Split out of the old lib/espn.server.ts; the code is unchanged.)
 */

import type { GamePropBoard } from "@/lib/shared/props.types";
import { athleteIdOf, buildPropOffers, sampleTdItem, type PropPerson } from "@/lib/shared/props.parse";
import { isCollegeId } from "@/data/shared/teams";
import { CORE_ODDS, FEEDS, ROSTER_CACHE_TTL_MS, SUMMARY, cached, eventLeague, fetchJson, teamOf } from "@/lib/shared/espn-core.server";
import { fetchTeamDepthChart, fetchTeamRoster } from "@/lib/shared/espn-teams-players.server";
import { fetchSummaryFor } from "@/lib/cfb/cfb-espn.server";

/* ---------- player props (DraftKings via ESPN core odds feed) ---------- */

const PROP_PROVIDER_ID = 100; // DraftKings on ESPN's core odds feed

/** ESPN's prop feed rejects unfamiliar clients (403), so ask like a browser does. */
async function fetchPropsJson(url: string): Promise<any> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.espn.com/",
    Origin: "https://www.espn.com",
  };
  let lastStatus = 0;
  for (const candidate of [url, url.replace(/^https:/, "http:")]) {
    try {
      const res = await fetch(candidate, { headers });
      if (res.ok) return res.json();
      lastStatus = res.status;
    } catch {
      // try the next form of the URL
    }
  }
  throw new Error(`ESPN prop feed failed [${lastStatus || "network"}] for ${url}`);
}

/** Real prop lines and prices for one game, straight from ESPN's DraftKings prop feed. */
export async function fetchGameProps(
  eventId: string,
  awayAbbr: string,
  homeAbbr: string,
): Promise<GamePropBoard> {
  // Game ids in the app look like "espn-401872995" (college: "cfb-401…"); ESPN wants the number.
  const { league: propLeague, id: bareId } = eventLeague(eventId);
  eventId = bareId;
  const CORE_ODDS = FEEDS[propLeague].coreOdds;
  const coreLeague = propLeague === "cfb" ? "college-football" : "nfl";
  return cached(
    `props-${propLeague}-${eventId}`,
    async () => {
      const diagnostics: NonNullable<GamePropBoard["diagnostics"]> = {
        providersTried: [],
        itemCount: 0,
        sampleTypes: [],
      };

      // Pull every page of a provider's propBets. Items may be inline or $ref-only.
      const loadProvider = async (providerId: string): Promise<any[]> => {
        const base = `${CORE_ODDS}/${eventId}/competitions/${eventId}/odds/${providerId}/propBets`;
        const collected: any[] = [];
        const first = await fetchPropsJson(`${base}?limit=400&page=1`);
        collected.push(...(Array.isArray(first?.items) ? first.items : []));
        const pageCount = Math.min(Number(first?.pageCount) || 1, 10);
        for (let page = 2; page <= pageCount; page++) {
          const next = await fetchPropsJson(`${base}?limit=400&page=${page}`);
          collected.push(...(Array.isArray(next?.items) ? next.items : []));
        }
        // $ref-only items: resolve them (cached, so each prop is fetched once per minute).
        const needsResolve = collected.filter((x) => x && !x.type && typeof x.$ref === "string");
        if (needsResolve.length > 0) {
          const resolved = new Map<string, any>();
          const refs = needsResolve.map((x) => String(x.$ref)).slice(0, 900);
          for (let start = 0; start < refs.length; start += 20) {
            await Promise.all(
              refs.slice(start, start + 20).map(async (ref) => {
                try {
                  resolved.set(
                    ref,
                    await cached(`propref-${ref}`, () => fetchPropsJson(ref), 60_000),
                  );
                } catch {
                  // skip this prop
                }
              }),
            );
          }
          return collected
            .map((x) =>
              x && !x.type && typeof x.$ref === "string" ? resolved.get(String(x.$ref)) : x,
            )
            .filter(Boolean);
        }
        return collected;
      };

      // DraftKings (100) first; if that is empty, discover the providers ESPN lists for this game.
      let items: any[] = [];
      const providerIds: string[] = [String(PROP_PROVIDER_ID)];
      for (let i = 0; i < providerIds.length && items.length === 0 && i < 4; i++) {
        const id = providerIds[i];
        diagnostics.providersTried.push(id);
        try {
          items = await loadProvider(id);
        } catch (error) {
          diagnostics.error = error instanceof Error ? error.message : String(error);
        }
        if (i === 0 && items.length === 0) {
          try {
            const list = await fetchJson(`${CORE_ODDS}/${eventId}/competitions/${eventId}/odds`);
            for (const entry of Array.isArray(list?.items) ? list.items : []) {
              const pid = String(entry?.provider?.id ?? "");
              if (pid && !providerIds.includes(pid)) providerIds.push(pid);
            }
          } catch {
            // no provider list
          }
        }
      }
      diagnostics.itemCount = items.length;
      diagnostics.sampleTd = sampleTdItem(items);
      diagnostics.sampleTypes = [
        ...new Set(
          items.map((x) => String(x?.type?.name ?? x?.type?.displayName ?? x?.name ?? "?")),
        ),
      ].slice(0, 12);

      const [awayRoster, homeRoster] = await Promise.all([
        fetchTeamRoster(awayAbbr),
        fetchTeamRoster(homeAbbr),
      ]);
      const people = new Map<string, PropPerson>();
      for (const p of awayRoster)
        people.set(p.id, {
          name: p.name,
          position: p.position,
          headshot: p.headshot,
          team: awayAbbr,
        });
      for (const p of homeRoster)
        people.set(p.id, {
          name: p.name,
          position: p.position,
          headshot: p.headshot,
          team: homeAbbr,
        });

      // Athletes missing from the rosters (practice squad, new signings): look them up once.
      const missing = [
        ...new Set(
          items
            .map(athleteIdOf)
            .filter((id): id is string => Boolean(id) && !people.has(id as string)),
        ),
      ].slice(0, 150);
      await Promise.all(
        missing.map(async (id) => {
          try {
            const athlete = await cached(
              `athlete-${id}`,
              () =>
                fetchJson(
                  `https://sports.core.api.espn.com/v2/sports/football/leagues/${coreLeague}/athletes/${id}`,
                ),
              ROSTER_CACHE_TTL_MS,
            );
            if (athlete?.displayName) {
              people.set(id, {
                name: athlete.displayName,
                position: athlete?.position?.abbreviation ?? "",
                headshot: athlete?.headshot?.href,
                team: "",
              });
            }
          } catch {
            // leave the player out
          }
        }),
      );

      const offers = buildPropOffers(items, people);

      return {
        available: offers.length > 0,
        priced: offers.some((o) => o.overOdds || o.underOdds),
        offers,
        fetchedAt: Date.now(),
        diagnostics,
      };
    },
    15_000,
  );
}

/** Team-roster lookup so the browser can label prop athletes when it fetches ESPN directly. */
export async function fetchPropPeople(awayAbbr: string, homeAbbr: string) {
  const [awayRoster, homeRoster] = await Promise.all([
    fetchTeamRoster(awayAbbr),
    fetchTeamRoster(homeAbbr),
  ]);
  return [
    ...awayRoster.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      headshot: p.headshot,
      team: awayAbbr,
    })),
    ...homeRoster.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      headshot: p.headshot,
      team: homeAbbr,
    })),
  ];
}

/** One player's availability for a game: injury designation plus where the depth chart has him. */
export interface PropAvailabilityPlayer {
  id: string;
  teamAbbr: string;
  /** e.g. "Questionable", "Out", "Injured Reserve"; undefined when ESPN lists nothing. */
  injuryStatus?: string;
  /** Short injury detail, e.g. "Ankle". */
  injuryDetail?: string;
  /** 1 = first on the depth chart at his position; undefined when not on the chart. */
  depthRank?: number;
}

export interface PropAvailability {
  players: PropAvailabilityPlayer[];
  /** Which sources answered, so the page can say when the injury report or depth chart is missing. */
  sources: { injuryReport: boolean; depthChart: boolean };
}

/**
 * Who is expected to play: ESPN's game injury report (summary) and roster injury tags, plus the
 * offensive / special-teams depth chart order for each team.
 */
export async function fetchPropAvailability(
  eventId: string,
  awayAbbr: string,
  homeAbbr: string,
): Promise<PropAvailability> {
  // College team keys are ids ("cfb-194"); NFL ones are abbreviations.
  const keyOf = (k: string) => (isCollegeId(k) ? k : k.toUpperCase());
  const abbrs = [keyOf(awayAbbr), keyOf(homeAbbr)];
  const college = eventLeague(eventId).league === "cfb";
  const id = eventLeague(eventId).id;
  return cached(
    `prop-availability-${college ? "cfb-" : ""}${id}-${abbrs.join("-")}`,
    async () => {
      const [summary, rosters, charts] = await Promise.all([
        (college ? fetchSummaryFor(eventId) : fetchJson(`${SUMMARY}?event=${id}`)).catch(() => null),
        Promise.all(abbrs.map((abbr) => fetchTeamRoster(abbr))),
        Promise.all(abbrs.map((abbr) => fetchTeamDepthChart(abbr))),
      ]);

      const byId = new Map<string, PropAvailabilityPlayer>();
      const entry = (playerId: string, teamAbbr: string) => {
        const existing = byId.get(playerId);
        if (existing) return existing;
        const created: PropAvailabilityPlayer = { id: playerId, teamAbbr };
        byId.set(playerId, created);
        return created;
      };

      // Roster injury tags (season-long designations such as IR).
      abbrs.forEach((abbr, i) => {
        for (const p of rosters[i])
          if (p.injuryStatus) entry(p.id, abbr).injuryStatus = p.injuryStatus;
      });

      // The game's injury report is the most specific source, so it wins.
      let injuryReport = rosters.some((r) => r.some((p) => p.injuryStatus));
      for (const block of Array.isArray(summary?.injuries) ? summary.injuries : []) {
        const abbr = college
          ? String(teamOf(block?.team)?.id ?? "")
          : String(block?.team?.abbreviation ?? "").toUpperCase();
        if (!abbrs.includes(abbr)) continue;
        for (const injury of Array.isArray(block?.injuries) ? block.injuries : []) {
          const athleteId = injury?.athlete?.id;
          const status = injury?.status ?? injury?.type?.description;
          if (!athleteId || !status) continue;
          injuryReport = true;
          const e = entry(String(athleteId), abbr);
          e.injuryStatus = String(status);
          const detail = injury?.details?.type ?? injury?.details?.location;
          if (detail) e.injuryDetail = String(detail);
        }
      }

      // Depth chart order: lowest rank across every slot of the same position wins
      // (three WR slots each list their own starter at rank 1).
      let depthChart = false;
      abbrs.forEach((abbr, i) => {
        for (const slot of [...charts[i].offense, ...charts[i].specialTeams]) {
          for (const p of slot.players) {
            depthChart = true;
            const e = entry(p.id, abbr);
            const rank = Number.isFinite(p.rank) && p.rank > 0 ? p.rank : 99;
            e.depthRank = e.depthRank === undefined ? rank : Math.min(e.depthRank, rank);
          }
        }
      });

      // Quarterbacks: ESPN's depth chart can lag behind a starter returning from injury (it kept
      // listing the backup first after Caleb Williams came back). nflverse's projected starter for
      // this game wins when we can match him on the roster.
      try {
        if (college) throw new Error("nflverse covers the NFL only");
        const { fetchNflHistory } = await import("@/lib/nfl/nfl-history.server");
        const history = await fetchNflHistory();
        const eventNum = Number(id);
        const game =
          history.upcoming.find((g) => g.espnId === eventNum) ??
          history.games.find((g) => g.espnId === eventNum);
        if (game) {
          // abbrs is [away, home], the same order for finished and upcoming games.
          const projected: Record<string, string | null | undefined> = {
            [abbrs[0]]: game.awayQbName,
            [abbrs[1]]: game.homeQbName,
          };
          abbrs.forEach((abbr, i) => {
            const name = projected[abbr];
            if (!name) return;
            const match = rosters[i].find(
              (p) => normalizePosition(p.position) === "QB" && sameName(p.name, name),
            );
            if (match) entry(match.id, abbr).depthRank = 0;
          });
        }
      } catch {
        // Without nflverse the depth chart alone decides.
      }

      return { players: [...byId.values()], sources: { injuryReport, depthChart } };
    },
    10 * 60 * 1000,
  );
}

/** "Caleb Williams" vs "C.Williams" / "Caleb Williams Jr." — same person? */
function sameName(a: string, b: string): boolean {
  const clean = (n: string) =>
    n
      .toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
      .replace(/[^a-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const x = clean(a);
  const y = clean(b);
  if (!x.length || !y.length) return false;
  if (x.at(-1) !== y.at(-1)) return false; // last names must match
  return x[0][0] === y[0][0]; // and first initials
}

const normalizePosition = (pos: string) => String(pos ?? "").toUpperCase();
