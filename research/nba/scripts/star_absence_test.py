"""Do star absences move NBA totals beyond the opener? Joins the site-code replay at the opener
(replay.ts on games_clean.csv) with star_absence_build.py's per-game absences (ESPN box scores from
fetch_espn_box.mjs, data on branch nba-odds-data as box-*.csv.gz). Findings: claude/nba-model-audit.md."""
import numpy as np, pandas as pd, statsmodels.api as sm
R = pd.read_csv("replay_open.csv"); R = R[R.season >= 2023]
G = pd.read_csv("games_clean.csv"); G = G[G.season >= 2023][["date", "home", "away", "total_open", "total_close"]]
A = pd.read_csv("absences.csv")
D = R.merge(G, on=["date", "home", "away"]).merge(A.drop(columns=["season"]), left_on=["date", "home", "away"], right_on=["day", "home", "away"])
D["tot"] = D.home_pts + D.away_pts
D = D.dropna(subset=["total_open", "delta_h", "delta_a"])
D["dsum"] = D.delta_h + D.delta_a; D["ssum"] = D.star_h + D.star_a
for y, lab in [(D.tot - D.total_open, "actual-OPEN"), (D.total_close - D.total_open, "move"), (D.tot - D.pred_total, "actual-MODEL")]:
    m = sm.OLS(y, sm.add_constant(D[["ssum", "dsum"]])).fit()
    print(lab, m.params.round(3).to_dict(), m.tvalues.round(1).to_dict())
def rec(x, pred, lo):
    e = pred - x.total_open; m = e.abs() >= lo; y = x[m]; over = e[m] > 0; r = np.sign(y.tot - y.total_open)
    return ((over & (r > 0)) | (~over & (r < 0))).sum(), ((over & (r < 0)) | (~over & (r > 0))).sum()
p = D.pred_total.copy()
for s in D.season.unique():  # each season's coefficient from the other seasons
    tr = D[D.season != s]; c = sm.OLS(tr.tot - tr.pred_total, sm.add_constant(tr[["ssum"]])).fit().params.ssum
    p[D.season == s] = D.pred_total[D.season == s] + c * D.ssum[D.season == s]
for tag, pp in [("site", D.pred_total), ("+ stars", p)]:
    for s, x in D[D.season < 2026].groupby("season"):
        print(tag, s, "5+", rec(x, pp[x.index], 5), "8+", rec(x, pp[x.index], 8))
