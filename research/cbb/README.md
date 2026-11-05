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

## Model v2 (November 2026)

Data re-exported with **opening lines** (ESPN's core odds keep them per side; 2023-24 on) and **team box
scores** (possessions), for 2019-20 through 2025-26 (`scripts/cbb/export-season.mjs`).

- `model_v2.py`: possession-based adjusted efficiency (offense/defense per 100 possessions, tempo), last
  season as a 75% prior worth 5 games, 30-day half-life recency weights, 4 pts/100 home court, non-D-I
  games at 1/4 weight. Walk-forward by day.
- `v2_edges.py`: against openers and closers; regression weights; line-move correlation.
- `v2_totals.py` / `v2_totals_check.py`: the totals result, settings grid, edge sizes, over/under, month.

Findings:
- Spreads: 49–52% ATS at the close every season, at every edge size. No edge.
- Totals vs the **opening** total, model 6+ pts off: 55.8% (2023-24, 464), 55.7% (2024-25, 557),
  53.0% (2025-26, 685) → +73u on 1,706. Most settings in the grid were also positive at 6+.
- The same picks at the **closing** total: 50–52%. The model's total edge predicts the line move
  (corr ≈ 0.2), so the bet has to be made near the open.
- Site: `src/lib/cbb/cbb-model.ts` (ported; on 2025-26 with a 2024-25 prior it gives 368-324 ★, matching
  the research's 363-322).
