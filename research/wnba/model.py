"""WNBA model research: per-possession ratings (like CBB v2) walk-forward, optionally blended with the
market's view (ratings fit to earlier closing lines, like CBB v3). Graded vs closing and opening lines.
python3 research/wnba/model.py"""
import gzip, json, sys
from datetime import datetime, timedelta
from math import erf, sqrt
import numpy as np

YEARS = list(range(2018, 2027))

def load(y):
    rows = [json.loads(l) for l in gzip.open(f"research/wnba/data/{y}.jsonl.gz", "rt")]
    rows = [r for r in rows if r["h"][1] is not None and r["a"][1] is not None and r["h"][1] + r["a"][1] > 0]
    for r in rows:
        r["day"] = (datetime.fromisoformat(r["date"].replace("Z", "+00:00")) - timedelta(hours=5)).strftime("%Y-%m-%d")
    rows.sort(key=lambda r: r["date"])
    cnt = {}
    for r in rows:
        for t in (r["h"][0], r["a"][0]): cnt[t] = cnt.get(t, 0) + 1
    return [r for r in rows if cnt[r["h"][0]] >= 10 and cnt[r["a"][0]] >= 10]  # drops the All-Star game

def poss(b):
    if not b or None in (b[1], b[5], b[6], b[8]): return None
    return b[1] - b[6] + b[8] + 0.44 * b[5]

def game_poss(r):
    bs = r.get("bs") or {}
    ph, pa = poss(bs.get("h")), poss(bs.get("a"))
    if ph is None or pa is None: return None
    p = (ph + pa) / 2
    return p if 55 <= p <= 110 else None

DATA = {y: load(y) for y in YEARS}

def run(P):
    """Walk-forward predictions per season: list of (row, margin, total, market_ok)."""
    out, prev = {}, None
    for y in YEARS:
        rows = DATA[y]
        ids = sorted({r["h"][0] for r in rows} | {r["a"][0] for r in rows})
        slot = {t: i for i, t in enumerate(ids)}; T = len(ids)
        H = np.array([slot[r["h"][0]] for r in rows]); A = np.array([slot[r["a"][0]] for r in rows])
        HS = np.array([r["h"][1] for r in rows], float); AS = np.array([r["a"][1] for r in rows], float)
        NEU = np.array([bool(r.get("neutral")) for r in rows])
        PP = np.array([game_poss(r) or (r["h"][1] + r["a"][1]) / 2 / 1.0 for r in rows], float)
        days = [r["day"] for r in rows]
        dn = np.array([(datetime.fromisoformat(d) - datetime.fromisoformat(days[0])).days for d in days])
        # prior: last season's final ratings shrunk; expansion teams start below average
        p_off, p_def, p_tp = np.zeros(T), np.zeros(T), np.zeros(T)
        p_eff, p_tpo = (prev["eff"], prev["tpo"]) if prev else (102.0, 80.0)
        if prev:
            for t, i in slot.items():
                if t in prev["slot"]:
                    j = prev["slot"][t]
                    p_off[i] = P["shrink"] * prev["off"][j]; p_def[i] = P["shrink"] * prev["def"][j]; p_tp[i] = 0.7 * prev["tp"][j]
                else:
                    p_off[i] = -P["new_team"] / 2; p_def[i] = P["new_team"] / 2
        def fit(k, hl):
            off, de, tp = p_off.copy(), p_def.copy(), p_tp.copy()
            if k == 0: return p_eff, p_tpo, off, de, tp
            h_, a_, po = H[:k], A[:k], PP[:k]
            eH, eA = HS[:k] / po * 100, AS[:k] / po * 100
            w = np.power(0.5, (dn[k - 1] - dn[:k]) / hl) if hl else np.ones(k)
            avg = (np.sum(w * (eH + eA)) / 2 + p_eff * 100) / (np.sum(w) + 100)
            tav = (np.sum(w * po) + p_tpo * 50) / (np.sum(w) + 50)
            hc = np.where(NEU[:k], 0, P["hca"] / 2)
            n = np.bincount(h_, w, T) + np.bincount(a_, w, T); wp = P["prior_w"]
            for _ in range(30):
                os_ = np.bincount(h_, w * (eH - avg - hc - de[a_]), T) + np.bincount(a_, w * (eA - avg + hc - de[h_]), T)
                ds_ = np.bincount(a_, w * (eH - avg - hc - off[h_]), T) + np.bincount(h_, w * (eA - avg + hc - off[a_]), T)
                ts_ = np.bincount(h_, w * (po - tav - tp[a_]), T) + np.bincount(a_, w * (po - tav - tp[h_]), T)
                off = (os_ + wp * p_off) / (n + wp); de = (ds_ + wp * p_def) / (n + wp); tp = (ts_ + wp * p_tp) / (n + wp)
            return avg, tav, off, de, tp
        def market(k):
            """Ratings fit to earlier closing lines (margin and total)."""
            lm = [(i, -r["close"][0]) for i, r in enumerate(rows[:k]) if r.get("close") and r["close"][0] is not None]
            lt = [(i, r["close"][1]) for i, r in enumerate(rows[:k]) if r.get("close") and r["close"][1] is not None]
            if len(lm) < 20: return None
            w = lambda i: 0.5 ** ((dn[k - 1] - dn[i]) / P["hl"])
            rm, rt = np.zeros(T), np.zeros(T); mu = np.mean([v for _, v in lt])
            for _ in range(30):
                sm, st_, nn = np.zeros(T), np.zeros(T), np.zeros(T)
                for i, y_ in lm:
                    hc = 0 if NEU[i] else P["mhome"]; wi = w(i)
                    sm[H[i]] += wi * (y_ - hc + rm[A[i]]); sm[A[i]] += wi * (-(y_ - hc) + rm[H[i]]); nn[H[i]] += wi; nn[A[i]] += wi
                rm = sm / (nn + 2)
                nt = np.zeros(T)
                for i, y_ in lt:
                    wi = w(i); st_[H[i]] += wi * (y_ - mu - rt[A[i]]); st_[A[i]] += wi * (y_ - mu - rt[H[i]]); nt[H[i]] += wi; nt[A[i]] += wi
                rt = st_ / (nt + 2)
            return mu, rm, rt
        preds = []
        played = np.zeros(T)
        i, n = 0, len(rows)
        while i < n:
            j = i
            while j < n and days[j] == days[i]: j += 1
            avg, tav, off, de, tp = fit(i, P["hl"])
            mk = market(i) if P["blend"] else None
            for g in range(i, j):
                h, a = H[g], A[g]; hc = 0 if NEU[g] else P["hca"] / 2
                tempo = tav + tp[h] + tp[a]
                eh, ea = avg + off[h] + de[a] + hc, avg + off[a] + de[h] - hc
                m, t = (eh - ea) * tempo / 100, (eh + ea) * tempo / 100
                ok = mk is not None and played[h] >= P["min_g"] and played[a] >= P["min_g"]
                if ok:
                    mu, rm, rt = mk
                    m = P["blend"] * (rm[h] - rm[a] + (0 if NEU[g] else P["mhome"])) + (1 - P["blend"]) * m
                    t = P["blend"] * (mu + rt[h] + rt[a]) + (1 - P["blend"]) * t
                preds.append((rows[g], m, t, ok))
            for g in range(i, j): played[H[g]] += 1; played[A[g]] += 1
            i = j
        avg, tav, off, de, tp = fit(n, 0)
        prev = dict(eff=avg, tpo=tav, off=off, de=de, tp=tp, slot=slot)
        prev["def"] = de
        out[y] = preds
    return out

def pv(w, n):
    z = (w - n / 2) / sqrt(n / 4) if n else 0; return 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))

def grade(preds, which, sp_min, tot_min, need_market=False):
    s = [0, 0]; t = [0, 0]; me, le, te, lte = [], [], [], []
    for r, m, tt, ok in preds:
        if need_market and not ok: continue
        L = r.get(which)
        if not L: continue
        mar = r["h"][1] - r["a"][1]; tot = r["h"][1] + r["a"][1]
        if L[0] is not None:
            me.append(abs(m - mar)); le.append(abs(-L[0] - mar))
            e = m + L[0]
            if abs(e) >= sp_min and mar + L[0] != 0: s[0 if (mar + L[0] > 0) == (e > 0) else 1] += 1
        if L[1] is not None:
            te.append(abs(tt - tot)); lte.append(abs(L[1] - tot))
            e = tt - L[1]
            if abs(e) >= tot_min and tot != L[1]: t[0 if (tot > L[1]) == (e > 0) else 1] += 1
    return s, t, np.mean(me), np.mean(le), np.mean(te), np.mean(lte)

BASE = dict(hca=4.0, prior_w=5, shrink=0.6, new_team=10.0, hl=30, blend=0.0, mhome=2.5, min_g=3)
if __name__ == "__main__":
    for name, P in [("efficiency only", dict(BASE)), ("blend 0.5", dict(BASE, blend=0.5))]:
        out = run(P)
        print(f"\n== {name} ==")
        for y in YEARS[1:]:
            s, t, me, le, te, lte = grade(out[y], "close", 0, 0)
            print(f"  {y} close: margin MAE model {me:.2f} line {le:.2f} | total MAE model {te:.2f} line {lte:.2f}")
        for which in ("close", "open"):
            for sp, tm in [(2, 3), (4, 6), (6, 9)]:
                S = [0, 0]; Tt = [0, 0]; per = []
                for y in YEARS[1:]:
                    s, t, *_ = grade(out[y], which, sp, tm, need_market=P["blend"] > 0)
                    S[0] += s[0]; S[1] += s[1]; Tt[0] += t[0]; Tt[1] += t[1]
                    if sum(t): per.append(f"{y}:{t[0]}-{t[1]}")
                if S[1] + S[0] == 0: continue
                print(f"  vs {which} spread {sp}+: {S[0]}-{S[1]} ({S[0]/max(1,sum(S))*100:.1f}%) | total {tm}+: {Tt[0]}-{Tt[1]} ({Tt[0]/max(1,sum(Tt))*100:.1f}%, p {pv(Tt[0], sum(Tt)):.2f})  {' '.join(per)}")
