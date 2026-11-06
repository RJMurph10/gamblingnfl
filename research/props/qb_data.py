"""QB game table, 1999-2025 regular season (nflverse weekly stats + games/lines).

One row per QB per game in which he threw a pass. `primary` = his team's main passer that game
(most attempts, 10+), the same test the site uses. Each row carries the game's closing spread and
total, the team's implied points (total/2 - own line/2), roof, wind and temperature.
"""
import glob

import numpy as np
import pandas as pd

P = "/root/fbdata/src/players"
stats = pd.concat([pd.read_csv(f, low_memory=False) for f in sorted(glob.glob(f"{P}/stats_player_week_*.csv"))], ignore_index=True)
stats = stats[(stats.season_type == "REG") & (stats.attempts.fillna(0) > 0)].copy()
games = pd.read_csv("/root/fbdata/src/nfl_games_now.csv")
games = games[games.game_type == "REG"]

# nflverse uses the same game_id in both files
cols = ["game_id", "home_team", "away_team", "spread_line", "total_line", "roof", "wind", "temp", "gameday", "gametime", "home_rest", "away_rest", "location"]
s = stats.merge(games[cols], on="game_id", how="left")
s["home"] = s.team == s.home_team
s["own_line"] = np.where(s.home, -s.spread_line, s.spread_line)  # negative = this team favored
s["implied_pts"] = s.total_line / 2 - s.own_line / 2
s["opp_implied_pts"] = s.total_line - s.implied_pts
team_att = s.groupby(["game_id", "team"]).attempts.transform("sum")
s["share"] = s.attempts / team_att
main = s.groupby(["game_id", "team"]).attempts.transform("max")
s["primary"] = (s.attempts == main) & (s.attempts >= 10)
keep = ["season", "week", "game_id", "gameday", "player_id", "player_display_name", "position", "team", "opponent_team", "home",
        "completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions", "sacks_suffered", "carries",
        "rushing_yards", "rushing_tds", "share", "primary", "spread_line", "total_line", "own_line", "implied_pts",
        "opp_implied_pts", "roof", "wind", "temp", "location"]
out = s[keep].sort_values(["season", "week", "game_id", "team", "attempts"], ascending=[True, True, True, True, False])
out.to_csv("/root/fbdata/qb_games.csv", index=False)
prim = out[out.primary]
print(len(out), "QB-games;", len(prim), "primary starts;", prim.season.min(), "-", prim.season.max())
print("primary starts with a line:", int(prim.total_line.notna().sum()))
print(prim.groupby("season").passing_yards.mean().round(1).to_dict())
