# MLB research (2010–2025)

Scripts and results behind the /mlb Model page. Data is not committed; it is rebuilt from free sources:

- Retrosheet game logs and event files 2010–2025 (Chadwick Bureau mirror: https://github.com/chadwickbureau/retrosheet), parsed by `parse_events.py` (plate appearances) and `parse_info.py` (weather, umpire).
- Closing lines: SportsbookReviewsOnline 2010–2021 via https://github.com/ethanbell528-cmd/fda-project-1 (`data/mlb.csv`), and 2022–2025 via https://github.com/tanhungle/mlb-reference-data (`odds_flat.csv`; DraftKings, else FanDuel — the other books there carry placeholder prices).

Run in order: `parse_events.py`, `parse_info.py`, `build_games.py`, `model.py`, `evaluate.py`, `angle_lab.py`, `props.py`.

Results: `results_model.txt` (model vs closing line), `results_angles.txt` (angle lab), `results_props.txt` (strikeout and batter projections).

The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org.

## Angle lab, round 2 (`scripts/angle_lab2.py` → `results_angles2.txt`)

28 more angles, same rule (profitable at closing prices in both the discovery and confirmation years):
bullpen workload over the previous 3 days, day game after night game, rest days, refined model unders,
run-line spots (2022–25, the only years with run-line prices), and line movement from open to close
(2021–25, the only years with opening lines).

Result: 1 of 28 passed both halves (`Model total ≤ line −1.25 → under`, +3.4% then +0.3%, p = 0.39),
fewer than the ~7 that would pass by luck alone. Nothing new is a best bet; Wrigley wind-out overs
stay the only one.

Lesson: an early version of the run-line grader "fixed" prices by assuming −1.5 always pays more than
+1.5. That's false for heavy favorites (ML −250: −1.5 ≈ −125, +1.5 ≈ +100), and the bad fix made
"big home favorites −1.5" look like +9% ROI. With the real prices it's −9%.

## Round 3: park by park, and model v2 (`results_round3.txt`)

- `scripts/park_lab.py`: 322 park-specific angles (30 parks × wind out/in/cross, calm, heat, cold, day, night ×
  over/under). 27 passed both periods; shuffled data passes 28 on average. No more than chance.
- `scripts/model_v2.py`: v1 plus platoon (lineup handedness vs the starter), temperature, wind by direction,
  Wrigley wind, umpire, bullpen workload, day-after-night. The new terms are real (temperature z ≈ 18), but the
  moneyline log loss doesn't improve (0.6797 vs market 0.6734) and totals stay worse than the market. Betting
  its edges at the close loses, except 8%+ unders at about +0.8%, too thin to bet.

## Hard tests of the standouts (`scripts/edge_tests.py`, `scripts/edge_tests2.py`)

All of 2010–2025. For each standout: bootstrap intervals on ROI, runs vs the closing total, a
selection-adjusted p-value (how often the best of all park angles does this well on shuffled results), the
mechanism at that park (HR per plate appearance), and how far the market moves the total.

- Wrigley wind out: HR/PA +72% (CI +55% to +88%); the market raises the total ~2.0 runs but scoring rises
  ~3.4; centered runs vs line +1.21 (t = 2.72). Searching 173 park angles gives a max |t| of 2.90 by chance
  (median), so even this doesn't beat the search statistically. Strongest candidate: real mechanism, market
  under-adjusts, sample too small to prove.
- Nationals / Target Field heat: real mechanism (HR/PA +14% / +10%); league-wide the market under-adjusts
  for 85°F+ by ~0.24 runs (±0.13), worth ~2 points of over% — about break-even after juice.
- Petco crosswind: no mechanism (HR/PA −4%), runs vs line not significant → noise.
- White Sox day unders: runs vs line ≈ 0 → noise from the shape of the distribution.
Selection-adjusted p-values for win/loss ROI: 0.80–0.99 for all five.
