# GamblingNFL — Python data & model layer

This folder is where your NFL data import and statistical models live. The
website never computes models itself: it only reads tables that this layer
writes.

```
raw play-by-play  ──►  public.plays (partitioned by season)
                        │
                        ├─► public.drives, public.game_quarter_scores
                        ├─► public.team_game_stats, public.player_game_stats
                        └─► public.player_prop_projections, public.game_predictions
                                       │
                                       └─► website reads these tables
```

## 1. Create the schema

Run `supabase/schema.sql` in the SQL editor of your Supabase project
(`gamblingnfl`). It creates no rows — the site shows placeholder data until you
import real data.

Then add a partition for each season you import:

```sql
create table if not exists public.plays_2025 partition of public.plays for values in (2025);
```

## 2. Bulk import play-by-play

Use a direct Postgres connection (Project Settings → Database → Connection
string), **not** the REST API — `COPY` is orders of magnitude faster than row
inserts for millions of plays.

```python
import io, os, psycopg
import nfl_data_py as nfl  # or your own source

SEASON = 2025
df = nfl.import_pbp_data([SEASON])

cols = ["game_id","season","play_id","quarter","game_seconds","drive_number",
        "posteam_id","defteam_id","down","ydstogo","yardline_100","play_type",
        "yards_gained","epa","wpa","passer_id","rusher_id","receiver_id","description"]

buf = io.StringIO()
df.reindex(columns=cols).to_csv(buf, index=False, header=False)
buf.seek(0)

with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn, conn.cursor() as cur:
    with cur.copy(f"copy public.plays ({','.join(cols)}) from stdin with (format csv)") as cp:
        cp.write(buf.read())
    conn.commit()
```

Tips for large loads: import one season at a time, drop non-primary indexes
before a very large `COPY` and recreate them after, and keep the untouched
source row in `plays.raw` if you want to re-derive stats later.

## 3. Compute your own statistics

Aggregate from `plays` into the derived tables, then upsert:

```python
import pandas as pd

team_game = (plays.groupby(["game_id","posteam_id"])
                  .agg(total_yards=("yards_gained","sum"),
                       plays=("play_id","count"))
                  .reset_index())
# upsert into public.team_game_stats via execute_values / COPY into a temp table
```

Keep every derived number in these tables — the site reads them directly, so a
model re-run is all it takes to update the UI.

## 4. Publish projections

Write prop projections to `player_prop_projections` and game-level model output
to `game_predictions`, tagging each row with a `model_version` so you can
compare model generations and backtest.

## 5. Point the site at real data

The site currently imports sample data from `src/data/teams.ts`,
`src/data/players.ts`, and `src/data/games.ts`. Each module exposes small
accessor functions (`teamById`, `playerById`, `gameById`, …). Replacing those
accessors with Supabase reads is the only frontend change needed — no page or
component has to be rewritten.

## Environment

Keep credentials out of the repo:

```
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # write access, never in frontend
```

Suggested deps: `pandas`, `psycopg[binary]`, `nfl_data_py` (or your own
source), `scikit-learn` / `statsmodels` for modelling.
