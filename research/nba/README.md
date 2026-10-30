# NBA research data

Research files only. Nothing in `research/` is part of the website or gets shipped with it.

## Data

`data/games.csv` holds 23,552 NBA games from 2007-08 to 2025-26 (playoffs included). It has one row per game:
date, teams, final score, spread and total (opening and/or closing), and moneylines.

| Seasons | What the lines are | Source |
|---|---|---|
| 2007-08 to 2021-22 (not 2011-12) | Opening **and** closing spread and total, closing moneyline | SBR archive spreadsheets |
| 2011-12 | Opening spread and total, closing moneyline | kyleskom OddsData.sqlite |
| 2022-23 to 2025-26 | One spread, total and moneyline per game, **timing unknown** (spread and moneyline from the same snapshot) | kyleskom OddsData.sqlite |

Spreads are the **home** line, so negative means the home team is favored.

The kyleskom database's lines for 2007-2021 matched SBR's *opening* lines (spread 95%, total 100%),
not the closing ones. Its moneylines matched SBR's closing moneylines.

Cleaning: a total typed with an extra digit is fixed, and openers more than 12 points (totals) or
10 points (spreads) away from the close are dropped as entry errors (26 games).

## Rebuild everything

The raw sources aren't kept in git. To rebuild `games.csv` from scratch, clone them into `sources/`:

```
git clone --depth 1 https://github.com/mcheung610/nba-machine-learning-sports-betting research/nba/sources/nba-machine-learning-sports-betting
git clone --depth 1 https://github.com/kyleskom/NBA-Machine-Learning-Sports-Betting research/nba/sources/NBA-Machine-Learning-Sports-Betting
python3 -c "import sys; sys.path.insert(0,'research/nba/scripts'); import nba_data as n; n.sbr_rows().to_csv('research/nba/data/sbr.csv',index=False); n.ks_rows().to_csv('research/nba/data/ks.csv',index=False); n.combined()"
```

Analysis (works from the committed `games.csv` alone):

```
node research/nba/scripts/run-ts.cjs research/nba/scripts/replay.ts research/nba/data/games.csv open  research/nba/data/replay-open.csv
node research/nba/scripts/run-ts.cjs research/nba/scripts/replay.ts research/nba/data/games.csv close research/nba/data/replay-close.csv
python3 research/nba/scripts/features.py     # walk-forward rest, travel and rating features
python3 research/nba/scripts/grade.py        # the site model's record by season
python3 research/nba/scripts/edges.py        # edge search
```

`replay.ts` runs the site's real model (`src/lib/nba/nba-model.ts`), walk-forward, the same way the site does.

## Findings (October 2026)

Saved outputs are in `results/`.

- **The site's NBA model has no betting edge.**
  - Against closing lines from 2008-2022, its spread picks hit 50.7% and its totals 50.0%. Break-even is 52.4%.
  - Its spread opinions also carry no information the market lacks: when it disagrees with the opener,
    the line moves its way only 48% of the time.
  - Its total opinions do carry some (the line moves its way 57% of the time, 61% on ★ picks),
    but not enough to beat the vig.
- **Watch candidate (not proven): bet the away team at the opening spread when the home team is on the
  second night of a back-to-back and the away team is rested.**
  - 2008-2022 at the opener: 710-602 (54.1%, +43.5u).
  - 2022-26 on the single known line: 239-212 (53.0%).
  - In these games the line moved toward the away team 723 times and toward the home team 313 times.
  - At the closing line the edge is gone (about 50%).
  - Not significant (p ≈ 0.10, about 40 ideas tested) and profitable in only 6 of 14 seasons. Track it; don't star it.
- **Consistent but break-even:** a home team returning from 4+ road games covers only 47.6% in every period.
  The other side hits 52.4%, exactly break-even at -110, so it's only worth betting at reduced juice.
