/**
 * Server only (imported by src/server.ts). Makes the server draw dates and times in the visitor's own
 * time zone, so a page that arrives with its games already drawn shows the same times the browser would.
 *
 * The browser stores its time zone in a cookie (see rememberTimeZone in ssr-prefetch.ts). For each
 * request, date formatting that doesn't name a time zone (toLocaleString / toLocaleDateString /
 * toLocaleTimeString and Intl.DateTimeFormat) uses that zone instead of the server's (UTC).
 * Requests without the cookie are untouched.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const TZ_COOKIE = "gnfl_tz";

const store = new AsyncLocalStorage<string>();
let installed = false;

function validTimeZone(tz: string | undefined): string | undefined {
  if (!tz || tz.length > 64) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** The visitor's time zone from the request's cookie, if it's a real one. */
export function timeZoneFromRequest(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${TZ_COOKIE}=([^;]+)`).exec(cookie);
  if (!match) return undefined;
  try {
    return validTimeZone(decodeURIComponent(match[1]));
  } catch {
    return undefined;
  }
}

function withZone(options: any): any {
  const tz = store.getStore();
  if (!tz) return options;
  if (options && typeof options === "object" && options.timeZone) return options;
  return { ...(options ?? {}), timeZone: tz };
}

function install() {
  if (installed) return;
  installed = true;
  for (const method of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"] as const) {
    const original = Date.prototype[method] as (this: Date, locales?: any, options?: any) => string;
    (Date.prototype as any)[method] = function (this: Date, locales?: any, options?: any) {
      return original.call(this, locales, withZone(options));
    };
  }
  const Original = Intl.DateTimeFormat;
  const Patched = function (locales?: any, options?: any) {
    return new Original(locales, withZone(options));
  } as any;
  Patched.prototype = Original.prototype;
  Patched.supportedLocalesOf = Original.supportedLocalesOf.bind(Original);
  (Intl as any).DateTimeFormat = Patched;
  // Lets the shared page code ask whether this request knows the visitor's time zone (ssr-prefetch.ts).
  (globalThis as any).__gnflSsrTimeZone = () => store.getStore();
}

/** Runs one request with the visitor's time zone in effect (when known). */
export function runWithVisitorTimeZone<T>(request: Request, fn: () => T): T {
  install();
  const tz = timeZoneFromRequest(request);
  return tz ? store.run(tz, fn) : fn();
}
