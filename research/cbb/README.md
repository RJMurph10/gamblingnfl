# Men's college basketball research

Data: the `cbb-history` branch (built by `scripts/cbb/export-season.mjs` in `.github/workflows/cbb-history.yml`):
every Division I game of 2022-23 through 2025-26 with ESPN's closing line (DraftKings, else ESPN BET), about
6,250 games a season, 93% with a spread. Copy the files into `research/cbb/data/` to run the scripts.

- `model.py`: the ratings model (offense/defense, last season as a shrunk prior, 3-pt home court, none at
  neutral sites), walk-forward by day, graded against the close. `results_model.txt`.
- `sweep.py`: picks by size of disagreement with the line. `results_edges.txt`.
- `angles.py`: 62 simple angles (spread size, home/road/neutral, month, rest, streaks, totals bands...)
  season by season. `results_angles.txt` (★ = won all four seasons; none did).

Findings (November 2026):
- The model's average miss on the final margin was 9.4 points vs 8.9 for the closing spread, every season.
- ATS 50.0–51.3% and totals 48.9–49.7% per season; no edge size beat 52.4% every year.
- Adding the model to the closing spread in a regression: weight 0.30 in 2023-24, about 0 in 2024-25 and 2025-26.
- Closest angles: rested favorite (2+ days off) vs an underdog on 0–1 days rest 55.3% (459 games) but
  49.6% in 2025-26; totals ≤129.5 over 53.3% (1,230) but 43.7% in 2025-26.
- Next: test against opening lines once the line saver has a few weeks of 2026-27 openers.

`src/data/cbb/prior-ratings.ts` is 2025-26's fitted ratings (same fit), the 2026-27 starting point.
