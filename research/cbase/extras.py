"""College baseball model v3 research: bullpen fatigue, margin calibration, doubleheaders, and a run
simulation (inning by inning: the home team skips the bottom of the 9th when ahead, extra innings, the
10-run rule after 7) in place of the normal approximations for the moneyline, run line and total.

Reads features.py's features.csv.gz. Writes preds_v3_<set>.csv.gz with lam_h / lam_a (second stage fit
walk-forward by season) and, for games with lines, the simulated p_home, p_cover (home's run line) and
p_over (opening total), which compare.py uses when present.

  python research/cbase/extras.py <features.csv.gz> <box dir> <out dir>
"""

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

FEATS, BOX, OUT = sys.argv[1:4]
OUT = Path(OUT)
OUT.mkdir(parents=True, exist_ok=True)
P = pd.read_csv(FEATS, low_memory=False)
P["ncaa_id"] = P["ncaa_id"].astype(str)
P["date"] = pd.to_datetime(P["date"])
P["d"] = P["date"].dt.strftime("%Y-%m-%d")


def outs(ip):
    w, _, f = str(ip or "0").partition(".")
    try:
        return int(w or 0) * 3 + int(f or 0)
    except ValueError:
        return 0


def starter_of(ps):
    for p in ps:
        if len(p) > 12 and p[12] and str(p[11]).lower() == "p":
            return p
    for p in ps:
        if len(p) > 12 and p[12]:
            return p
    return None


# ---- bullpen use by team and day ----
relief = defaultdict(float)  # (team, date) -> relief outs
relievers = defaultdict(float)  # (team, date) -> relievers used
for p in sorted(Path(BOX).glob("*.jsonl.gz")):
    with gzip.open(p, "rt") as f:
        for line in f:
            g = json.loads(line)
            for t in g["teams"]:
                sp = starter_of(t["pitchers"])
                if sp is None:
                    continue
                for x in t["pitchers"]:
                    if x is sp:
                        continue
                    relief[(t["seo"], g["date"])] += outs(x[3])
                    relievers[(t["seo"], g["date"])] += 1
day = pd.Timedelta(days=1)


def pen(team, d, back):
    return sum(relief.get((team, (d - k * day).strftime("%Y-%m-%d")), 0.0) for k in range(1, back + 1)) / 3  # innings


for s in ("h", "a"):
    team = P["home"] if s == "h" else P["away"]
    P[f"pen1_{s}"] = [pen(t, d, 1) for t, d in zip(team, P["date"])]
    P[f"pen3_{s}"] = [pen(t, d, 3) for t, d in zip(team, P["date"])]
pair = np.where(P.home < P.away, P.home + "|" + P.away, P.away + "|" + P.home)
P["dh"] = (P.groupby([P.d, pair])["ncaa_id"].transform("count") >= 2).astype(float)
print("bullpen innings yesterday (mean, share > 3):", round(P.pen1_h.mean(), 2), round((P.pen1_h > 3).mean(), 3))

# ---- second stage ----
BASE = ["psp", "pspd", "temp", "wind", "elev", "travel"]
SETS = {
    "v2": BASE,
    "pen": BASE + ["pen"],
    "stretch": BASE + ["stretch"],
    "v3": BASE + ["pen", "stretch", "dh"],
}


def side_rows(D, feats):
    out = []
    for s, o in (("h", "a"), ("a", "h")):
        X = pd.DataFrame(index=D.index)
        X["opp_sp"] = D[f"psp_{o}"].fillna(0)
        X["opp_spd"] = D[f"pspd_{o}"].fillna(0)
        X["temp"] = (D["temp"] - 65).fillna(0)
        X["wind"] = (D["wind"] - 8).fillna(0)
        X["elev"] = D["elev"].fillna(0)
        X["tz_bat"] = D["tzd"].fillna(0) if s == "a" else 0.0
        X["tz_pitch"] = D["tzd"].fillna(0) if s == "h" else 0.0
        X["dist_bat"] = D["dist"].fillna(0) if s == "a" else 0.0
        if "pen" in feats:  # the opponent's bullpen: innings thrown yesterday and over three days
            X["opp_pen1"] = D[f"pen1_{o}"].clip(0, 9)
            X["opp_pen3"] = D[f"pen3_{o}"].clip(0, 20)
        if "stretch" in feats:  # the rating model's own predicted margin for this side
            X["own_margin"] = D[f"lam_{s}"] - D[f"lam_{o}"]
        if "dh" in feats:
            X["dh"] = D["dh"]
        y = (D["hr"] if s == "h" else D["ar"]) - D[f"lam_{s}"]
        out.append((s, X, y))
    return out


base = P[P.lam_h.notna()].copy()
results = {}
for name, feats in SETS.items():
    Q = P.copy()
    for season in sorted(base.season.unique()):
        if season < 2023:
            continue
        train = base[(base.season >= 2022) & (base.season < season)]
        test_idx = base.index[base.season == season]
        Xs, ys = zip(*[(X, y) for _, X, y in side_rows(train, feats)])
        X = pd.concat(Xs).astype(float)
        y = pd.concat(ys).astype(float)
        X1 = np.column_stack([np.ones(len(X)), X.values])
        lam = 50.0 * np.eye(X1.shape[1])
        lam[0, 0] = 0
        beta = np.linalg.solve(X1.T @ X1 + lam, X1.T @ y.values)
        if season == 2026:
            print(f"{name} fit for 2026:", dict(zip(["const"] + list(X.columns), np.round(beta, 3))))
        T = base.loc[test_idx]
        for s, Xt, _ in side_rows(T, feats):
            # intercept kept this time: v2 left it out, and the model's totals ran ~0.25 runs high
            Q.loc[test_idx, f"lam_{s}"] = T[f"lam_{s}"].values + np.column_stack([np.ones(len(Xt)), Xt.values.astype(float)]) @ beta
    results[name] = Q

# ---- run simulation ----
rng = np.random.default_rng(7)
N = 6000


def simulate(lh, la, k):
    """Final runs (home, away) for N games: runs per half-inning negative binomial (mean lam/9, size k)."""

    def half(m, n):
        p = k / (k + m)
        return rng.negative_binomial(k, p, size=n)

    H = np.zeros(N)
    A = np.zeros(N)
    alive = np.ones(N, bool)
    for inn in range(1, 10):
        A += np.where(alive, half(la / 9, N), 0)
        # bottom of the 9th: the home team doesn't bat if ahead; 10-run rule after 7
        bat = alive & ~((inn == 9) & (H > A))
        H += np.where(bat, half(lh / 9, N), 0)
        if inn >= 7:
            alive &= np.abs(H - A) < 10
    tie = H == A
    while tie.any():
        A += np.where(tie, half(la / 9 * 1.4, N), 0)  # extra innings start with a runner on second
        H += np.where(tie, half(lh / 9 * 1.4, N), 0)
        tie = H == A
    return H, A


# dispersion: pick k by the totals' fit on 2023 (no lines that season)
P23 = results["v3"][(results["v3"].season == 2023) & results["v3"].lam_h.notna()].sample(1500, random_state=1)
best = None
for k in (0.4, 0.6, 0.8, 1.0, 1.5):
    ll = 0.0
    for _, r in P23.iterrows():
        H, A = simulate(max(r.lam_h, 0.5), max(r.lam_a, 0.5), k)
        tot = H + A
        x = r.hr + r.ar
        ll -= np.log(max(np.mean(tot == x), 1e-4))
    print(f"k {k}: total log loss {ll / len(P23):.4f}")
    if best is None or ll < best[0]:
        best = (ll, k)
K_DISP = best[1]
print("dispersion k:", K_DISP)

for name, Q in results.items():
    L = Q.index[Q.lam_h.notna() & Q.o_ml_h.notna() & (Q.season >= 2024)]
    ph, pc, po = [], [], []
    for i in L:
        r = Q.loc[i]
        H, A = simulate(max(r.lam_h, 0.5), max(r.lam_a, 0.5), K_DISP)
        ph.append(np.mean(H > A))
        rl = r.o_rl_h
        pc.append(np.mean(H - A + rl > 0) if rl in (-1.5, 1.5) else np.nan)
        t = r.o_tot
        po.append(np.mean(H + A > t) / max(np.mean(H + A != t), 1e-6) if pd.notna(t) else np.nan)
    Q["sim_home"] = np.nan
    Q["sim_cover"] = np.nan
    Q["sim_over"] = np.nan
    Q.loc[L, "sim_home"] = ph
    Q.loc[L, "sim_cover"] = pc
    Q.loc[L, "sim_over"] = po
    Q.drop(columns=[c for c in Q.columns if c.startswith(("pen1_", "pen3_"))]).to_csv(OUT / f"preds_v3_{name}.csv.gz", index=False)
    print("wrote", name)
