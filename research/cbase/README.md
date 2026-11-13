# College baseball research (Nov 2026)

1. `scripts/cbase/export-ncaa.mjs <year> out` (ESPN teams with logos: `scripts/cbase/espn-teams.mjs out`): every NCAA D-I game (data.ncaa.com JSON feed,
   GraphQL feed for 2026) → `cbase-history` branch `ncaa/<year>.jsonl.gz`, plus ESPN's team list.
2. ESPN lines: `lines-history` branch `college-baseball/<year>.jsonl.gz` (`scripts/lines/export-lines.mjs`).
3. `python research/cbase/build_games.py <data> <out>`: joins them (date ±1, runs, names) → `games.csv.gz`.
4. `python research/cbase/model.py <out>/games.csv.gz <out> 120 0.7 15 [--no-park]`: walk-forward run ratings.
5. `python research/cbase/evaluate.py <preds>` and `ml_sweep.py <preds>`: grading vs the lines.

Findings: project doc `cbase-research.md`.
