# Football research: NFL and college rules cross-tested

Research files only. Nothing in `research/` is part of the website or gets shipped with it.

## Data

`data/football.csv` has one table with the same columns for both leagues:
- **NFL:** 7,074 regular-season games, 1999-2025, closing lines (nflverse).
- **College:** 8,810 FBS vs FBS regular-season games, 2013-2025. Closing lines on every game, and opening lines on 94% (none in 2020). Each line is the median across sportsbooks (cfbfastR / CollegeFootballData).

Spreads are the **home** line (negative = home favored). For each team, the table also has its previous game's
margin and rest, travel miles, time zones, and kickoff wind and temperature (NFL only).

Rebuilding it needs the raw sources in `sources/`:

```
curl -o research/football/sources/nfl_games.csv https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
git clone --depth 1 --filter=blob:none --sparse https://github.com/sportsdataverse/cfbfastR-data research/football/sources/cfbfastR-data
(cd research/football/sources/cfbfastR-data && git sparse-checkout set betting/csv schedules/csv)
python3 research/football/scripts/fb_data.py
```

Before 2020 each sportsbook used its own college team codes, so `fb_data.py` matches each code to its team by name.
As a check, the spread's favorite agrees with the moneyline favorite in 99.5% of games. The site's college ★ rules
also reproduce on this data: for 2019-25, bounce-back is 218-166 here vs 222-167 on the site, and early unders are
325-249 vs 330-253.

## Scripts
- `cross.py`: every NFL rule on college history and every college rule on NFL history (`results/cross-test.txt`).
- `before_after.py`: the NFL ★ record with the old rules and the new ones, 1999-2025 (`results/before-after.txt`).
- `site-replay.ts`: runs the site's own model-page replay on real history (`results/site-replay.txt`).
  - Run it with jiti and the `@` alias, as `research/nba/scripts/run-ts.cjs` does.

## What changed on the site (October 2026)
- **NFL ★ underdogs: home underdogs only.** Road 7+ underdogs broke even or lost in every era (792-767, −47u since 1999).
- **New NFL ★: road bounce-back.** Bet the road team after it lost its previous game by 28+. This is the college rule. On 27 NFL seasons it never saw, it went 118-92 (56.2%) and was positive in every era.
- **Result at closing lines, 1999-2025:**
  - The ★ record goes from 53.1% (+51.9u) to 55.0% (+122.2u), on a third fewer bets.
  - On the site's own replay for 2023-25, it goes from 54.4% (+17.2u) to 57.7% (+33.6u).
- **Caveat:** the bounce-back result is out-of-sample, but the home-only underdog cut was chosen after seeing this data. Expect somewhat less going forward.

## What didn't carry over
- **NFL rules on college:** 7+ underdogs (49-51%) and West Coast teams flying east (44.5%) fail.
- **College rules on the NFL:** cross-country trips (49%), early unders (flip between eras), high-total unders (51%) and the 3+ time-zone angle (47.9%) fail.
- **East team at a West night game, on college:** looks good, but it's the same travel effect college's own rules already bet.
