"""Walk-forward: each season, bet unders (or overs) only in conferences whose earlier seasons leaned that way.
Rule fixed in advance: a conference qualifies if its earlier conference games hit the side >= 53% with p < 0.10."""
import gzip, json, glob, os
from math import erf, sqrt
import pandas as pd

CACHE = "research/conferences/data/cbb_conf_games.csv"
if not os.path.exists(CACHE):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    rows = []
    for f in sorted(glob.glob("research/cbb/data/20*.jsonl.gz")):
        s = int(f.split("/")[-1][:4])
        teams = {t["id"]: t.get("conf") for t in json.load(open(f.replace(".jsonl.gz", "-teams.json")))}
        for l in gzip.open(f, "rt"):
            if '"close"' not in l: continue
            r = json.loads(l)
            ch = teams.get(r["h"][0])
            if ch is None or ch != teams.get(r["a"][0]) or r["h"][1] is None or r["a"][1] is None: continue
            rows.append(dict(season=s, conf=ch, pts=r["h"][1] + r["a"][1], close=(r.get("close") or [None, None])[1], open=(r.get("open") or [None, None])[1]))
    pd.DataFrame(rows).to_csv(CACHE, index=False)
d = pd.read_csv(CACHE)

def pv(w, n):
    z = (w - n / 2) / sqrt(n / 4); return 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))

for line in ("close", "open"):
    g = d[d[line].notna() & (d.pts != d[line])].copy()
    g["under"] = g.pts < g[line]
    seasons = sorted(g.season.unique())
    tot_w = tot_l = 0
    print(f"\nvs the {line.upper()} total")
    for s in seasons:
        past = g[g.season < s]
        if past.season.nunique() < 2: continue  # need 2+ earlier seasons
        picks = []
        for c, p in past.groupby("conf"):
            n, u = len(p), int(p.under.sum())
            if u / n >= 0.53 and pv(u, n) < 0.10: picks.append((c, "under"))
            if (n - u) / n >= 0.53 and pv(n - u, n) < 0.10: picks.append((c, "over"))
        now = g[g.season == s]
        w = l = 0
        for c, side in picks:
            x = now[now.conf == c]
            hit = x.under if side == "under" else ~x.under
            w += int(hit.sum()); l += int((~hit).sum())
        tot_w += w; tot_l += l
        print(f"  {s}-{str(s+1)[2:]}: {len(picks)} conference picks {picks} -> {w}-{l} ({w/max(1,w+l)*100:.1f}%)")
    n = tot_w + tot_l
    print(f"  TOTAL out of sample: {tot_w}-{tot_l} ({tot_w/max(1,n)*100:.1f}%), units {tot_w*100/110 - tot_l:+.1f}u, p {pv(tot_w, n) if n else float('nan'):.2f}")
