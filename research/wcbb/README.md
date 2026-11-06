# Women's college basketball research (November 2026)

## Data
- **Source:** the `wcbb-history` branch, from `scripts/wcbb/export-season.mjs` (`.github/workflows/wcbb-history.yml`).
- **Coverage:** 2021-22 to 2025-26, about 5,500–6,000 D-I games a season, nearly all with box scores.
- **Lines on ESPN:** 2021-22 1,276 closing totals; 2022-23 4,862; 2023-24 3,049 (with openers); 2024-25 1,206; 2025-26 918. Openers start in 2023-24.

## Model (`model.py`)
The men's model (research/cbb/model_v2.py + v3_market.py), unchanged, run on women's games.

## Results
- **Accuracy at the close:** total MAE about equal to the closing line (12.5–13.0 vs 12.3–13.1). The margin is worse than the line.
- **Blended totals against the CLOSE:** about 52% (break-even 52.4%).
- **Blended totals against the OPENER (2023-24 / 2024-25 / 2025-26):**

| Edge | 2023-24 | 2024-25 | 2025-26 | Total |
|---|---|---|---|---|
| 2+ | 525-465 | 351-288 | 256-208 | 1132-961 (54.1%, +68u) |
| 3+ | 293-232 | 274-198 | 182-143 | 749-573 (56.7%, +108u) |
| 4+ (★) | 163-127 | 209-139 | 128-95 | 500-361 (58.1%, +94u) |
| 6+ | 55-36 | 109-73 | 55-42 | 219-151 (59.2%, +48u) |
| 8+ | 20-13 | 72-34 | 23-23 | 115-70 (62.2%, +35u) |

- **Spreads 4+ off the opener:** 55.3%, 47.9%, 53.5%. Not every season, so not a ★.
- **On the site (PR "Women's college basketball"):**
  - ★ = blended totals 4+ off the opener.
  - Totals card = 2+ off the opener, graded there.
  - Starting ratings from 2025-26 in `src/data/wcbb/prior-ratings.ts`.
