"""Women's college basketball: the men's CBB model (research/cbb/model_v2.py, v3 market blend) run
unchanged on women's D-I seasons (research/wcbb/data, from the wcbb-history branch).
python3 research/wcbb/model.py"""
import numpy as np, sys
from math import erf, sqrt

SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]
src = open("research/cbb/model_v2.py").read().split('if __name__ == "__main__":')[0]
src = src.replace('SEASONS = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]', f"SEASONS = {SEASONS!r}")
src = src.replace('research/cbb/data/', 'research/wcbb/data/')
src = src.replace('def empty_prior(S, eff=103.0, tpo=68.0):', 'def empty_prior(S, eff=98.0, tpo=70.0):')
g = {}
exec(src, g)
mk_src = open("research/cbb/v3_market.py").read()
mk_src = mk_src[mk_src.index("def market_preds"):mk_src.index('for s in ["2023-24"')]
g["m"] = type("M", (), {"Season": g["Season"]})
exec(mk_src, g)
market_preds = g["market_preds"]

def pv(w, n):
    z = (w - n / 2) / sqrt(n / 4) if n else 0; return 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))

DATA = g["DATA"]
for s in SEASONS:
    rows = DATA[s] or []
    print(s, len(rows), "games;", sum(1 for r in rows if r.get("close") and r["close"][1] is not None), "closing totals;",
          sum(1 for r in rows if r.get("open") and r["open"][1] is not None), "opening totals;", sum(1 for r in rows if r.get("bs")), "box scores")

P = dict(g["BASE"], shrink=0.75, half_life=30)
out = g["run_all"](P)
test = [s for s in SEASONS[1:] if DATA[s]]
print("\nAccuracy at the close (efficiency model alone):")
for s in test:
    c = g["grade"](out[s], "close")
    print(f"  {s}: total MAE model {c['tmae']:.2f} vs closing line {c['line_tmae']:.2f} | margin {c['mae']:.2f} vs {c['line_mae']:.2f}")

print("\nTotals, blended 50/50 with the market's view, both teams 3+ games:")
for which in ("close", "open"):
    for th in (2, 3, 4, 6, 8):
        W = L = 0; per = []
        for s in test:
            mk = market_preds(DATA[s])
            w = l = 0
            for x, y in zip(out[s], mk):
                r = x[0]
                if x[4] or not y[2]: continue
                ln = (r.get(which) or [None, None])[1]
                if ln is None: continue
                t = 0.5 * x[2] + 0.5 * y[1]; tot = r["h"][1] + r["a"][1]
                if abs(t - ln) < th or tot == ln: continue
                if (tot > ln) == (t > ln): w += 1
                else: l += 1
            if w + l: per.append(f"{s}:{w}-{l}")
            W += w; L += l
        if W + L:
            print(f"  vs {which:<5} {th}+: {W}-{L} ({W/(W+L)*100:.1f}%, {W*100/110-L:+.1f}u, p {pv(W, W+L):.3f})  " + " ".join(per))
