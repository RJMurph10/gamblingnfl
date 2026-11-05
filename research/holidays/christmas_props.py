"""NBA points props on Christmas Day vs every other day (opening lines, 2022-23 to 2024-25; the 2025-26 file stops before December).
python3 research/holidays/christmas_props.py"""
import gzip, json, statistics as st, random
from datetime import datetime, timedelta
from math import erf, sqrt

def pv(w, n):
    z = (w - n / 2) / sqrt(n / 4); return 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))

rows = []  # (day, season, player, name, line, pts)
for s in ["2022-23", "2023-24", "2024-25", "2025-26"]:
    for l in gzip.open(f"research/holidays/data/nba-{s}.jsonl.gz", "rt"):
        g = json.loads(l)
        if str(g.get("seasonType")) != "2": continue
        day = (datetime.fromisoformat(g["date"].replace("Z", "+00:00")) - timedelta(hours=5)).strftime("%Y-%m-%d")
        lines = {}
        for b in (g.get("books") or {}).values():
            for r in b.get("rows", []):
                if r.get("t") != "Total Points" or not r.get("op") or r["op"][0] is None: continue
                lines.setdefault(r["a"], []).append(r["op"][0])
        for a, ls in lines.items():
            bx = (g.get("box") or {}).get(a)
            if not bx: continue
            try: pts, mins = int(bx["s"]["PTS"]), int(bx["s"].get("MIN") or 0)
            except (KeyError, ValueError): continue
            if mins == 0: continue  # didn't play: prop voided
            rows.append((day, s, a, bx["n"], st.median(ls), pts))

xmas = [r for r in rows if r[0].endswith("-12-25")]
other = [r for r in rows if not r[0].endswith("-12-25")]
def summary(name, rs):
    o = sum(1 for r in rs if r[5] > r[4]); u = sum(1 for r in rs if r[5] < r[4])
    print(f"{name:<34} props {len(rs):>6} | overs {o}-{u} ({o/max(1,o+u)*100:.1f}%, p {pv(o,o+u):.2f}) | avg pts vs line {st.mean(r[5]-r[4] for r in rs):+.2f}")
summary("Christmas, all players", xmas)
summary("Other days, all players", other)
summary("Christmas, stars (line 24.5+)", [r for r in xmas if r[4] >= 24.5])
summary("Other days, stars (line 24.5+)", [r for r in other if r[4] >= 24.5])
summary("Christmas, role players (<15)", [r for r in xmas if r[4] < 15])
summary("Other days, role players (<15)", [r for r in other if r[4] < 15])

print("\nBiggest Christmas games vs their line:")
for r in sorted(xmas, key=lambda r: r[4] - r[5])[:12]:
    print(f"  {r[0]} {r[3]:<24} line {r[4]:>5} scored {r[5]:>3} ({r[5]-r[4]:+.1f})")

# Is the best game of the day bigger on Christmas than on any normal ~5-game slate?
by_day = {}
for r in rows: by_day.setdefault(r[0], []).append(r)
def best(rs): return max(r[5] - r[4] for r in rs)
def n40(rs): return sum(1 for r in rs if r[5] >= 40)
xd = sorted(d for d in by_day if d.endswith("-12-25"))
print("\nChristmas: best player vs his line / 40-point games")
for d in xd: print(f"  {d}: best {best(by_day[d]):+.1f}, {n40(by_day[d])} 40-pt games, {len(by_day[d])} props")
# normal slates of the same size: sample 5 games from ordinary days with 5+ games
random.seed(1)
games_by_day = {}
for l_s in ["2022-23", "2023-24", "2024-25", "2025-26"]: pass
sizes = [len(by_day[d]) for d in xd]
pool = [d for d in by_day if not d.endswith("-12-25") and len(by_day[d]) >= 40]
sims = []
for _ in range(4000):
    d = random.choice(pool); k = min(len(by_day[d]), random.choice(sizes))
    sims.append(best(random.sample(by_day[d], k)))
xb = st.mean(best(by_day[d]) for d in xd)
print(f"  Christmas average best {xb:+.1f} vs a normal slate of the same size {st.mean(sims):+.1f} (normal slates beat {xb:+.1f} {sum(s >= xb for s in sims)/len(sims)*100:.0f}% of the time)")
