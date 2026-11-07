"""Team-specific home court (men's CBB): does a team's home cover margin vs the CLOSING spread in earlier seasons
(home games only, shrunk toward 0) predict its home covers vs the OPENER this season? And does adding it to the
blend sharpen the 6+ spread pick?
  python3 research/cbb/home_court.py"""
import sys, json, gzip; sys.path.insert(0, "research/cbb")
import numpy as np, pandas as pd
SEAS = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]
rows = []
for s in SEAS:
    for l in gzip.open(f"research/cbb/data/{s}.jsonl.gz", "rt"):
        r = json.loads(l)
        if r.get("neutral") or r["h"][1] is None: continue
        c = r.get("close") or [None, None]; o = r.get("open") or [None, None]
        rows.append(dict(season=s, home=r["h"][0], margin=r["h"][1] - r["a"][1], close=c[0], open=o[0], conf=bool(r.get("conf"))))
D = pd.DataFrame(rows)
D["close"] = pd.to_numeric(D.close, errors="coerce"); D["open"] = pd.to_numeric(D.open, errors="coerce")
D["cov_c"] = D.margin + D.close; D["cov_o"] = D.margin + D.open   # home spread: negative = home favored
out = []
for i, s in enumerate(SEAS):
    if i < 2: continue
    past = D[D.season.isin(SEAS[:i]) & D.cov_c.notna()]
    g = past.groupby("home").cov_c.agg(["sum", "count"])
    K = 40
    hca = (g["sum"] / (g["count"] + K)).to_dict()
    cur = D[(D.season == s)].copy()
    cur["hca"] = cur.home.map(hca).fillna(0)
    out.append(cur)
E = pd.concat(out)
print("Does a team's past home cover margin (shrunk, K=40) predict this season's home cover?")
for key, lab in (("cov_c", "vs CLOSE"), ("cov_o", "vs OPENER")):
    d = E[E[key].notna() & (E[key] != 0)]
    print(f"\n  {lab}: corr {np.corrcoef(d.hca, d[key])[0,1]:+.3f} (n={len(d)})")
    for lo, hi in ((-99, -1.5), (-1.5, -0.5), (-0.5, 0.5), (0.5, 1.5), (1.5, 99)):
        x = d[(d.hca >= lo) & (d.hca < hi)]
        by = " ".join(f"{s[2:4]}:{(g[key]>0).mean()*100:.0f}%" for s, g in x.groupby("season"))
        print(f"    past home edge {lo:+.1f} to {hi:+.1f}: home covers {(x[key]>0).mean()*100:5.1f}% (n={len(x)})  {by}")
