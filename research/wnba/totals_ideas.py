"""Ideas to sharpen the WNBA totals, tested against the closing total (accuracy, 2019-2026) and the
opener (★ record, 2024-2026). python3 research/wnba/totals_ideas.py"""
import numpy as np
from datetime import datetime
src = open("research/wnba/model.py").read().split('if __name__ == "__main__":')[0]
# ratings are fit to "fit" scores when present (luck-adjusted), but graded on real scores
src = src.replace('HS = np.array([r["h"][1] for r in rows], float); AS = np.array([r["a"][1] for r in rows], float)',
                  'HS = np.array([r.get("hfit", r["h"][1]) for r in rows], float); AS = np.array([r.get("afit", r["a"][1]) for r in rows], float)')
exec(src)

def luck(share):
    """Fit on points with opponents' 3-point shooting pulled toward the league rate (share = how much)."""
    for y in YEARS:
        rows = DATA[y]
        made = sum((r.get("bs") or {}).get(k, [0] * 9)[2] or 0 for r in rows for k in "ha")
        att = sum((r.get("bs") or {}).get(k, [0] * 9)[3] or 0 for r in rows for k in "ha")
        p = made / max(1, att)
        for r in rows:
            bs = r.get("bs") or {}
            for side, key in (("h", "hfit"), ("a", "afit")):
                b = bs.get(side)
                if b and b[2] is not None and b[3]:
                    r[key] = r[side][1] - share * 3 * (b[2] - b[3] * p)
                else:
                    r.pop(key, None)

def clear():
    for y in YEARS:
        for r in DATA[y]:
            r.pop("hfit", None); r.pop("afit", None)

def rest_days():
    """Days since each team's previous game (per game: home, away)."""
    out = {}
    for y in YEARS:
        last = {}
        for r in DATA[y]:
            d = datetime.fromisoformat(r["day"])
            out[r["id"]] = tuple((d - last[t]).days if t in last else 9 for t in (r["h"][0], r["a"][0]))
            last[r["h"][0]] = d; last[r["a"][0]] = d
    return out

def score(out, adj=None, edge=3):
    te, le, star = [], [], [0, 0]
    per = {}
    for y in YEARS[1:]:
        for r, m, t, ok in out[y]:
            if adj: t += adj(r)
            c = r.get("close"); tot = r["h"][1] + r["a"][1]
            if c and c[1] is not None:
                te.append(abs(t - tot)); le.append(abs(c[1] - tot))
            o = r.get("open")
            if ok and o and o[1] is not None and abs(t - o[1]) >= edge and tot != o[1]:
                w = (tot > o[1]) == (t > o[1])
                star[0 if w else 1] += 1
                per.setdefault(y, [0, 0])[0 if w else 1] += 1
    return np.mean(te), np.mean(le), star, per

def show(name, out, adj=None):
    te, le, s, per = score(out, adj)
    print(f"{name:<44} total MAE {te:.3f} (close {le:.3f}) | ★ {s[0]}-{s[1]} ({s[0]/max(1,sum(s))*100:.1f}%) " + " ".join(f"{y}:{a}-{b}" for y, (a, b) in sorted(per.items())))

B = dict(BASE, blend=0.5)
clear(); base = run(B); show("baseline (site model)", base)

# 1. rest: how much do totals miss when a team is on a back-to-back?
rd = rest_days()
res = {"b2b": [], "rested": []}
for y in YEARS[1:]:
    for r, m, t, ok in base[y]:
        h, a = rd[r["id"]]; tot = r["h"][1] + r["a"][1]
        res["b2b" if min(h, a) <= 1 else "rested"].append(tot - t)
print("  model miss (actual - model): back-to-back team %.2f (n %d), otherwise %.2f" % (np.mean(res["b2b"]), len(res["b2b"]), np.mean(res["rested"])))
b2b_shift = np.mean(res["b2b"]) - np.mean(res["rested"])
show(f"  + back-to-back adjustment ({b2b_shift:+.1f})", base, lambda r: b2b_shift if min(rd[r["id"]]) <= 1 else 0)

# 2. shooting luck: opponents' 3-point % pulled toward league average when fitting ratings
for share in (0.5, 1.0):
    luck(share); show(f"luck-adjusted 3PT ({int(share*100)}% toward league)", run(B))
clear()

# 3. recency and blend weight
for hl in (15, 45):
    show(f"half-life {hl} days", run(dict(B, hl=hl)))
for bw in (0.3, 0.7):
    show(f"market blend {bw}", run(dict(B, blend=bw)))
for sh in (0.4, 0.8):
    show(f"prior kept {int(sh*100)}%", run(dict(B, shrink=sh)))
