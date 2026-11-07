"""Builds src/data/cbb/home-edge.ts: each team's home edge beyond the market's flat home court, in points =
its home cover margin vs the CLOSING spread over past seasons' home games (not neutral sites), shrunk toward 0
by K=40 games: sum / (games + 40). Research: research/cbb/home_court.py, spreads_sharpen.py (HCA_W=1).
  python3 scripts/cbb/home_edge.py <dir with <season>.jsonl.gz> 2019-20 2025-26"""
import gzip, json, sys
D, first, last = sys.argv[1], sys.argv[2], sys.argv[3]
y0, y1 = int(first[:4]), int(last[:4])
tot, n = {}, {}
for y in range(y0, y1 + 1):
    s = f"{y}-{str((y + 1) % 100).zfill(2)}"
    try: f = gzip.open(f"{D}/{s}.jsonl.gz", "rt")
    except FileNotFoundError: continue
    for l in f:
        r = json.loads(l)
        c = (r.get("close") or [None])[0]
        if r.get("neutral") or c is None or r["h"][1] is None or r["a"][1] is None: continue
        h = r["h"][0]
        tot[h] = tot.get(h, 0) + (r["h"][1] - r["a"][1] + c); n[h] = n.get(h, 0) + 1
edge = {h: round(tot[h] / (n[h] + 40), 2) for h in tot if n[h] >= 10}
edge = {h: v for h, v in edge.items() if abs(v) >= 0.05}
lines = [f'  "{h}": {v},' for h, v in sorted(edge.items(), key=lambda kv: -abs(kv[1]))]
open("src/data/cbb/home-edge.ts", "w").write(
    "/**\n * Each men's college basketball team's home edge beyond the market's flat home court, in points: its home\n"
    f" * cover margin against the closing spread in {first} to {last} home games (no neutral sites), shrunk toward 0\n"
    " * (sum / (games + 40)). Added to the model's margin for its home games. Built by scripts/cbb/home_edge.py.\n"
    " * Research (research/cbb/home_court.py, spreads_sharpen.py): with it, spread picks 6+ points off the opener in\n"
    " * home-court games went 60-36, 128-95 and 142-98 (59.0%) in 2023-24 to 2025-26, vs 57.1/55.5/56.1% without.\n"
    " */\nexport const CBB_HOME_EDGE: Record<string, number> = {\n" + "\n".join(lines) + "\n};\n")
print(len(edge), "teams; range", min(edge.values()), "to", max(edge.values()))
