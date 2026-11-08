"""Do NFL teams beat the betting lines after trading for a star in season? (Nov 2026)
Data: nflverse trades.csv, players.csv (pfr_id -> gsis_id), historical_contracts.parquet (apy_cap_pct
of the contract in force at the trade), nflverse games (closing spread).
  python3 research/football/trades/star_trades.py <dir with the three nflverse files>
Result (2009-2025, contract 5%+ of cap, Sep-Nov trades, n=46): buyers covered 52.8% after (+0.7 pts),
first 4 games after 49.7%; 10%+ of cap (n=13) 53.8%, first 4 26-25 (-1.3 pts). Buyers had covered
+1.7 pts/game BEFORE the trade (contenders buy when hot). Sellers 49.3% after. The market moved the
buyer's lines ~0.7 pts on average (0.9 for 10%+ stars; futures_tradeval in the session notes)."""
import sys, pandas as pd, numpy as np
D = sys.argv[1]
t = pd.read_csv(f"{D}/trades.csv"); p = pd.read_csv(f"{D}/players.csv", low_memory=False)
c = pd.read_parquet(f"{D}/historical_contracts.parquet")
t = t[t.pfr_id.notna()].copy(); t["date"] = pd.to_datetime(t.trade_date)
t = t.merge(p[["pfr_id", "gsis_id", "position"]].dropna(subset=["pfr_id"]), on="pfr_id", how="left")
def cap(r):
    x = c[(c.gsis_id == r.gsis_id) & (c.year_signed <= r.season)]
    return x.sort_values("year_signed").apy_cap_pct.iloc[-1] if len(x) else np.nan
t["cap"] = t.apply(cap, axis=1); t["inseason"] = t.date.dt.month.isin([9, 10, 11])
g = pd.read_csv("/root/fbdata/src/nfl_games.csv"); g = g[(g.game_type == "REG") & g.home_score.notna() & g.spread_line.notna()]
g["day"] = pd.to_datetime(g.gameday); m = g.home_score - g.away_score
G = pd.concat([pd.DataFrame(dict(season=g.season, day=g.day, team=g.home_team, cv=m - g.spread_line)),
               pd.DataFrame(dict(season=g.season, day=g.day, team=g.away_team, cv=-m + g.spread_line))])
for side in ("received", "gave"):
    for cut in (0.05, 0.08, 0.10):
        rows = []
        for _, r in t[t.inseason & (t.cap >= cut)].iterrows():
            x = G[(G.season == r.season) & (G.team == r[side])]
            pre, post = x[x.day < r.date], x[x.day > r.date].sort_values("day")
            rows.append(dict(pre=pre.cv.mean(), w=(post.cv > 0).sum(), l=(post.cv < 0).sum(), avg=post.cv.mean(),
                             w4=(post.head(4).cv > 0).sum(), l4=(post.head(4).cv < 0).sum()))
        R = pd.DataFrame(rows)
        print(f"{side:9} cap>={cut:.2f} n={len(R)} before {R.pre.mean():+.2f} | after {R.w.sum()}-{R.l.sum()} avg {R.avg.mean():+.2f} | first 4 {R.w4.sum()}-{R.l4.sum()}")
