# Player props vs real lines (free ESPN history)

ESPN's core odds feed keeps every book's player props for finished games. `scripts/line-history/backfill-props.mjs`
downloads them, `build-props-history.mjs` adds box scores and writes one gzipped file per league-season to the
`props-history` branch. Clone it next to these scripts as `ph/` to rerun.

## Data quality (important)
- Each prop row has an opening line/price ("op") and ESPN's last line ("cur").
- "cur" is **not always pregame**: some books kept updating it during the game. Test: correlation of the line move
  (cur − open) with the result (actual − open). Pregame moves ≈ 0.10–0.20; in-game ≈ 0.4–0.7.
  - NBA 2022-23: DraftKings, Caesars, PointsBet "cur" is in-game (corr 0.57–0.70); MGM and SugarHouse clean.
  - NBA 2023-24: every book clean (≈0.11–0.15).
  - NBA 2024-25 / 2025-26 (ESPN BET only): in-game (0.38 / 0.27).
  - NFL 2024-25: clean (0.09–0.20).
- So tests use **opening lines** everywhere (always pregame), and closing lines only where clean.

## NBA (2022-23 → 2025-26), `nba_lab.py`, `nba_model.py`, `nba_reb.py`
- Blind: overs hit 47–50% against no-vig 50%; unders lose only the vig (−1% to −6%), overs lose 6–12%.
- Simple walk-forward projection (season + last-10 per-minute rates × recent minutes):
  - **Rebounds under when the projection is 10%+ below the line**: positive every season and at every book —
    +1.0% (2022-23), +5.0% (2023-24 open), +3.3% (2023-24 close), +0.7% (2024-25), +5.4% (2025-26 partial);
    ~35,000 single-book bets, 57–60% winners.
  - Assists unders: ≈ break-even. Points, threes, and all overs: lose.

## NFL QBs (2024, 2025), `nfl_qb.py` — the QB model from `claude/qb-props-model.md` against real lines
- Accuracy: new QB model ≈ the line (passing yards MAE 53.3 vs line 53.5); the site's current projections are
  worse (58.3).
- Passing yards over when the model is 8%+ above the line: +6.8% at open and close, both seasons positive
  (≈ 200–230 bets). Pass + rush yards over, 4%+ edge: +13% open / +10% close (≈ 230–280 bets).
- Samples are small (two seasons, ~450 QB games each); treat as promising, not proven.
