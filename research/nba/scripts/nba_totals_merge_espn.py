import glob, numpy as np, pandas as pd
G = pd.read_csv("/home/claude/gamblingnfl/research/nba/data/games.csv")
G = G[G.season <= 2022]
E = pd.concat([pd.read_csv(f) for f in glob.glob("espn/**/*.csv", recursive=True)])
E = E[E.season_type.isin([2, 3])]
M = {"GS": "GSW", "NY": "NYK", "NO": "NOP", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}
E["home"] = E.home.replace(M); E["away"] = E.away.replace(M)
print(E.groupby("book").size())
pick = E[E.book == 100]
if pick.total_open.notna().mean() < 0.5: print("DK opens sparse")
alt = E[E.book == 58]
B = pick.set_index("id").combine_first(alt.set_index("id")).reset_index()
B["date_utc"] = pd.to_datetime(B.date)
B["date"] = (B.date_utc - pd.Timedelta(hours=5)).dt.strftime("%Y-%m-%d")
B["season"] = np.where(pd.to_datetime(B.date).dt.month >= 8, pd.to_datetime(B.date).dt.year, pd.to_datetime(B.date).dt.year - 1)
B = B.rename(columns={"home_pts": "home_pts", "away_pts": "away_pts"})
out = pd.DataFrame({"season": B.season, "date": B.date, "home": B.home, "away": B.away, "home_pts": B.home_pts, "away_pts": B.away_pts,
    "spread_open": B.spread_open, "spread_close": B.spread_close, "total_open": B.total_open, "total_close": B.total_close.fillna(B.total),
    "ml_home": np.nan, "ml_away": np.nan, "neutral": False, "source": "espn-" + B.book.astype(str), "line_note": "espn open+close"})
print(out.groupby("season").agg(n=("home", "size"), open=("total_open", lambda s: s.notna().mean()), close=("total_close", lambda s: s.notna().mean())))
pd.concat([G, out]).to_csv("games_plus.csv", index=False)
