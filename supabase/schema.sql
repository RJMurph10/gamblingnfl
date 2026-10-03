-- GamblingNFL — database schema for your own Supabase project ("gamblingnfl").
--
-- Run this in the Supabase SQL editor of your project. It creates NO sample
-- rows: the site ships with placeholder data in src/data/* until you import
-- real NFL data yourself.
--
-- Design goals:
--   1. Hold tens of millions of play-by-play rows without degrading page reads.
--   2. Keep raw plays separate from derived/aggregated stats, so Python models
--      can recompute aggregates without touching the raw import.
--   3. Make every table the UI reads cheap and indexed.

-- ---------------------------------------------------------------- reference

create table if not exists public.teams (
  id            text primary key,          -- slug, e.g. 'chiefs'
  abbr          text not null unique,      -- 'KC'
  city          text not null,
  name          text not null,
  conference    text not null check (conference in ('AFC','NFC')),
  division      text not null check (division in ('East','North','South','West')),
  primary_color text,
  logo_url      text
);

create table if not exists public.players (
  id          text primary key,            -- your own or a feed's player id (e.g. gsis_id)
  first_name  text not null,
  last_name   text not null,
  position    text,
  team_id     text references public.teams(id) on delete set null,
  jersey      smallint,
  birth_date  date,
  height_in   smallint,
  weight_lb   smallint
);
create index if not exists players_team_idx on public.players(team_id);
create index if not exists players_name_idx on public.players(lower(last_name), lower(first_name));

create table if not exists public.games (
  id            text primary key,          -- e.g. '2025_09_KC_BUF'
  season        smallint not null,
  week          smallint not null,
  season_type   text not null default 'REG',
  kickoff_at    timestamptz,
  status        text not null default 'scheduled',
  venue         text,
  away_team_id  text not null references public.teams(id),
  home_team_id  text not null references public.teams(id),
  away_score    smallint,
  home_score    smallint,
  spread        numeric(4,1),
  total         numeric(4,1)
);
create index if not exists games_season_week_idx on public.games(season, week);
create index if not exists games_team_idx on public.games(home_team_id, away_team_id);

-- ------------------------------------------------- raw play-by-play (bulk)

-- Partitioned by season so each year's bulk import/COPY stays independent and
-- queries that filter by season only scan one partition.
create table if not exists public.plays (
  game_id        text not null,
  season         smallint not null,
  play_id        bigint not null,
  quarter        smallint,
  game_seconds   integer,
  drive_number   smallint,
  posteam_id     text,
  defteam_id     text,
  down           smallint,
  ydstogo        smallint,
  yardline_100   smallint,
  play_type      text,
  yards_gained   smallint,
  epa            numeric(8,4),
  wpa            numeric(8,4),
  passer_id      text,
  rusher_id      text,
  receiver_id    text,
  description    text,
  raw            jsonb,                    -- keep the untouched source row
  primary key (season, game_id, play_id)
) partition by list (season);

-- Create one partition per imported season, e.g.:
-- create table if not exists public.plays_2024 partition of public.plays for values in (2024);
-- create table if not exists public.plays_2025 partition of public.plays for values in (2025);

create index if not exists plays_game_idx on public.plays(game_id);
create index if not exists plays_posteam_idx on public.plays(posteam_id, season);

create table if not exists public.drives (
  game_id       text not null references public.games(id) on delete cascade,
  drive_number  smallint not null,
  team_id       text references public.teams(id),
  quarter       smallint,
  plays         smallint,
  yards         smallint,
  time_of_possession interval,
  start_yardline text,
  result        text,
  primary key (game_id, drive_number)
);

create table if not exists public.game_quarter_scores (
  game_id  text not null references public.games(id) on delete cascade,
  team_id  text not null references public.teams(id),
  quarter  smallint not null,
  points   smallint not null default 0,
  primary key (game_id, team_id, quarter)
);

-- --------------------------------------------- derived stats (model output)

create table if not exists public.team_game_stats (
  game_id   text not null references public.games(id) on delete cascade,
  team_id   text not null references public.teams(id),
  total_yards integer, pass_yards integer, rush_yards integer,
  first_downs smallint, third_down_pct numeric(5,2),
  turnovers smallint, penalties smallint,
  time_of_possession interval,
  primary key (game_id, team_id)
);

create table if not exists public.player_game_stats (
  game_id   text not null references public.games(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  team_id   text references public.teams(id),
  stats     jsonb not null default '{}'::jsonb,  -- position-specific stat line
  primary key (game_id, player_id)
);
create index if not exists player_game_stats_player_idx on public.player_game_stats(player_id);

create table if not exists public.team_season_stats (
  season  smallint not null,
  team_id text not null references public.teams(id),
  wins smallint, losses smallint, ties smallint,
  points_for integer, points_against integer,
  metrics jsonb not null default '{}'::jsonb,     -- your model metrics
  primary key (season, team_id)
);

create table if not exists public.player_prop_projections (
  id          bigserial primary key,
  game_id     text references public.games(id) on delete cascade,
  player_id   text references public.players(id) on delete cascade,
  market      text not null,                      -- 'Pass yards', 'Rec yards', ...
  line        numeric(6,2),
  projection  numeric(6,2) not null,
  model_version text not null default 'v0',
  created_at  timestamptz not null default now()
);
create index if not exists prop_proj_game_idx on public.player_prop_projections(game_id);
create index if not exists prop_proj_player_idx on public.player_prop_projections(player_id);

create table if not exists public.game_predictions (
  id          bigserial primary key,
  game_id     text references public.games(id) on delete cascade,
  predicted_spread numeric(5,2),
  predicted_total  numeric(5,2),
  home_win_prob    numeric(5,4),
  model_version text not null default 'v0',
  created_at  timestamptz not null default now()
);
create index if not exists game_pred_game_idx on public.game_predictions(game_id);

-- ---------------------------------------------------------- grants + RLS
-- PostgREST does not grant privileges on `public` by default. This is a
-- personal, read-only-public research site: anon may read, only the service
-- role (your Python importer / server code) may write.

do $$
declare t text;
begin
  foreach t in array array[
    'teams','players','games','plays','drives','game_quarter_scores',
    'team_game_stats','player_game_stats','team_season_stats',
    'player_prop_projections','game_predictions'
  ]
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy if not exists %I on public.%I for select to anon, authenticated using (true)',
      t || '_public_read', t
    );
  end loop;
end $$;

grant usage, select on all sequences in schema public to service_role;
