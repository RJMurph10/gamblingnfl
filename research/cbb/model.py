"""
Walk-forward test of the CBB ratings model against closing lines (research/cbb/data, from the
cbb-history branch). Each game is predicted only from games before its day.

  python3 research/cbb/model.py            -> grid of settings, all four seasons
"""
import gzip, json, sys, itertools, math
import numpy as np

SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]


def load(s):
    rows = [json.loads(l) for l in gzip.open(f"research/cbb/data/{s}.jsonl.gz", "rt")]
    rows = [r for r in rows if r["h"][1] is not None and r["a"][1] is not None and r["h"][1] + r["a"][1] > 0]
    for r in rows:
        c = r.get("close")
        if c and c[8] == "accuscore":
            r.pop("close")
    return rows


DATA = {s: load(s) for s in SEASONS}


def day(r):
    # US Eastern-ish day: shift 5h
    from datetime import datetime, timedelta
    d = datetime.fromisoformat(r["date"].replace("Z", "+00:00")) - timedelta(hours=5)
    return d.strftime("%Y-%m-%d")


def fit(games, ids, prior_off, prior_def, avg, hca, w_prior, iters=30):
    """Ridge-style offense/defense ratings (points above average), like the NBA model."""
    T = len(ids)
    off = prior_off.copy()
    de = prior_def.copy()
    if not len(games):
        return off, de
    H, A, HS, AS, NEU = games
    h = np.where(NEU, 0.0, hca / 2)
    n = np.bincount(H, minlength=T) + np.bincount(A, minlength=T)
    for _ in range(iters):
        os_ = np.bincount(H, weights=HS - avg - h - de[A], minlength=T) + np.bincount(A, weights=AS - avg + h - de[H], minlength=T)
        ds_ = np.bincount(A, weights=HS - avg - h - off[H], minlength=T) + np.bincount(H, weights=AS - avg + h - off[A], minlength=T)
        off = (os_ + w_prior * prior_off) / (n + w_prior)
        de = (ds_ + w_prior * prior_def) / (n + w_prior)
    return off, de


def season_ratings(rows, slot, avg, hca, w):
    T = len(slot)
    H = np.array([slot[r["h"][0]] for r in rows])
    A = np.array([slot[r["a"][0]] for r in rows])
    HS = np.array([r["h"][1] for r in rows], float)
    AS = np.array([r["a"][1] for r in rows], float)
    NEU = np.array([r["neutral"] for r in rows])
    return fit((H, A, HS, AS, NEU), slot, np.zeros(T), np.zeros(T), avg, hca, w)


def run(season, prev, P):
    rows = sorted(DATA[season], key=lambda r: r["date"])
    ids = sorted({r["h"][0] for r in rows} | {r["a"][0] for r in rows})
    slot = {t: i for i, t in enumerate(ids)}
    T = len(ids)
    avg0 = np.mean([r["h"][1] + r["a"][1] for r in rows]) / 2  # only used as a fallback below
    prior_off = np.zeros(T)
    prior_def = np.zeros(T)
    prev_avg = None
    if prev:
        prow = DATA[prev]
        pids = sorted({r["h"][0] for r in prow} | {r["a"][0] for r in prow})
        pslot = {t: i for i, t in enumerate(pids)}
        prev_avg = np.mean([r["h"][1] + r["a"][1] for r in prow]) / 2
        po, pd = season_ratings(prow, pslot, prev_avg, P["hca"], 3)
        for t, i in slot.items():
            if t in pslot:
                prior_off[i] = P["shrink"] * po[pslot[t]]
                prior_def[i] = P["shrink"] * pd[pslot[t]]
            else:
                # not D-I last season (or new): a weak team
                prior_off[i] = P["new_off"]
                prior_def[i] = -P["new_off"]
    base_avg = prev_avg if prev_avg else 70.0
    H = np.array([slot[r["h"][0]] for r in rows])
    A = np.array([slot[r["a"][0]] for r in rows])
    HS = np.array([r["h"][1] for r in rows], float)
    AS = np.array([r["a"][1] for r in rows], float)
    NEU = np.array([r["neutral"] for r in rows])
    days = [day(r) for r in rows]
    out = []
    i = 0
    while i < len(rows):
        j = i
        while j < len(rows) and days[j] == days[i]:
            j += 1
        k = i  # games before this day
        sc = (HS[:k].sum() + AS[:k].sum())
        avg = (base_avg * 300 + sc) / (300 + 2 * k)
        off, de = fit((H[:k], A[:k], HS[:k], AS[:k], NEU[:k]), slot, prior_off, prior_def, avg, P["hca"], P["w"])
        for g in range(i, j):
            h = 0 if NEU[g] else P["hca"] / 2
            hs = avg + off[H[g]] + de[A[g]] + h
            as_ = avg + off[A[g]] + de[H[g]] - h
            out.append((rows[g], hs - as_, hs + as_, k))
        i = j
    return out


def grade(preds, P, min_games=0, sp_min=None, tot_min=None):
    sp_min = P.get("sp_min", 2) if sp_min is None else sp_min
    tot_min = P.get("tot_min", 3) if tot_min is None else tot_min
    S = [0, 0]; Tt = [0, 0]; ML = [0, 0, 0.0]; err = []; terr = []
    for r, m, t, k in preds:
        c = r.get("close")
        if not c:
            continue
        mar = r["h"][1] - r["a"][1]
        tot = r["h"][1] + r["a"][1]
        if c[0] is not None:
            err.append(abs(m - mar))
            edge = m + c[0]
            if abs(edge) >= sp_min:
                v = mar + c[0]
                if v != 0:
                    S[0 if (v > 0) == (edge > 0) else 1] += 1
        if c[1] is not None:
            terr.append(abs(t - tot))
            e = t - c[1]
            if abs(e) >= tot_min and tot != c[1]:
                Tt[0 if (tot > c[1]) == (e > 0) else 1] += 1
        if c[2] is not None and c[3] is not None and mar != 0:
            ph = m >= 0
            price = c[2] if ph else c[3]
            won = (mar > 0) == ph
            ML[0 if won else 1] += 1
            ML[2] += (price / 100 if price > 0 else 100 / -price) if won else -1
    f = lambda x: x[0] / max(1, x[0] + x[1])
    return dict(spread=(f(S), S[0] + S[1], (S[0] * 100 / 110 - S[1])), total=(f(Tt), Tt[0] + Tt[1], (Tt[0] * 100 / 110 - Tt[1])), ml=(f(ML), ML[0] + ML[1], ML[2]), mae=np.mean(err) if err else None, tmae=np.mean(terr) if terr else None)


if __name__ == "__main__":
    base = dict(hca=3.0, shrink=0.6, w=6, new_off=-6)
    grid = [dict(base)]
    for k, vals in dict(hca=[2.5, 3.5], shrink=[0.4, 0.8], w=[3, 10], new_off=[-3, -10]).items():
        for v in vals:
            g = dict(base); g[k] = v; grid.append(g)
    for P in grid:
        tot = {}
        line = []
        for i, s in enumerate(SEASONS[1:], 1):
            pr = run(s, SEASONS[i - 1], P)
            g = grade(pr, P)
            line.append(f"{s}: ATS {g['spread'][0]:.3f}/{g['spread'][1]} O/U {g['total'][0]:.3f}/{g['total'][1]} ML {g['ml'][2]:+.0f}u mae {g['mae']:.2f} tmae {g['tmae']:.2f}")
        print(P)
        print("   " + "\n   ".join(line))
