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
  analytics surfaces live in `src/components/booth.tsx` so tables, panels, and
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

## Live data
- Game detail statistics visibility is defined in a browser-safe status helper so scheduled/live/final behavior can be tested without contacting ESPN.
- Games pages read the real 2026 NFL schedule/results from ESPN public feeds via src/lib/espn.server.ts (scoreboard + summary, 5-min module cache) exposed through src/lib/espn.functions.ts; sample data in src/data/games.ts is only a fallback when the feed is unreachable. Game ids from ESPN are prefixed `espn-`.
