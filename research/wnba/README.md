# WNBA research (November 2026)

## Data
- **Source:** the `wnba-history` branch, built by `scripts/wnba/export-season.mjs` (`.github/workflows/wnba-history.yml`).
- **Coverage:** 2018-2026, 2,235 games (regular season and playoffs). Closing spread and total on almost every game, plus team box scores.
- **Books:** Bet365 2018-19, DraftKings and Bet365 2020-23, ESPN BET 2024-25, DraftKings 2026.
- **Opening lines:** 2024-2026 only.
- **Expansion:** 2025 Golden State; 2026 Toronto and Portland (332 regular-season games).

## Model (`model.py`)
- Per-possession offense, defense and tempo, walk-forward by day (the CBB v2 method).
  - Prior: last season's ratings kept at 60%, worth 5 games. Expansion teams start 10 points per 100 possessions below average.
  - Home court: 4 points per 100 possessions. Half-life: 30 days.
- **Blend option:** 50/50 with market ratings fit to earlier closing lines (CBB v3), once both teams have 3+ games.

## Results
- **Accuracy:** the closing line beats the model every season (margin MAE 8.4–10.4 vs 8.9–10.8). The blend narrows the gap.
- **Against the close:** no edge. Spreads 51–53%, totals about 50%.
- **Totals against the OPENER (2024-2026):** the CBB pattern again. The model sees where the total will move.

| Rule | 2024 | 2025 | 2026 | Total |
|---|---|---|---|---|
| Efficiency only, 3+ off opener | 62-37 | 73-53 | 58-53 | 193-143 (57.4%) |
| Blend, 3+ off opener | 55-28 | 55-32 | 54-45 | 164-105 (61.0%) |
| Blend, 5+ off opener | 24-9 | 21-13 | 23-18 | 68-40 (63.0%) |

- **Spreads against the opener:** mixed (2024 below 50%, 2025-26 above). Not a ★.
- **Caveats:**
  - Only three seasons have openers.
  - Several edge sizes were tried. 2026 was the weakest season.
  - WNBA limits are low.
  - The ★ candidate (blended totals 3–5+ off the opener) should be re-checked once the 2027 lines come in.

## Ideas to sharpen totals (`totals_ideas.py`, November 2026)
Baseline (site model): total MAE 13.37 against a closing-line MAE of 13.17; ★ 164-105 (61.0%).

| Change | Total MAE | ★ (3+ off opener) |
|---|---|---|
| Back-to-back adjustment (+1.4 pts; those games beat the model by 1.8) | 13.36 | 165-108 (60.4%) |
| Opponents' 3PT% pulled 50% toward the league average | 13.36 | 178-122 (59.3%) |
| … 100% toward the league average | 13.37 | 187-134 (58.3%) |
| Half-life 15 / 45 days | 13.37 / 13.38 | 56.0% / 60.0% |
| Market blend 0.3 / 0.7 | 13.36 / 13.41 | 60.3% / 56.5% |
| Prior kept 40% / 80% | 13.37 / 13.38 | 61.3% / 60.3% |

- **Verdict:** none of these beats the baseline. The current settings sit at the best point. Every variant still hit 56–61%, so the edge doesn't hang on one setting.
- **Where real gains would come from:** information box scores don't have, and timing.
  - Injury and lineup news. The opener often lacks it, so the model would need it too.
  - Betting at the opener before it moves.
  - A bigger edge for fewer bets: 5+ points went 68-40 (63%).
