"""NHL 1st-period total goals: a shots + goalie model vs the books' opening 1st-period lines.
Features (walk-forward, from earlier games only): each team's recency-weighted 1st-period shots for / against,
whole-game shots for / against (more data), 1st-period goals for / against, the starting goalies' save % (shrunk),
back-to-backs, home. Poisson regression on total 1st-period goals, refit each season on all earlier seasons
(2024-25 in-season games train 2025-26; 2024-26 train 2026-27). P(over) from the Poisson; compared with the
no-vig market chance (ESPN BET 2025-26, priced) and graded at the posted price.
  python3 research/nhl/p1_model.py <nhl-history data dir> <props-history dir>"""
import gzip, json, sys, glob
import numpy as np, pandas as pd
from scipy.stats import poisson
import statsmodels.api as sm

NH, PH = sys.argv[1], sys.argv[2]
G = []
for f in sorted(glob.glob(f"{NH}/nhl-periods-*.jsonl.gz")):
    for l in gzip.open(f, "rt"):
        if l.strip(): G.append(json.loads(l))
G = [g for g in G if g["shots"] and len(g["goals"]["home"]) >= 1 and g["type"] == 2]
G.sort(key=lambda g: g["start"])
print("games:", len(G))

HL = 10
def ew(v, hl=HL):
    if not v: return None
    w = 0.5 ** (np.arange(len(v))[::-1] / hl); return float(np.sum(w * np.array(v)) / w.sum())
team, gk, last_day = {}, {}, {}
rows = []
lg_sv = 0.900
for g in G:
    feats = {}
    ok = True
    for side, opp in (("home", "away"), ("away", "home")):
        t = g[side]
        h = team.get(t, [])[-30:]
        if len(h) < 8: ok = False; break
        feats[side] = dict(s1f=ew([x[0] for x in h]), s1a=ew([x[1] for x in h]), sgf=ew([x[2] for x in h]) / 3, sga=ew([x[3] for x in h]) / 3,
                           g1f=ew([x[4] for x in h]), g1a=ew([x[5] for x in h]))
        st = next((x for x in g["goalies"][side] if x[2]), None)
        hist = gk.get(st[0], [])[-25:] if st else []
        sa = sum(x[0] for x in hist); ga = sum(x[1] for x in hist)
        feats[side]["sv"] = (sa - ga + lg_sv * 400) / (sa + 400)  # shrunk toward the league
        d = pd.Timestamp(g["date"])
        feats[side]["b2b"] = 1.0 if t in last_day and (d - last_day[t]).days == 1 else 0.0
    if ok:
        H, A = feats["home"], feats["away"]
        rows.append(dict(id=g["id"], season=g["season"], date=g["date"], home=g["home"], away=g["away"],
                         y=g["goals"]["home"][0] + g["goals"]["away"][0],
                         shots=(H["s1f"] + A["s1a"]) / 2 + (A["s1f"] + H["s1a"]) / 2,
                         gshots=(H["sgf"] + A["sga"]) / 2 + (A["sgf"] + H["sga"]) / 2,
                         goals=(H["g1f"] + A["g1a"]) / 2 + (A["g1f"] + H["g1a"]) / 2,
                         gk=(1 - H["sv"]) + (1 - A["sv"]), b2b=H["b2b"] + A["b2b"]))
    # update after the game
    for side, opp in (("home", "away"), ("away", "home")):
        sh, go = g["shots"], g["goals"]
        team.setdefault(g[side], []).append((sh[side][0], sh[opp][0], sum(sh[side][:3]), sum(sh[opp][:3]), go[side][0], go[opp][0]))
        for x in g["goalies"][side]:
            if x[4]: gk.setdefault(x[0], []).append((x[4], x[5]))
        last_day[g[side]] = pd.Timestamp(g["date"])
D = pd.DataFrame(rows)
import os
VAR = os.environ.get("VAR", "full")
COLS = {"full": ["ls", "lgs", "goals", "gk", "b2b"], "shots": ["lgs", "gk"], "lean": ["lgs", "gk", "b2b"]}[VAR]
X = lambda d: sm.add_constant(pd.DataFrame({"ls": np.log(d.shots), "lgs": np.log(d.gshots), "goals": d.goals, "gk": d.gk, "b2b": d.b2b})[COLS], has_constant="add")
D["lam"] = np.nan
for s in ("20252026", "20262027"):
    tr = D.season < s; te = D.season == s
    m = sm.GLM(D.y[tr], X(D[tr]), family=sm.families.Poisson()).fit()
    D.loc[te, "lam"] = m.predict(X(D[te]))
    print(s, "coefs", m.params.round(3).to_dict())

# ---- lines: ESPN 1st-period total (props-history), opening main line + prices ----
MAP = {"TB": "TBL", "NJ": "NJD", "LA": "LAK", "SJ": "SJS", "UTAH": "UTA", "UTA": "UTA", "MON": "MTL", "WAS": "WSH", "CLB": "CBJ", "NAS": "NSH", "LV": "VGK", "VEG": "VGK"}
pay = lambda o: (100 / -o if o < 0 else o / 100) if o and o == o else 100 / 110
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)
L = []
for f in sorted(glob.glob(f"{PH}/nhl/*.jsonl.gz")):
    for l in gzip.open(f, "rt"):
        if not l.strip(): continue
        g = json.loads(l)
        h, a = MAP.get(g["home"]["abbr"], g["home"]["abbr"]), MAP.get(g["away"]["abbr"], g["away"]["abbr"])
        day = (pd.Timestamp(g["date"]).tz_localize(None) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")
        for pid, b in g["books"].items():
            pairs = {}
            for r in b["rows"]:
                if r.get("a") or r.get("t") != "1st Period Total Goals" or not r.get("op") or r["op"][0] is None: continue
                p = pairs.setdefault(r["op"][0], [None, None])
                if r["op"][1] is not None: p[0] = r["op"][1]
                if r["op"][2] is not None: p[1] = r["op"][2]
            priced = {k: v for k, v in pairs.items() if v[0] is not None and v[1] is not None}
            if priced:
                line, (o, u) = min(priced.items(), key=lambda kv: abs(imp(kv[1][0]) - imp(kv[1][1])))
            elif pairs:
                line, o, u = sorted(pairs)[len(pairs) // 2], None, None
            else: continue
            L.append(dict(day=day, home=h, away=a, book=b["name"], line=line, o=o, u=u))
L = pd.DataFrame(L).drop_duplicates(["day", "home", "away"])
M = D.merge(L, left_on=["date", "home", "away"], right_on=["day", "home", "away"], how="inner")
M = M[M.lam.notna()].copy()
print("matched games with a 1st-period line:", len(M), M.groupby("season").size().to_dict(), "| unmatched ESPN lines:", len(L) - len(M))
M["p_over"] = 1 - poisson.cdf(np.floor(M.line), M.lam)
M["over"] = M.y > M.line
M["priced"] = M.o.notna() & M.u.notna()
M["mkt"] = np.where(M.priced, M.o.map(lambda x: imp(x) if x == x else np.nan) / (M.o.map(lambda x: imp(x) if x == x else np.nan) + M.u.map(lambda x: imp(x) if x == x else np.nan)), np.nan)
M["o_roi"] = np.where(M.over, M.o.map(pay), -1); M["u_roi"] = np.where(~M.over, M.u.map(pay), -1)
P = M[M.priced]
ll = lambda p, y: -np.mean(y * np.log(np.clip(p, 1e-6, 1)) + (1 - y) * np.log(np.clip(1 - p, 1e-6, 1)))
print(f"\npriced games {len(P)} ({P.book.value_counts().to_dict()}), lines {P.line.value_counts().to_dict()}")
print(f"log loss: model {ll(P.p_over, P.over):.4f}  market (no-vig) {ll(P.mkt, P.over):.4f}  blend 50/50 {ll((P.p_over+P.mkt)/2, P.over):.4f}")
P = P.assign(edge_o=P.p_over - P.mkt)
for e in (0.02, 0.04, 0.06, 0.08):
    o = P[P.edge_o >= e]; u = P[P.edge_o <= -e]
    print(f"  edge {int(e*100)}%+: over {o.over.sum()}-{(~o.over).sum()} ROI {o.o_roi.mean()*100:+.1f}% | under {(~u.over).sum()}-{u.over.sum()} ROI {u.u_roi.mean()*100:+.1f}%")
U = M[~M.priced]
print(f"\nunpriced (2026-27 DraftKings) {len(U)}: accuracy only. Over rate {U.over.mean()*100:.1f}%, model avg P(over) {U.p_over.mean()*100:.1f}%")
for c in (0.55, 0.60, 0.65):
    x = U[U.p_over >= c]; print(f"  model P(over) >= {c:.2f}: overs hit {x.over.mean()*100:.1f}% ({len(x)}) (needs ~60% at -150)")
