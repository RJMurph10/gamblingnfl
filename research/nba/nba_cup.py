"""NBA Cup deep dive (2023-24 on): do favorites win and cover more in Cup games than in ordinary games, and do
totals behave differently? Cup group games count in the standings, and group ties are broken by point
differential, so good teams may keep pushing late. Lines: ESPN opening and closing (props-history/nba-lines).
Control: the same season's non-Cup regular-season games from November to mid-December (same part of the season).
  python3 research/nba/nba_cup.py <dir with nba-lines-*.json>"""
import json, sys, glob
from math import erf, sqrt
import numpy as np, pandas as pd

D = pd.concat([pd.DataFrame(json.load(open(f))) for f in sorted(glob.glob(f"{sys.argv[1]}/nba-lines-*.json"))], ignore_index=True)
D["dt"] = pd.to_datetime(D.date).dt.tz_localize(None)
D["cup"] = D.note.fillna("").str.contains("cup|in-season", case=False)
D["stage"] = np.where(~D.cup, "", np.where(D.note.fillna("").str.contains("group", case=False), "group", "knockout"))
for k, i in (("sp", 0), ("tot", 1), ("mlh", 2), ("mla", 3)):
    D[f"o_{k}"] = D.open.map(lambda x: x[i] if isinstance(x, list) else None)
    D[f"c_{k}"] = D.close.map(lambda x: x[i] if isinstance(x, list) else None)
D["margin"] = D.hs - D["as"]; D["pts"] = D.hs + D["as"]
print(D.groupby("season").agg(games=("id", "size"), cup=("cup", "sum"), open_lines=("o_sp", lambda s: s.notna().sum())).to_string())
print(D[D.cup].groupby(["season", "stage"]).size().to_string())

imp = lambda o: (-o / (-o + 100) if o < 0 else 100 / (o + 100)) if o == o and o is not None else np.nan
def pv(w, n, p=0.5):
    if n == 0: return float("nan")
    z = (w - n * p) / sqrt(n * p * (1 - p)); return 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))

def summary(d, pre):
    sp, tot = d[f"{pre}_sp"], d[f"{pre}_tot"]
    x = d[sp.notna() & (sp != 0)].copy()
    fav_home = x[f"{pre}_sp"] < 0
    x["fav_margin"] = np.where(fav_home, x.margin, -x.margin)
    x["fav_line"] = x[f"{pre}_sp"].abs()
    x["fav_cov"] = x.fav_margin - x.fav_line
    c = x[x.fav_cov != 0]
    w, n = int((c.fav_cov > 0).sum()), len(c)
    # straight-up wins vs the no-vig moneyline expectation
    m = x[x[f"{pre}_mlh"].notna() & x[f"{pre}_mla"].notna()].copy()
    ph = m[f"{pre}_mlh"].map(imp); pa = m[f"{pre}_mla"].map(imp)
    m["p_fav"] = np.where(m[f"{pre}_sp"] < 0, ph / (ph + pa), pa / (ph + pa))
    m["fav_won"] = np.where(m[f"{pre}_sp"] < 0, m.margin > 0, m.margin < 0)
    t = d[tot.notna() & (d.pts != tot)]
    ov = int((t.pts > t[f"{pre}_tot"]).sum())
    big = c[c.fav_line >= 7]
    return (f"fav ATS {w}-{n-w} ({w/max(1,n)*100:.1f}%, p={pv(w,n):.2f}) | fav margin vs line {x.fav_cov.mean():+.2f} | "
            f"fav SU {m.fav_won.mean()*100:.1f}% vs expected {m.p_fav.mean()*100:.1f}% | "
            f"big favs (7+) ATS {(big.fav_cov>0).sum()}-{(big.fav_cov<0).sum()} | overs {ov}-{len(t)-ov} ({ov/max(1,len(t))*100:.1f}%), pts vs total {(t.pts - t[f'{pre}_tot']).mean():+.1f}")

for pre, lab in (("o", "OPENING"), ("c", "CLOSING")):
    print(f"\n===== vs the {lab} line")
    for s in sorted(D.season.unique()):
        S = D[(D.season == s) & (D.type == 2)]
        cup = D[(D.season == s) & D.cup]
        if not len(cup): continue
        lo, hi = cup.dt.min() - pd.Timedelta(days=7), cup[cup.stage == "group"].dt.max() + pd.Timedelta(days=14)
        ctrl = S[~S.cup & (S.dt >= lo) & (S.dt <= hi)]
        print(f" {s}")
        print(f"   Cup group ({(cup.stage=='group').sum():3d})  " + summary(cup[cup.stage == "group"], pre))
        if (cup.stage == "knockout").any(): print(f"   Cup knockout ({(cup.stage=='knockout').sum():2d}) " + summary(cup[cup.stage == "knockout"], pre))
        print(f"   other games ({len(ctrl):3d}) " + summary(ctrl, pre))
    allcup = D[D.cup & (D.stage == "group")]
    print(f" ALL SEASONS Cup group ({len(allcup)}): " + summary(allcup, pre))
    allko = D[D.cup & (D.stage == "knockout")]
    print(f" ALL SEASONS Cup knockout ({len(allko)}): " + summary(allko, pre))
    ctrl_all = pd.concat([D[(D.season == s) & (D.type == 2) & ~D.cup & (D.dt >= D[(D.season == s) & D.cup].dt.min() - pd.Timedelta(days=7)) &
                            (D.dt <= D[(D.season == s) & D.cup & (D.stage == "group")].dt.max() + pd.Timedelta(days=14))] for s in D[D.cup].season.unique()])
    print(f" ALL SEASONS other Nov-Dec games ({len(ctrl_all)}): " + summary(ctrl_all, pre))
