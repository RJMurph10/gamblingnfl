"""MAAC unders by membership: games between long-time members vs games with a newer member."""
import gzip, json, glob
from collections import defaultdict
confs = {}
for f in sorted(glob.glob("research/cbb/data/20*-teams.json")):
    s = int(f.split("/")[-1][:4])
    for t in json.load(open(f)): confs[(s, t["id"])] = (t.get("conf"), t["short"])
first = {}
for (s, t), (c, _) in sorted(confs.items()):
    if c == "13" and t not in first: first[t] = s
print("MAAC members (first season seen in the MAAC, data starts 2019):", sorted((v, confs[(v, k)][1]) for k, v in first.items()))
out = defaultdict(lambda: [0, 0])
for f in sorted(glob.glob("research/cbb/data/20*.jsonl.gz")):
    s = int(f.split("/")[-1][:4])
    if s < 2021: continue
    for l in gzip.open(f, "rt"):
        if '"close"' not in l: continue
        r = json.loads(l)
        h, a = r["h"][0], r["a"][0]
        if confs.get((s, h), (None,))[0] != "13" or confs.get((s, a), (None,))[0] != "13": continue
        L = (r.get("close") or [None, None])[1]
        if L is None or r["h"][1] is None: continue
        pts = r["h"][1] + r["a"][1]
        if pts == L: continue
        newer = first[h] > 2019 or first[a] > 2019
        out[("with a newer member" if newer else "original members only", s)][0 if pts < L else 1] += 1
for k in sorted(out): print(f"  {k[1]}-{str(k[1]+1)[2:]} {k[0]:<24} unders {out[k][0]}-{out[k][1]}")
for grp in ("original members only", "with a newer member"):
    w = sum(v[0] for k, v in out.items() if k[0] == grp); l = sum(v[1] for k, v in out.items() if k[0] == grp)
    print(f"  TOTAL {grp:<24} {w}-{l} ({w/(w+l)*100:.1f}%)")
