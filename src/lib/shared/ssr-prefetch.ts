/**
 * Sends each league's games inside the page itself, so they show the moment the page arrives
 * (no waiting for the site's code to start and then ask the server).
 *
 * How it works: on the server only, the root route's loader fetches the schedule the page needs
 * (finished games come from the long-term cache, so this is usually quick) and puts it in the query
 * cache. router.tsx then ships that cache inside the page, and the browser starts with it.
 *
 * The server waits at most SSR_BUDGET_MS. If ESPN is slow, the page is sent without games and loads
 * them the normal way (saved copy from the last visit first, then the server), so nothing gets slower.
 * In-app navigation (clicking between pages) never waits on this.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getLiveSchedule } from "./espn.functions";
import { getCfbSchedule } from "../cfb/cfb.functions";
import { getNbaSchedule } from "../nba/nba.functions";
import { getNhlSchedule } from "../nhl/nhl.functions";

const SSR_BUDGET_MS = 1_000;

/** The query keys whose data may travel inside the page (router.tsx). */
export const SSR_QUERY_KEYS = new Set(["live-schedule", "cfb-schedule", "nba-schedule", "nhl-schedule"]);

interface Prefetch {
  queryKey: QueryKey;
  load: () => Promise<unknown>;
}

/** Which schedule a page shows: its league's (nearly every page uses it, often through shared parts). */
export function prefetchesFor(pathname: string): Prefetch[] {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/nhl/odds-export")) return [];
  if (/^\/nhl(\/|$)/.test(path)) return [{ queryKey: ["nhl-schedule"], load: () => getNhlSchedule() }];
  if (/^\/nba(\/|$)/.test(path)) return [{ queryKey: ["nba-schedule"], load: () => getNbaSchedule() }];
  if (/^\/cfb(\/|$)/.test(path)) return [{ queryKey: ["cfb-schedule"], load: () => getCfbSchedule() }];
  return [{ queryKey: ["live-schedule"], load: () => getLiveSchedule() }];
}

const TZ_COOKIE = "gnfl_tz";

/**
 * Browser: stores the visitor's time zone in a cookie so the server can draw times the same way
 * (lib/shared/ssr-timezone.ts). Until it's set (the very first visit), pages load the normal way.
 */
export function rememberTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || document.cookie.includes(`${TZ_COOKIE}=${encodeURIComponent(tz)}`)) return;
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // no cookies: pages just load the normal way
  }
}

/** Server only: loads the page's schedule into the query cache, giving up after SSR_BUDGET_MS. */
export async function prefetchForSsr(queryClient: QueryClient, pathname: string): Promise<void> {
  if (typeof window !== "undefined") return;
  // Only when the visitor's time zone is known; otherwise the server would draw the wrong times.
  const visitorTimeZone = (globalThis as any).__gnflSsrTimeZone?.();
  if (!visitorTimeZone) return;
  await Promise.all(
    prefetchesFor(pathname).map(async ({ queryKey, load }) => {
      if (queryClient.getQueryData(queryKey) !== undefined) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), SSR_BUDGET_MS);
      });
      try {
        const data = await Promise.race([load().catch(() => undefined), timeout]);
        if (data !== undefined) queryClient.setQueryData(queryKey, data);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
