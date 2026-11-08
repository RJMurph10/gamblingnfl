"""A model for NFL main-line props (the ~50/50 line) built on the lines themselves.
For every prop (research/props/nfl_line_props_data.py), features use only games before it:
  line_chg   this line vs the player's previous lines in the market (log ratio vs last and vs avg of last 3)
  beat       the player's results vs his own previous lines in the market (avg (actual-line)/scale, over rate)
  form_gap   his average actual in the market over his last 3 props vs this line
  opp        how players facing this defense did vs their lines in this market family this season (shrunk)
  team       how his team's players did vs their lines recently (all markets)
  novig      the book's no-vig over probability (0.5 when unpriced)
  market     one-hot, line level
Model: logistic regression (standardized), walk-forward: train 2024 → test 2025; train 2024-25 → test 2026.
Bets: side with model probability >= T; graded at the posted prices (2026 unpriced at -110).
  python3 -I research/props/nfl_line_props_model.py /tmp/claude-0/props_all.pkl"""
import sys, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
D = pd.read_pickle(sys.argv[1])
D = D.sort_values(["date", "game"]).reset_index(drop=True)
FAM = {"pass_yds": "pass", "pass_att": "pass", "pass_cmp": "pass", "pass_td": "pass", "pass_int": "pass", "pass_rush_yds": "pass",
       "carries": "rush", "rush_yds": "rush", "long_rush": "rush", "rec": "rec", "rec_yds": "rec", "long_rec": "rec", "rush_rec_yds": "rec",
       "kick_pts": "kick", "fg_made": "kick", "xp_made": "kick"}
D["fam"] = D.market.map(FAM)
scale = D.groupby("market").line.transform("median")
D["res"] = np.where(D.actual == D.line, 0.0, (D.actual - D.line) / scale)     # result vs line, in market units
D["res"] = D.res.clip(-2, 2)
D["over"] = (D.actual > D.line).astype(float); D.loc[D.actual == D.line, "over"] = np.nan
D["gameday"] = D.date.dt.normalize()

# ---- player x market history (strictly earlier games) ----
g = D.groupby(["player", "market"], sort=False)
D["prev_line"] = g.line.shift(1)
D["prev3_line"] = g.line.transform(lambda x: x.shift(1).rolling(3, min_periods=1).mean())
D["n_prev"] = g.cumcount()
D["beat"] = g.res.transform(lambda x: x.shift(1).rolling(6, min_periods=1).mean())
D["beat_rate"] = g.over.transform(lambda x: x.shift(1).rolling(6, min_periods=1).mean())
D["form3"] = g.actual.transform(lambda x: x.shift(1).rolling(3, min_periods=1).mean())
c = scale * 0.1
D["line_chg"] = np.log((D.line + c) / (D.prev_line + c))
D["line_chg3"] = np.log((D.line + c) / (D.prev3_line + c))
D["form_gap"] = np.log((D.form3 + c) / (D.line + c))
for k in ("line_chg", "line_chg3", "form_gap", "beat", "beat_rate"):
    D[k + "_na"] = D[k].isna().astype(float)
    D[k] = D[k].fillna(0.5 if k == "beat_rate" else 0.0)
# shrink the player's beat toward 0 by his number of earlier props
D["beat"] = D.beat * np.minimum(D.n_prev, 6) / (np.minimum(D.n_prev, 6) + 4)
D["beat_rate"] = 0.5 + (D.beat_rate - 0.5) * np.minimum(D.n_prev, 6) / (np.minimum(D.n_prev, 6) + 4)

# ---- defense and team vs lines, this season, games on earlier days only ----
def running(keycols, val, k):
    s = D.groupby(keycols + ["season", "gameday"])[val].agg(["sum", "count"]).reset_index().sort_values("gameday")
    gg = s.groupby(keycols + ["season"])
    s["cs"] = gg["sum"].cumsum() - s["sum"]; s["cn"] = gg["count"].cumsum() - s["count"]
    s["v"] = s.cs / (s.cn + k)
    return D.merge(s[keycols + ["season", "gameday", "v"]], on=keycols + ["season", "gameday"], how="left").v.fillna(0).to_numpy()
D["opp_fam"] = running(["opp", "fam"], "res", 20)
D["opp_mkt"] = running(["opp", "market"], "res", 20)
D["team_all"] = running(["team"], "res", 30)
D["team_fam"] = running(["team", "fam"], "res", 20)
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
po, pu = imp(D.o), imp(D.u)
D["novig"] = np.where(D.priced, po / (po + pu), 0.5)
D["logline"] = np.log(D.line + c) - np.log(scale)
D["week"] = D.groupby("season").gameday.rank(method="dense")
D["early"] = (D.week <= 3).astype(float)

FEATS = ["line_chg", "line_chg3", "form_gap", "beat", "beat_rate", "opp_fam", "opp_mkt", "team_all", "team_fam", "novig", "logline",
         "early", "line_chg_na", "form_gap_na", "beat_na", "home"]
D["home"] = D.home.astype(float)
X = pd.get_dummies(D[FEATS + ["market"]], columns=["market"], dtype=float)
# market-specific slopes for the line-based features
for f in ("line_chg", "form_gap", "beat", "opp_mkt"):
    for fam in ("pass", "rush", "rec", "kick"):
        X[f"{f}*{fam}"] = D[f] * (D.fam == fam)
ok = D.over.notna().to_numpy()
pay = lambda o: np.where(o < 0, 100 / -o, o / 100)
po_, pu_ = pay(D.o.to_numpy()), pay(D.u.to_numpy())

def evaluate(name, make):
    print(f"\n=== {name} ===")
    for tr_s, te_s in (((2024,), 2025), ((2024, 2025), 2026)):
        tr = D.season.isin(tr_s).to_numpy() & ok; te = (D.season == te_s).to_numpy() & ok
        m = make(); Xt = X[tr]; mu, sd = Xt.mean(), Xt.std().replace(0, 1)
        m.fit((Xt - mu) / sd, D.over[tr]); p = m.predict_proba((X[te] - mu) / sd)[:, 1]
        y = D.over[te].to_numpy()
        base = D[tr].groupby("market").over.mean(); pb = D[te].market.map(base).fillna(0.5).to_numpy()
        ll = lambda q: -np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))
        print(f" test {te_s}: n={te.sum()}  log loss model {ll(np.clip(p,1e-3,1-1e-3)):.4f} | market base rate {ll(pb):.4f} | 50/50 {np.log(2):.4f}")
        for T in (0.53, 0.55, 0.57, 0.60):
            side_over = p >= T; side_under = p <= 1 - T
            for lab, sel, win, pp in (("over", side_over, y == 1, po_[te]), ("under", side_under, y == 0, pu_[te])):
                n = sel.sum()
                if not n: continue
                units = np.where(win[sel], pp[sel], -1).sum()
                print(f"   p>={T:.2f} {lab:5}: {int(win[sel].sum())}-{int(n - win[sel].sum())} ({win[sel].mean()*100:.1f}%) ROI {units / n * 100:+.1f}%")
        D.loc[te, f"p_{name}"] = p
evaluate("logistic", lambda: LogisticRegression(C=0.05, max_iter=2000))
evaluate("boosted", lambda: HistGradientBoostingClassifier(max_depth=3, learning_rate=0.03, max_iter=300, l2_regularization=1.0, min_samples_leaf=80))
D.to_pickle("/tmp/claude-0/props_feat.pkl")
