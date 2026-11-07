"""
CBB model v2: tempo-free (possession-based) adjusted efficiency, the KenPom-style approach.

For every game we know each team's box score, so possessions = FGA - OREB + TO + 0.475*FTA (the
two teams averaged). Each team gets
  - an offensive and a defensive rating in points per 100 possessions (above/below average),
  - a tempo rating (possessions above/below average),
fitted by iterating over all earlier games of the season (ridge toward last season's ratings,
recent games weighted more). A game is predicted only from games before its day.

  python3 research/cbb/model_v2.py                 -> settings grid, every season, vs close and open
"""
import gzip, json, math, sys, itertools
from datetime import datetime, timedelta
import numpy as np

SEASONS = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]
BAD_BOOKS = {"accuscore", "numberfire", "teamrankings"}


def load(s):
    try:
        rows = [json.loads(l) for l in gzip.open(f"research/cbb/data/{s}.jsonl.gz", "rt")]
    except FileNotFoundError:
        return None
    out = []
    for r in rows:
        if r["h"][1] is None or r["a"][1] is None or r["h"][1] + r["a"][1] <= 0:
            continue
        c = r.get("close")
        if c and str(c[8]).lower() in BAD_BOOKS:
            r.pop("close")
            r.pop("open", None)
        r["day"] = (datetime.fromisoformat(r["date"].replace("Z", "+00:00")) - timedelta(hours=5)).strftime("%Y-%m-%d")
        out.append(r)
    out.sort(key=lambda r: r["date"])
    return out


def poss(b):
    """Possessions from one side's box score [fgm, fga, 3pm, 3pa, ftm, fta, oreb, dreb, tov]."""
    if not b or b[1] is None or b[5] is None or b[6] is None or b[8] is None:
        return None
    return b[1] - b[6] + b[8] + 0.475 * b[5]


def game_poss(r):
    bs = r.get("bs") or {}
    ph, pa = poss(bs.get("h")), poss(bs.get("a"))
    if ph is None or pa is None:
        return None
    p = (ph + pa) / 2
    return p if 45 <= p <= 110 else None


class Season:
    """Arrays for one season (games in date order)."""

    def __init__(self, rows, d1=None):
        self.rows = rows
        ids = sorted({r["h"][0] for r in rows} | {r["a"][0] for r in rows})
        self.ids = ids
        self.slot = {t: i for i, t in enumerate(ids)}
        self.T = len(ids)
        self.H = np.array([self.slot[r["h"][0]] for r in rows])
        self.A = np.array([self.slot[r["a"][0]] for r in rows])
        self.HS = np.array([r["h"][1] for r in rows], float)
        self.AS = np.array([r["a"][1] for r in rows], float)
        self.NEU = np.array([r["neutral"] for r in rows])
        p = [game_poss(r) for r in rows]
        self.has_p = np.array([x is not None for x in p])
        # games without a box score: possessions guessed from the score (about 1.03 points a possession)
        self.P = np.array([x if x is not None else (r["h"][1] + r["a"][1]) / 2 / 1.03 for x, r in zip(p, rows)], float)
        self.days = [r["day"] for r in rows]
        self.dayn = np.array([(datetime.fromisoformat(d) - datetime.fromisoformat(self.days[0])).days for d in self.days])
        # a team counts as Division I if it played at least 10 games this season (non-D-I opponents play 1-3)
        cnt = np.bincount(self.H, minlength=self.T) + np.bincount(self.A, minlength=self.T)
        self.d1 = cnt >= 10 if d1 is None else np.array([t in d1 for t in ids])
        self.nond1 = ~(self.d1[self.H] & self.d1[self.A])


def fit(S, k, P, prior):
    """Ratings from games [0, k) of season S. Returns (avgEff, avgTempo, off, def, tempo) arrays."""
    T = S.T
    off = prior["off"].copy()
    de = prior["def"].copy()
    tp = prior["tempo"].copy()
    if k == 0:
        return prior["eff"], prior["tpo"], off, de, tp
    H, A = S.H[:k], S.A[:k]
    poss_ = S.P[:k]
    effH = S.HS[:k] / poss_ * 100
    effA = S.AS[:k] / poss_ * 100
    now = S.dayn[k - 1]
    w = np.power(0.5, (now - S.dayn[:k]) / P["half_life"]) if P["half_life"] else np.ones(k)
    w = w * np.where(S.nond1[:k], P["nond1_w"], 1.0)
    avg = (np.sum(w * (effH + effA)) / (2 * np.sum(w)) * np.sum(w) + prior["eff"] * 200) / (np.sum(w) + 200)
    tavg = (np.sum(w * poss_) / np.sum(w) * np.sum(w) + prior["tpo"] * 100) / (np.sum(w) + 100)
    h = np.where(S.NEU[:k], 0.0, P["hca_eff"] / 2)
    n = np.bincount(H, weights=w, minlength=T) + np.bincount(A, weights=w, minlength=T)
    wp = P["prior_w"]
    for _ in range(P["iters"]):
        os_ = np.bincount(H, weights=w * (effH - avg - h - de[A]), minlength=T) + np.bincount(A, weights=w * (effA - avg + h - de[H]), minlength=T)
        ds_ = np.bincount(A, weights=w * (effH - avg - h - off[H]), minlength=T) + np.bincount(H, weights=w * (effA - avg + h - off[A]), minlength=T)
        ts_ = np.bincount(H, weights=w * (poss_ - tavg - tp[A]), minlength=T) + np.bincount(A, weights=w * (poss_ - tavg - tp[H]), minlength=T)
        off = (os_ + wp * prior["off"]) / (n + wp)
        de = (ds_ + wp * prior["def"]) / (n + wp)
        tp = (ts_ + wp * prior["tempo"]) / (n + wp)
    return avg, tavg, off, de, tp


def predict(S, g, fitted, P):
    avg, tavg, off, de, tp = fitted
    H, A = S.H[g], S.A[g]
    h = 0 if S.NEU[g] else P["hca_eff"] / 2
    tempo = tavg + tp[H] + tp[A]
    eh = avg + off[H] + de[A] + h
    ea = avg + off[A] + de[H] - h
    return (eh - ea) * tempo / 100, (eh + ea) * tempo / 100


def empty_prior(S, eff=103.0, tpo=68.0):
    z = np.zeros(S.T)
    return {"eff": eff, "tpo": tpo, "off": z.copy(), "def": z.copy(), "tempo": z.copy()}


import os as _os, json as _json
# Returning minutes (research/cbb/returning_minutes.py): RET_MODE=off (default) keeps every team's rating at
# P["shrink"]; "scale" keeps shrink x (team's returning share / the season's average share), clipped 0.2-1.0;
# "scale_tr" also counts incoming D-I transfers' minutes at half weight.
RET_MODE = _os.environ.get("RET_MODE", "off")
_RET_DIR = _os.environ.get("RET_DIR", "")
_ret_cache = {}
def returning(season):
    """{team id: (share of last season's minutes back, incoming transfer minutes as a share)} for a season label."""
    if season in _ret_cache: return _ret_cache[season]
    y = int(season[:4])
    try:
        cur = _json.load(open(f"{_RET_DIR}/cbb-minutes-{season}.json"))["teams"]
        prev = _json.load(open(f"{_RET_DIR}/cbb-minutes-{y-1}-{str(y % 100).zfill(2)}.json"))["teams"]
    except Exception:
        _ret_cache[season] = {}; return {}
    where = {}
    for t, ps in prev.items():
        for a, v in ps.items(): where.setdefault(a, []).append((t, v[1]))
    out = {}
    for t, ps in prev.items():
        tot = sum(v[1] for v in ps.values())
        if tot <= 0: continue
        now = set(cur.get(t, {}))
        back = sum(v[1] for a, v in ps.items() if a in now) / tot
        incoming = sum(m for a in now for (t2, m) in where.get(a, []) if t2 != t) / tot
        out[t] = (back, incoming)
    _ret_cache[season] = out
    return out

def prior_from(prev_S, prev_fit, S, P):
    """Last season's final ratings, shrunk, for teams in this season; new teams start weak."""
    avg, tavg, off, de, tp = prev_fit
    pr = empty_prior(S, avg, tavg)
    ret = returning(P.get("season", "")) if RET_MODE != "off" else {}
    mean_back = (sum(v[0] for v in ret.values()) / len(ret)) if ret else 1.0
    mean_tr = (sum(v[0] + 0.5 * v[1] for v in ret.values()) / len(ret)) if ret else 1.0
    for t, i in S.slot.items():
        j = prev_S.slot.get(t)
        if j is not None and prev_S.d1[j]:
            keep = P["shrink"]
            if t in ret:
                if RET_MODE == "scale": keep = min(1.0, max(0.2, P["shrink"] * ret[t][0] / mean_back))
                if RET_MODE == "scale_tr": keep = min(1.0, max(0.2, P["shrink"] * (ret[t][0] + 0.5 * ret[t][1]) / mean_tr))
            pr["off"][i] = keep * off[j]
            pr["def"][i] = keep * de[j]
            pr["tempo"][i] = P["tshrink"] * tp[j]
        else:
            pr["off"][i] = -P["new_team"] / 2
            pr["def"][i] = P["new_team"] / 2
    return pr


def run_all(P, seasons=SEASONS):
    """Walk-forward predictions for every season: list of (row, margin, total, games_before)."""
    out = {}
    prev = None
    for s in seasons:
        rows = DATA.get(s)
        if rows is None:
            prev = None
            continue
        S = Season(rows)
        prior = prior_from(prev[0], prev[1], S, dict(P, season=s)) if prev else empty_prior(S)
        preds = []
        i = 0
        n = len(rows)
        while i < n:
            j = i
            while j < n and S.days[j] == S.days[i]:
                j += 1
            f = fit(S, i, P, prior)
            for g in range(i, j):
                m, t = predict(S, g, f, P)
                preds.append((rows[g], m, t, i, bool(S.nond1[g])))
            i = j
        # final ratings (unweighted by recency) seed next season
        P2 = dict(P, half_life=0)
        prev = (S, fit(S, n, P2, prior))
        out[s] = preds
    return out


def grade(preds, which="close", sp_min=0, tot_min=0, skip_first_days=0):
    res = {"sp": [0, 0], "tot": [0, 0], "err": [], "lerr": [], "terr": [], "lterr": []}
    first = preds[0][0]["day"] if preds else None
    for r, m, t, k, nd in preds:
        if nd:
            continue
        L = r.get(which)
        if not L:
            continue
        if skip_first_days and (datetime.fromisoformat(r["day"]) - datetime.fromisoformat(first)).days < skip_first_days:
            continue
        mar = r["h"][1] - r["a"][1]
        tot = r["h"][1] + r["a"][1]
        if L[0] is not None:
            res["err"].append(abs(m - mar))
            res["lerr"].append(abs(-L[0] - mar))
            edge = m + L[0]
            if abs(edge) >= sp_min and edge != 0:
                v = mar + L[0]
                if v != 0:
                    res["sp"][0 if (v > 0) == (edge > 0) else 1] += 1
        if L[1] is not None:
            res["terr"].append(abs(t - tot))
            res["lterr"].append(abs(L[1] - tot))
            e = t - L[1]
            if abs(e) >= tot_min and e != 0 and tot != L[1]:
                res["tot"][0 if (tot > L[1]) == (e > 0) else 1] += 1
    f = lambda x: (x[0] / max(1, sum(x)), sum(x))
    return {
        "ats": f(res["sp"]),
        "ou": f(res["tot"]),
        "mae": np.mean(res["err"]) if res["err"] else None,
        "line_mae": np.mean(res["lerr"]) if res["lerr"] else None,
        "tmae": np.mean(res["terr"]) if res["terr"] else None,
        "line_tmae": np.mean(res["lterr"]) if res["lterr"] else None,
    }


DATA = {s: load(s) for s in SEASONS}

BASE = dict(hca_eff=4.0, prior_w=5.0, shrink=0.6, tshrink=0.7, new_team=15.0, half_life=0, nond1_w=0.25, iters=30)

if __name__ == "__main__":
    have = [s for s in SEASONS if DATA[s] is not None]
    print("seasons:", have)
    for s in have:
        rows = DATA[s]
        print(s, len(rows), "games;", sum(1 for r in rows if game_poss(r) is not None), "with box score;",
              sum(1 for r in rows if (r.get("open") or [None])[0] is not None), "with an opening spread")
    grid = [dict(BASE)]
    for k, vals in dict(hca_eff=[3.0, 5.0], prior_w=[3.0, 8.0], shrink=[0.45, 0.75], half_life=[30, 60]).items():
        for v in vals:
            g = dict(BASE)
            g[k] = v
            grid.append(g)
    for P in grid:
        out = run_all(P)
        print({k: P[k] for k in ("hca_eff", "prior_w", "shrink", "half_life")})
        for s, pr in out.items():
            if s == have[0]:
                continue
            c = grade(pr, "close")
            o = grade(pr, "open")
            print(f"   {s}: close MAE model {c['mae']:.2f} line {c['line_mae']:.2f} | ATS {c['ats'][0]:.3f}/{c['ats'][1]} O/U {c['ou'][0]:.3f}"
                  f" || open MAE line {o['line_mae'] or 0:.2f} ATS {o['ats'][0]:.3f}/{o['ats'][1]} O/U {o['ou'][0]:.3f}/{o['ou'][1]}")
