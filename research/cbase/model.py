"""College baseball run-ratings model, walk-forward by day, tested against ESPN's lines.

Ratings (refit every game day on everything earlier that season):
  runs scored by A against B = mu + home*h + midweek*m + off_A - def_B
fit by weighted ridge least squares, each game's weight halving every HALF_LIFE days, and each team's
off/def pulled toward CARRY x last season's rating with the weight of PRIOR_GAMES games.

Predictions: expected runs for each side → total, margin. P(home win) = logistic(K * margin), and
P(over) from a normal around the predicted total with sd SIGMA; K and SIGMA are fit on 2019, 2021–23
(seasons without lines).

  python research/cbase/model.py <games.csv.gz> [out dir]
"""

import sys
from math import erf, sqrt
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsqr

GAMES = sys.argv[1]
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else ".")
HALF_LIFE = float(sys.argv[3]) if len(sys.argv) > 3 else 45.0
CARRY = float(sys.argv[4]) if len(sys.argv) > 4 else 0.6
PRIOR_GAMES = float(sys.argv[5]) if len(sys.argv) > 5 else 8.0

df = pd.read_csv(GAMES, low_memory=False)
df["date"] = pd.to_datetime(df["date"])
df["midweek"] = (df["date"].dt.dayofweek <= 3).astype(float)  # Mon–Thu
df["fri"] = (df["date"].dt.dayofweek == 4).astype(float)  # series openers: teams' best starters
df["sun"] = (df["date"].dt.dayofweek == 6).astype(float)
PARK = "--no-park" not in sys.argv
df = df.sort_values(["date", "ncaa_id"]).reset_index(drop=True)


def fit(hist, teams, prior, today):
    """Ridge fit of off/def on games in hist (before today), pulled toward prior."""
    T = len(teams)
    idx = {t: i for i, t in enumerate(teams)}
    age = (today - hist["date"]).dt.days.values
    w = 0.5 ** (age / HALF_LIFE)
    n = len(hist)
    h_i = hist["home"].map(idx).values
    a_i = hist["away"].map(idx).values
    mid = hist["midweek"].values
    hr, ar = hist["hr"].values.astype(float), hist["ar"].values.astype(float)
    # columns: 0..T-1 off, T..2T-1 def, 2T mu, 2T+1 home, 2T+2 midweek, 2T+3 fri, 2T+4 sun,
    # 2T+5.. 3T+4 park (home team's park, on both sides' runs); two rows per game
    r = np.arange(2 * n)
    fri = np.concatenate([hist["fri"].values] * 2)
    sun = np.concatenate([hist["sun"].values] * 2)
    park = np.concatenate([h_i, h_i]) + 2 * T + 5
    scorer = np.concatenate([h_i, a_i])
    opp = np.concatenate([a_i, h_i])
    home = np.concatenate([np.ones(n), np.zeros(n)])
    midw = np.concatenate([mid, mid])
    rows = np.concatenate([r, r, r, r, r, r, r] + ([r] if PARK else []))
    cols = np.concatenate([scorer, T + opp, np.full(2 * n, 2 * T), np.full(2 * n, 2 * T + 1), np.full(2 * n, 2 * T + 2),
                           np.full(2 * n, 2 * T + 3), np.full(2 * n, 2 * T + 4)] + ([park] if PARK else []))
    vals = np.concatenate([np.ones(2 * n), -np.ones(2 * n), np.ones(2 * n), home, midw, fri, sun] + ([np.ones(2 * n)] if PARK else []))
    y = list(np.concatenate([hr, ar]))
    ws = list(np.concatenate([w, w]))
    rows, cols, vals = list(rows), list(cols), list(vals)
    # prior rows: off_t = CARRY*prev_off, def_t = CARRY*prev_def, each worth PRIOR_GAMES games
    for t, i in idx.items():
        po, pd_, pk = prior.get(t, (0.0, 0.0, 0.0))
        for c, v in ((i, po), (T + i, pd_), (2 * T + 5 + i, pk)):
            rows.append(len(y))
            cols.append(c)
            vals.append(1.0)
            y.append(CARRY * v)
            ws.append(PRIOR_GAMES)
    sw = np.sqrt(np.array(ws))
    A = coo_matrix((np.array(vals) * sw[np.array(rows)], (rows, cols)), shape=(len(y), 3 * T + 5)).tocsr()
    b = np.array(y) * sw
    sol = lsqr(A, b, damp=0.0, atol=1e-6, btol=1e-6, iter_lim=400)[0]
    return idx, sol


preds = []
prior = {}
for season, S in df.groupby("season"):
    S = S.copy()
    teams = sorted(set(S["home"]) | set(S["away"]))
    T = len(teams)
    days = sorted(S["date"].unique())
    games_played = {t: 0 for t in teams}
    sol, idx = None, None
    for day in days:
        today = S[S["date"] == day]
        hist = S[S["date"] < day]
        if len(hist) >= 50:
            idx, sol = fit(hist, teams, prior, pd.Timestamp(day))
        for _, g in today.iterrows():
            rec = dict(season=season, date=day, ncaa_id=g["ncaa_id"], home=g["home"], away=g["away"], hr=g["hr"], ar=g["ar"],
                       gp_h=games_played[g["home"]], gp_a=games_played[g["away"]], midweek=g["midweek"])
            if sol is not None:
                i, j = idx[g["home"]], idx[g["away"]]
                mu, hh, mm, ff, ss = sol[2 * T : 2 * T + 5]
                base = mu + mm * g["midweek"] + ff * g["fri"] + ss * g["sun"] + (sol[2 * T + 5 + i] if PARK else 0.0)
                rec["lam_h"] = base + hh + sol[i] - sol[T + j]
                rec["lam_a"] = base + sol[j] - sol[T + i]
            preds.append(rec)
        for _, g in today.iterrows():
            games_played[g["home"]] += 1
            games_played[g["away"]] += 1
    # end of season: this season's final ratings become next season's prior
    if len(S) >= 50:
        idx, sol = fit(S, teams, prior, S["date"].max() + pd.Timedelta(days=1))
        prior = {t: (sol[i], sol[T + i], sol[2 * T + 5 + i]) for t, i in idx.items()}
        mu, hh, mm, ff, ss = sol[2 * T : 2 * T + 5]
        print(f"   end of {season}: mu {mu:.2f} home {hh:+.2f} midweek {mm:+.2f} fri {ff:+.2f} sun {ss:+.2f}", flush=True)
    print(f"season {season}: {len(S)} games, {T} teams", flush=True)

P = pd.DataFrame(preds)
P = P.merge(df[["ncaa_id", "date"] + [c for c in df.columns if c.startswith(("o_", "c_"))] + ["book"]], on=["ncaa_id", "date"], how="left")
OUT.mkdir(parents=True, exist_ok=True)
P.to_csv(OUT / f"preds_hl{HALF_LIFE:g}_c{CARRY:g}_p{PRIOR_GAMES:g}{'' if PARK else '_nopark'}.csv.gz", index=False)
ok = P["lam_h"].notna()
tot_err = (P.loc[ok, "lam_h"] + P.loc[ok, "lam_a"]) - (P.loc[ok, "hr"] + P.loc[ok, "ar"])
mar_err = (P.loc[ok, "lam_h"] - P.loc[ok, "lam_a"]) - (P.loc[ok, "hr"] - P.loc[ok, "ar"])
print(f"HL {HALF_LIFE} carry {CARRY} prior {PRIOR_GAMES}: total MAE {tot_err.abs().mean():.3f}, margin MAE {mar_err.abs().mean():.3f}")
for s, g in P[ok].groupby("season"):
    te = (g.lam_h + g.lam_a) - (g.hr + g.ar)
    me = (g.lam_h - g.lam_a) - (g.hr - g.ar)
    print(f"  {s}: n {len(g)} total MAE {te.abs().mean():.3f} margin MAE {me.abs().mean():.3f}")
