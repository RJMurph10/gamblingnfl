"""MLB: does the walk-forward model (v2) beat the OPENING line, the way the NBA / college totals models do?
2021-2025 openers + closers by book (mlb-reference-data/odds_flat.csv), model preds_v2 (refit each season).
Totals: model expected runs vs the opening total; moneyline: model win prob vs the no-vig opener."""
import numpy as np, pandas as pd
from scipy.stats import nbinom
P = pd.read_parquet("/root/mlbdata/preds_v2.parquet")
O = pd.read_csv("/root/mlbdata/src/mlb-reference-data/odds_flat.csv", low_memory=False)
RS = {"ANA": "LAA", "CHA": "CHW", "CHN": "CHC", "KCA": "KC", "LAN": "LAD", "NYA": "NYY", "NYN": "NYM", "SDN": "SD", "SFN": "SF", "SLN": "STL", "TBA": "TB", "ARI": "ARI"}
P["h"] = P.home.map(lambda t: RS.get(t, t)); P["a"] = P.away.map(lambda t: RS.get(t, t))
O["home"] = O.home.replace({"AZ": "ARI"}); O["away"] = O.away.replace({"AZ": "ARI"})
P["date"] = pd.to_datetime(P.date).dt.strftime("%Y-%m-%d")
BOOK = "draftkings"
def side(market):
    x = O[(O.market == market) & (O.sportsbook == BOOK)].drop_duplicates(["date", "home", "away"], keep=False)
    return x
T = side("totals").merge(P, left_on=["date", "home", "away"], right_on=["date", "h", "a"], suffixes=("", "_p"))
M = side("moneyline").merge(P, left_on=["date", "home", "away"], right_on=["date", "h", "a"], suffixes=("", "_p"))
print("matched games: totals", len(T), "moneyline", len(M))
pay = lambda o: np.where(o < 0, 100 / -o, o / 100)
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
# model P(over line) from the negative-binomial run distributions (sum approximated by matching mean/variance)
def p_over(mu_a, mu_h, r_a, r_h, line):
    mu = mu_a + mu_h; var = mu_a + mu_a**2 / r_a + mu_h + mu_h**2 / r_h
    r = mu**2 / np.maximum(var - mu, 1e-6); p = r / (r + mu)
    k = np.floor(line)
    over = 1 - nbinom.cdf(k, r, p)
    push = np.where(line == k, nbinom.pmf(k, r, p), 0)
    return over / np.maximum(1 - push, 1e-9)
T["runs"] = T.home_score + T.away_score
for lab in ("opening", "closing"):
    T[f"po_{lab}"] = p_over(T.mu2_a, T.mu2_h, T.r2_a, T.r2_h, T[f"{lab}_total"])
    fo = imp(T[f"{lab}_over_odds"]); fu = imp(T[f"{lab}_under_odds"]); T[f"fair_{lab}"] = fo / (fo + fu)
print("\nTOTALS: model edge vs the no-vig price, bet at that line's price")
for thr in (0.03, 0.05, 0.08):
    for lab in ("opening", "closing"):
        x = T[T[f"{lab}_total"].notna() & T[f"{lab}_over_odds"].notna()].copy()
        e = x[f"po_{lab}"] - x[f"fair_{lab}"]; k = e.abs() >= thr; x = x[k]; e = e[k]
        over = e > 0; line = x[f"{lab}_total"]
        res = np.sign(x.runs - line); nz = res != 0
        win = np.where(over, res > 0, res < 0)
        price = np.where(over, x[f"{lab}_over_odds"], x[f"{lab}_under_odds"])
        u = np.where(~nz, 0, np.where(win, pay(price), -1))
        mv = np.where(over, x.closing_total - x.opening_total, x.opening_total - x.closing_total) if lab == "opening" else None
        seas = " ".join(f"{s}:{(u[(x.season == s).values]).sum():+.0f}u" for s in sorted(x.season.unique()))
        extra = f" | total moved toward {np.mean(mv > 0)*100:.0f}% away {np.mean(mv < 0)*100:.0f}%" if mv is not None else ""
        print(f"  edge {thr:.0%} @ {lab:8}: n={nz.sum():5} win {win[nz].mean()*100:5.1f}%  {u.sum():+7.1f}u  ROI {u.sum()/nz.sum()*100:+5.1f}%{extra} | {seas}")
print("\nMONEYLINE: model win prob vs the no-vig price")
for thr in (0.03, 0.05, 0.08):
    for lab in ("opening", "closing"):
        x = M[M[f"{lab}_home_odds"].notna() & M[f"{lab}_away_odds"].notna()].copy()
        fh = imp(x[f"{lab}_home_odds"]); fa = imp(x[f"{lab}_away_odds"]); fair = fh / (fh + fa)
        e = x.p2_home - fair; k = (e.abs() >= thr).values; x = x[k]; e = e[k]
        home = e > 0; won = x.home_score > x.away_score
        price = np.where(home, x[f"{lab}_home_odds"], x[f"{lab}_away_odds"])
        win = np.where(home, won, ~won); u = np.where(win, pay(price), -1)
        extra = ""
        if lab == "opening":
            fc = imp(x.closing_home_odds) / (imp(x.closing_home_odds) + imp(x.closing_away_odds))
            fo = imp(x.opening_home_odds) / (imp(x.opening_home_odds) + imp(x.opening_away_odds))
            mv = np.where(home, fc - fo, fo - fc); extra = f" | price moved toward {np.mean(mv > 0.005)*100:.0f}% away {np.mean(mv < -0.005)*100:.0f}%"
        seas = " ".join(f"{s}:{(u[(x.season == s).values]).sum():+.0f}u" for s in sorted(x.season.unique()))
        print(f"  edge {thr:.0%} @ {lab:8}: n={len(x):5} win {win.mean()*100:5.1f}%  {u.sum():+7.1f}u  ROI {u.sum()/len(x)*100:+5.1f}%{extra} | {seas}")
