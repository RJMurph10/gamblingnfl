"""Each team's biggest name (highest points line on the team that game): Christmas vs other days."""
import gzip, json, statistics as st
from datetime import datetime, timedelta

top = []  # (is_xmas, day, name, line, pts)
for s in ["2022-23", "2023-24", "2024-25"]:
    for l in gzip.open(f"research/holidays/data/nba-{s}.jsonl.gz", "rt"):
        g = json.loads(l)
        if str(g.get("seasonType")) != "2": continue
        day = (datetime.fromisoformat(g["date"].replace("Z", "+00:00")) - timedelta(hours=5)).strftime("%Y-%m-%d")
        lines = {}
        for b in (g.get("books") or {}).values():
            for r in b.get("rows", []):
                if r.get("t") == "Total Points" and r.get("op") and r["op"][0] is not None:
                    lines.setdefault(r["a"], []).append(r["op"][0])
        best = {}
        for a, ls in lines.items():
            bx = (g.get("box") or {}).get(a)
            if not bx: continue
            try: pts, mins = int(bx["s"]["PTS"]), int(bx["s"].get("MIN") or 0)
            except (KeyError, ValueError): continue
            if mins == 0: continue
            ln = st.median(ls)
            if ln > best.get(bx["tm"], (0,))[0]: best[bx["tm"]] = (ln, bx["n"], pts)
        for tm, (ln, n, pts) in best.items():
            top.append((day.endswith("-12-25"), day, n, ln, pts, tm))

def summ(name, rs):
    o = sum(r[4] > r[3] for r in rs); u = sum(r[4] < r[3] for r in rs)
    print(f"{name:<36} {len(rs):>5} props | overs {o}-{u} ({o/max(1,o+u)*100:.1f}%) | avg pts vs line {st.mean(r[4]-r[3] for r in rs):+.2f}")
x = [r for r in top if r[0]]; o = [r for r in top if not r[0]]
summ("Christmas, each team's top player", x)
summ("Other days, each team's top player", o)
summ("Other nationally big days? (Dec 24-26 excl. 25)", [r for r in o if r[1][5:] in ("12-23","12-26","12-27")])
print()
for r in sorted(x, key=lambda r: r[1]): print(f"  {r[1]} {r[5]:<4} {r[2]:<24} line {r[3]:>5}  scored {r[4]:>3}  {'OVER' if r[4] > r[3] else 'under'}")
