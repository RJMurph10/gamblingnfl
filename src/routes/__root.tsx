import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

const nav = [
  { to: "/", label: "Dashboard" },
  { to: "/teams", label: "Teams" },
  { to: "/players", label: "Players" },
  { to: "/games", label: "Games" },
  { to: "/props", label: "Props" },
] as const;

function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-40 rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-5">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <span className="size-3 rounded-[3px] bg-acc" />
          <span className="font-disp text-xl font-bold uppercase tracking-tight sm:text-2xl">
            Gambling<span className="text-acc">NFL</span>
          </span>
        </Link>
        <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-mute hover:text-ink"
              activeProps={{ className: "bg-acc/10 text-acc ring-1 ring-acc/25" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="hidden shrink-0 font-mono text-[11px] text-faint lg:block">
          WK 09 · SAMPLE FEED
        </span>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-line/10 px-4 py-5 sm:px-5">
      <p className="mx-auto max-w-[1400px] font-mono text-[10px] uppercase leading-relaxed tracking-wider text-faint">
        GamblingNFL · analytics prototype · all figures are sample/placeholder until real NFL data
        is imported
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
        <p className="mt-2 text-sm text-mute">
          That page doesn't exist or has been moved.
        </p>
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
        href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
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

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative z-10 flex min-h-screen flex-col font-body text-ink">
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
