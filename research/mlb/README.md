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
