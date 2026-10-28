<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules

- Pages live in `src/routes/` (flat dot-naming); shared UI primitives for the
  analytics surfaces live in `src/components/shared/booth.tsx` so tables, panels, and
  stat widgets stay visually consistent.
- All displayed data flows through accessor functions in `src/data/*.ts`
  (placeholder sample data today) so the backend can be swapped in one place
  without touching pages.
- Statistical computation belongs to the Python layer documented in
  `python/README.md`; the site only reads precomputed/derived tables.
- The database schema is maintained as plain SQL in `supabase/schema.sql` and
  applied to the user's own Supabase project; the site never seeds data.
- Colors, fonts, and effects are tokens/utilities in `src/styles.css`; never
  hardcode color utilities in components (team brand colors are data-driven).

## Folder layout (by league)

Code is grouped by league so each sport is easy to find and new leagues slot in the same way:

- `src/lib/<league>/`, `src/components/<league>/`, `src/data/<league>/` with league folders
  `nfl`, `cfb`, `nba`, `nhl` (add e.g. `cbb` for college basketball the same way).
- A file used by only one league goes in that league's folder. A file used by two or more
  leagues (NFL and college football share the game, team, player and model pages) goes in the
  `shared/` folder next to them.
- Stay at the top level on purpose: `src/lib/utils.ts` and `src/hooks/` (shadcn/ui expects
  them there), `src/lib/error-capture.ts`, `src/lib/error-page.ts` and
  `src/lib/lovable-error-reporting.ts` (Lovable plumbing), `src/components/ui/` (shadcn).
- `src/routes/` stays flat: route file names are the page URLs.

## Live data
- Game detail statistics visibility is defined in a browser-safe status helper so scheduled/live/final behavior can be tested without contacting ESPN.
- Games pages read the real 2026 NFL schedule/results from ESPN public feeds via src/lib/nfl/nfl-schedule.server.ts and the shared ESPN football files in src/lib/shared/espn-*.server.ts (scoreboard + summary, module cache) exposed through src/lib/shared/espn.functions.ts; sample data in src/data/shared/games.ts is only a fallback when the feed is unreachable. Game ids from ESPN are prefixed `espn-`.
