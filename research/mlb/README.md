# MLB research (2010–2025)

Scripts and results behind the /mlb Model page. Data is not committed; it is rebuilt from free sources:

- Retrosheet game logs and event files 2010–2025 (Chadwick Bureau mirror: https://github.com/chadwickbureau/retrosheet), parsed by `parse_events.py` (plate appearances) and `parse_info.py` (weather, umpire).
- Closing lines: SportsbookReviewsOnline 2010–2021 via https://github.com/ethanbell528-cmd/fda-project-1 (`data/mlb.csv`), and 2022–2025 via https://github.com/tanhungle/mlb-reference-data (`odds_flat.csv`; DraftKings, else FanDuel — the other books there carry placeholder prices).

Run in order: `parse_events.py`, `parse_info.py`, `build_games.py`, `model.py`, `evaluate.py`, `angle_lab.py`, `props.py`.

Results: `results_model.txt` (model vs closing line), `results_angles.txt` (angle lab), `results_props.txt` (strikeout and batter projections).

The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org.
