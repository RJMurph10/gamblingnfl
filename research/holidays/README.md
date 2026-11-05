# Holiday games vs the betting lines (November 2026)

This folder holds `holidays.py`, which runs on `research/nba/data/games.csv` (NBA 2007-08 to 2025-26) and `research/football/data/football.csv` (NFL 1999-2025, closing lines only).

## NBA (closing lines)
| Day | Games | Favorites ATS | Overs |
|---|---|---|---|
| Christmas Day | 85 | 35-45 (43.8%) | 39-39 |
| MLK Day | 196 | 82-94 (46.6%) | 78-105 (42.6%) |
| Opening night | 64 | 23-34 (40.4%) | 26-33 |
| All other games | 23,212 | 50.1% | 49.9% |

- Underdogs on all three days combined went 173-140 (55.3%, p ≈ 0.06), and won in every era: 49-35, 58-50, 66-55.
  - Caveat: the three days were combined after each one leaned toward the underdog.
  - Status: watch list, not ★.
- Christmas totals: 37.5% overs from 2007-14, but 55.6% from 2015-25. There's no stable lean.
- Christmas games are not closer than other games (22% are decided by 5 points or fewer, against 27% for other games).

## NFL (closing lines)
| Games | N | Favorites ATS | Overs |
|---|---|---|---|
| Thanksgiving (all) | 73 | 43-29 (59.7%) | 50.7% |
| Thanksgiving night game | 19 | 14-5 | 6-13 |
| Christmas Day | 29 | 9-19 (32.1%) | 48.3% |
| Other Thursday games | 263 | 51.4% | 49.4% |

- The Thanksgiving favorites edge faded: 68.8% from 1999-2011, then 52.5% from 2012-25.
- Lions at home on Thanksgiving: 10-16 ATS. Cowboys at home: overs went 17-10.
- These samples are tiny. About 20 splits were tested, so one or two will look significant by chance.

## Takeaway
- No holiday rule clears the bar for ★.
- The one worth tracking is underdogs on the NBA's marquee days (Christmas, MLK Day and opening night).

## NBA Christmas points props (`christmas_props.py`, opening lines from props-history)
- **Coverage:** Christmas 2022 and 2023 in full. Christmas 2024 has only 6 props. The 2025-26 file stops before December.
- **Christmas, all players:** 164 props, overs 85-77 (52.5%), +0.9 points vs the line on average.
- **Every other day:** 52,791 props, overs 47.1%. Overs usually lose.
- **Stars (line 24.5+):** 12-11 on Christmas vs 46.6% on other days.
- **The day's best performance vs the line:** +13.8 on Christmas on average, against +15.0 on a normal slate the same size. There are about 2 40-point games each Christmas.
- **Takeaway:** Christmas overs did a little better than usual, but at 164 props that's within noise (p ≈ 0.15 for the difference). Someone always has a huge game, but that's true of every slate; the hard part is knowing who beforehand. Not an edge yet. Re-check after Christmas 2026 now that lines are saved every day.
