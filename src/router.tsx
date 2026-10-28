import { QueryClient, dehydrate, hydrate, type DehydratedState } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { SSR_QUERY_KEYS } from "./lib/shared/ssr-prefetch";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // The schedule the server loaded for this page travels inside the page (see lib/shared/ssr-prefetch.ts),
    // so the browser shows the games immediately instead of asking the server again.
    dehydrate: () =>
      ({
        queries: dehydrate(queryClient, {
          shouldDehydrateQuery: (q) =>
            q.state.status === "success" && typeof q.queryKey[0] === "string" && SSR_QUERY_KEYS.has(q.queryKey[0]),
        }),
      }) as any,
    hydrate: (dehydrated: any) => {
      const state = dehydrated?.queries as DehydratedState | undefined;
      if (state) hydrate(queryClient, state);
    },
  });

  return router;
};
