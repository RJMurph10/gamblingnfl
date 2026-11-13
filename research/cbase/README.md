# College baseball research (Nov 2026)

1. `scripts/cbase/export-ncaa.mjs <year> out` (ESPN teams with logos: `scripts/cbase/espn-teams.mjs out`): every NCAA D-I game (data.ncaa.com JSON feed,
   GraphQL feed for 2026) → `cbase-history` branch `ncaa/<year>.jsonl.gz`, plus ESPN's team list.
2. ESPN lines: `lines-history` branch `college-baseball/<year>.jsonl.gz` (`scripts/lines/export-lines.mjs`).
3. `python research/cbase/build_games.py <data> <out>`: joins them (date ±1, runs, names) → `games.csv.gz`.
4. `python research/cbase/model.py <out>/games.csv.gz <out> 120 0.7 15 [--no-park]`: walk-forward run ratings.
5. `python research/cbase/evaluate.py <preds>` and `ml_sweep.py <preds>`: grading vs the lines.

Findings: project doc `cbase-research.md`.

## Model v2 (starting pitchers, weather, altitude, travel)

6. Data on `cbase-history`: `box/<year>.jsonl.gz` (`scripts/cbase/export-box.mjs`: NCAA gamecenter box
   scores, GraphQL `NCAA_GetGamecenterBoxscoreBaseballById_web`, pitchers with position and starter flag;
   2023+, 2022 has no pitcher lines), `env/venues.json` (`venues.mjs`: ESPN men's basketball venue city →
   Open-Meteo geocoder) and `env/weather-<year>.json` (`weather-history.mjs`: Open-Meteo archive, 10:00–22:00).
7. `python research/cbase/build_games.py` also writes `team_map.json` (NCAA team → ESPN id) and ESPN start times.
8. `python research/cbase/features.py <preds> <games> <team_map.json> <box dir> <env dir> <out>`: features and
   the walk-forward second stage → `preds_v2_<set>.csv.gz`.
9. `python research/cbase/compare.py <preds...>`: totals / moneyline / run line vs the opening lines, 2024–26.

Production: `scripts/cbase/cbase_context.py` (coefficients from the 2022–25 fit), used by `build_season.py`.
