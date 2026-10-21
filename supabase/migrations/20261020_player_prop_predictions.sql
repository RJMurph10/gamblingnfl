-- Saved player prop predictions (central projection + projected range) with after-game evaluation.
--
-- Predictions are written ONCE before kickoff and then locked: a trigger rejects any change to the
-- prediction columns, so reported accuracy can never be improved by editing history. Only the
-- evaluation columns (actual, abs_error, in_range, evaluated_at) may be filled in after the game.

create table if not exists public.player_prop_predictions (
  id            bigserial primary key,
  game_id       text not null,                 -- site game id, e.g. 'espn-401873010'
  player_id     text not null,                 -- ESPN athlete id (same ids the site's rosters use)
  player_name   text,
  team_abbr     text,
  position      text,
  stat          text not null,                 -- key from src/lib/prop-model.ts, e.g. 'rush_yds'
  projected     numeric(7,2) not null check (projected >= 0),
  lower_bound   numeric(7,2) not null check (lower_bound >= 0),
  upper_bound   numeric(7,2) not null,
  range_method  text not null,                 -- e.g. 'pct25-v1'
  model_version text not null,
  created_at    timestamptz not null default now(),
  -- evaluation, filled after the game:
  actual        numeric(7,2),
  abs_error     numeric(7,2),
  in_range      boolean,
  evaluated_at  timestamptz,
  check (lower_bound <= projected and projected <= upper_bound),
  unique (game_id, player_id, stat, model_version)
);

create index if not exists player_prop_predictions_game_idx on public.player_prop_predictions(game_id);
create index if not exists player_prop_predictions_player_idx on public.player_prop_predictions(player_id);

create or replace function public.lock_player_prop_prediction()
returns trigger language plpgsql as $$
begin
  if new.game_id is distinct from old.game_id
     or new.player_id is distinct from old.player_id
     or new.stat is distinct from old.stat
     or new.projected is distinct from old.projected
     or new.lower_bound is distinct from old.lower_bound
     or new.upper_bound is distinct from old.upper_bound
     or new.range_method is distinct from old.range_method
     or new.model_version is distinct from old.model_version
     or new.created_at is distinct from old.created_at then
    raise exception 'Saved predictions are locked; only evaluation columns may be updated.';
  end if;
  return new;
end $$;

drop trigger if exists player_prop_predictions_lock on public.player_prop_predictions;
create trigger player_prop_predictions_lock
  before update on public.player_prop_predictions
  for each row execute function public.lock_player_prop_prediction();

grant select on public.player_prop_predictions to anon, authenticated;
grant all on public.player_prop_predictions to service_role;
grant usage, select on all sequences in schema public to service_role;
alter table public.player_prop_predictions enable row level security;
drop policy if exists player_prop_predictions_public_read on public.player_prop_predictions;
create policy player_prop_predictions_public_read on public.player_prop_predictions
  for select to anon, authenticated using (true);
