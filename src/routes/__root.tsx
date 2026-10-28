import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useQueryPersistence } from "@/lib/shared/query-persist";
import { prefetchForSsr, rememberTimeZone } from "@/lib/shared/ssr-prefetch";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { LEAGUES, leagueFromPath, switchLeaguePath, type League } from "../lib/shared/leagues";

const nflNav = [
  { to: "/", label: "Dashboard" },
  { to: "/teams", label: "Teams" },
  { to: "/players", label: "Players" },
  { to: "/games", label: "Games" },
  { to: "/props", label: "Props" },
  { to: "/model", label: "Model" },
] as const;

const nbaNav = [
  { to: "/nba", label: "Dashboard" },
  { to: "/nba/teams", label: "Teams" },
  { to: "/nba/players", label: "Players" },
  { to: "/nba/games", label: "Games" },
  { to: "/nba/props", label: "Props" },
  { to: "/nba/model", label: "Model" },
] as const;

const nhlNav = [
  { to: "/nhl", label: "Dashboard" },
  { to: "/nhl/teams", label: "Teams" },
  { to: "/nhl/players", label: "Players" },
  { to: "/nhl/games", label: "Games" },
  { to: "/nhl/props", label: "Props" },
  { to: "/nhl/model", label: "Model" },
] as const;

const cfbNav = [
  { to: "/cfb", label: "Dashboard" },
  { to: "/cfb/teams", label: "Teams" },
  { to: "/cfb/players", label: "Players" },
  { to: "/cfb/games", label: "Games" },
  { to: "/cfb/props", label: "Props" },
  { to: "/cfb/model", label: "Model" },
] as const;

/** League accent colors for the menu (each league's own token). */
const LEAGUE_DOT: Record<string, string> = {
  nfl: "var(--acc-nfl)",
  cfb: "var(--acc-cfb)",
  nba: "var(--acc-nba)",
  nhl: "var(--acc-nhl)",
};

function Logo({ league }: { league: League }) {
  return (
    <span className="font-disp text-xl font-bold uppercase tracking-tight sm:text-2xl">
      Gambling<span className="text-acc">{league.short}</span>
    </span>
  );
}

/** The logo opens a menu of leagues; picking one opens the matching page in that league. */
function LeagueMenu({ league, pathname }: { league: League; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch league"
        className="flex items-center gap-2 rounded-lg outline-none ring-acc/40 focus-visible:ring-2"
      >
        <span className="size-3 rounded-[3px] bg-acc" />
        <Logo league={league} />
        <span className="hidden items-center gap-1 rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-mute ring-1 ring-line/15 sm:inline-flex">
          ▾ Leagues
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-72 rounded-xl border border-line/15 bg-panel p-1.5 shadow-xl"
        >
          {LEAGUES.map((l) =>
            l.live ? (
              <Link
                key={l.id}
                role="menuitem"
                // Paths are built from the league list, so they aren't typed route literals.
                to={switchLeaguePath(pathname, l) as "/"}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-line/5 ${
                  l.id === league.id ? "bg-line/5" : ""
                }`}
              >
                <span className="size-2.5 rounded-[3px]" style={{ background: LEAGUE_DOT[l.id] }} />
                <span className="font-disp text-lg font-bold uppercase tracking-tight">
                  Gambling<span style={{ color: LEAGUE_DOT[l.id] }}>{l.short}</span>
                </span>
                <span className="ml-auto font-mono text-[10px] text-faint">
                  {l.id === league.id ? "current" : l.prefix}
                </span>
              </Link>
            ) : (
              <div
                key={l.id}
                role="menuitem"
                aria-disabled
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 opacity-45"
              >
                <span className="size-2.5 rounded-[3px] bg-faint" />
                <span className="font-disp text-lg font-bold uppercase tracking-tight">
                  Gambling{l.short}
                </span>
                <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-faint">
                  coming soon
                </span>
              </div>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function SiteHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const league = leagueFromPath(pathname);
  const nav =
    league.id === "cfb" ? cfbNav : league.id === "nba" ? nbaNav : league.id === "nhl" ? nhlNav : nflNav;
  return (
    <header className="glass sticky top-0 z-40 rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-5">
        <LeagueMenu league={league} pathname={pathname} />
        <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" || item.to === "/cfb" || item.to === "/nba" }}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-mute hover:text-ink"
              activeProps={{ className: "bg-acc/10 text-acc ring-1 ring-acc/25" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const league = leagueFromPath(pathname);
  return (
    <footer className="mt-10 border-t border-line/10 px-4 py-5 sm:px-5">
      <p className="mx-auto max-w-[1400px] font-mono text-[10px] uppercase leading-relaxed tracking-wider text-faint">
        Gambling{league.short} · {league.name} analytics & betting research · live data from ESPN
        {league.id === "nba" || league.id === "nhl" ? "" : " and nflverse"} · for research, not betting advice
      </p>
    </footer>
  );
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-disp text-7xl font-bold text-acc">404</h1>
        <h2 className="mt-2 font-disp text-2xl font-semibold uppercase tracking-tight">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-mute">That page doesn't exist or has been moved.</p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-lg bg-acc/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-acc ring-1 ring-acc/25"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-disp text-2xl font-semibold uppercase tracking-tight">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-mute">Try again, or head back to the dashboard.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-lg bg-acc/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-acc ring-1 ring-acc/25"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-lg bg-panel2 px-4 py-2 font-mono text-xs uppercase tracking-wider text-mute ring-1 ring-line/10"
          >
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // On the server, load the page's games so they arrive inside the page (lib/shared/ssr-prefetch.ts).
  // In the browser this returns at once, so clicking between pages never waits on it.
  loader: ({ context, location }) => prefetchForSsr(context.queryClient, location.pathname),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "GamblingNFL — NFL analytics & betting research" },
      {
        name: "description",
        content:
          "Personal NFL statistics, analytics, and betting research platform: team and player stats, quarter-by-quarter and drive-by-drive game detail, and prop projections.",
      },
      { property: "og:title", content: "GamblingNFL — NFL analytics & betting research" },
      {
        property: "og:description",
        content:
          "Team, player, and game-level NFL analytics with drive charts and player prop projections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Saved schedules from the last visit show instantly, then refresh (see lib/shared/query-persist.ts). */
function QueryPersistence({ client }: { client: QueryClient }) {
  useQueryPersistence(client);
  useEffect(() => rememberTimeZone(), []);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <QueryClientProvider client={queryClient}>
      <QueryPersistence client={queryClient} />
      <div
        data-league={leagueFromPath(pathname).id}
        className="relative z-10 flex min-h-screen flex-col font-body text-ink"
      >
        <SiteHeader />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-5">
          {/* Required: nested routes render here. */}
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </QueryClientProvider>
  );
}
