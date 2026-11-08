"""Do heavy-favorite alternate prop lines (e.g. over 39.5 rushing yards at -200) win as often as their
price says? Every priced alternate/main line in ESPN BET's 2024-2025 NFL ladders (one price per row:
op = [line, over price, under price]), graded on the box score, bucketed by price.
  python3 -I research/props/nfl_alt_lines.py <dir with nfl_YYYY.jsonl.gz>"""
import gzip, json, sys
import numpy as np, pandas as pd
PH = sys.argv[1]
num = lambda s: float(s) if s not in (None, "", "-") else np.nan
def ca(s, i):
    try: return float(str(s).split("/")[i])
    except Exception: return np.nan
MK = {"Total Rushing Yards (incl. overtime)": ("rush_yds", lambda s: num(s.get("rushing.YDS", 0))),
      "Total Receiving Yards (incl. overtime)": ("rec_yds", lambda s: num(s.get("receiving.YDS", 0))),
      "Total Receptions (incl. overtime)": ("rec", lambda s: num(s.get("receiving.REC", 0))),
      "Total Passing Yards (incl. overtime)": ("pass_yds", lambda s: num(s.get("passing.YDS"))),
      "Total Rushing Plus Receiving Yards (incl. overtime)": ("rush_rec_yds", lambda s: num(s.get("rushing.YDS", 0)) + num(s.get("receiving.YDS", 0))),
      "Total Carries (incl. overtime)": ("carries", lambda s: num(s.get("rushing.CAR", 0))),
      "Total Pass Completions (incl. overtime)": ("pass_cmp", lambda s: ca(s.get("passing.C/ATT"), 0))}
rows = []
for season in (2024, 2025):
    for l in gzip.open(f"{PH}/nfl_{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        if g.get("seasonType") != 2: continue
        box = g.get("box") or {}
        for bid, b in g["books"].items():
            seen = set()
            for r in b["rows"]:
                if r.get("t") not in MK or not r.get("op"): continue
                ln, po, pu = (r["op"] + [None, None, None])[:3]
                px = box.get(r.get("a"))
                if ln is None or not px: continue
                key, fn = MK[r["t"]]
                act = fn(px.get("s") or {})
                if np.isnan(act): continue
                for side, price in (("over", po), ("under", pu)):
                    if price is None: continue
                    k = (r["a"], key, ln, side)
                    if k in seen: continue
                    seen.add(k)
                    if act == ln: continue
                    win = act > ln if side == "over" else act < ln
                    rows.append(dict(season=season, market=key, line=ln, side=side, price=price, win=win))
D = pd.DataFrame(rows)
pay = lambda o: np.where(o < 0, 100 / -o, o / 100)
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
D["units"] = np.where(D.win, pay(D.price), -1.0)
D["need"] = imp(D.price)
bins = [-10000, -400, -250, -175, -135, -105, 105, 150, 250, 500, 100000]
labels = ["-400 or shorter", "-399 to -250", "-249 to -175", "-174 to -135", "-134 to -105", "about even", "+105 to +150", "+151 to +250", "+251 to +500", "+500 or longer"]
D["bucket"] = pd.cut(D.price, bins, labels=labels)
def table(x, title):
    t = x.groupby("bucket", observed=True).agg(n=("win", "size"), win=("win", "mean"), need=("need", "mean"), roi=("units", "mean"))
    t["2024"] = x[x.season == 2024].groupby("bucket", observed=True).units.mean()
    t["2025"] = x[x.season == 2025].groupby("bucket", observed=True).units.mean()
    print(f"\n{title}")
    for b, r in t.iterrows():
        print(f"  {b:16} n={int(r.n):5}  won {r.win*100:5.1f}%  needed {r.need*100:5.1f}%  ROI {r.roi*100:+6.1f}%  (2024 {r['2024']*100:+.1f}%, 2025 {r['2025']*100:+.1f}%)")
print(f"priced alternate/main rows: {len(D)}; sides: {D.side.value_counts().to_dict()}")
table(D[D.side == "over"], "ALL yardage/catch markets, OVERS by price")
table(D[D.side == "under"], "ALL markets, UNDERS by price")
for m in ("rush_yds", "rec_yds", "rec", "pass_yds"):
    table(D[(D.side == "over") & (D.market == m)], f"{m} overs by price")

print("\n---- detail: counts by season ----")
for m, side, lo, hi in (("rec_yds", "over", -250, -175), ("pass_yds", "over", -250, -175), ("rush_yds", "over", -250, -175),
                        ("rush_yds", "under", 100, 300), ("rush_yds", "under", -175, -105), ("rec_yds", "under", 100, 300)):
    x = D[(D.market == m) & (D.side == side) & (D.price >= lo) & (D.price <= hi)]
    by = " ".join(f"{s}: {int(g.win.sum())}-{int((~g.win).sum())} {g.units.mean()*100:+.1f}%" for s, g in x.groupby("season"))
    print(f"  {m:9} {side:5} price {lo:+d}..{hi:+d}: n={len(x):4} won {x.win.mean()*100:5.1f}% needed {x.need.mean()*100:5.1f}% ROI {x.units.mean()*100:+.1f}%  [{by}]")
# how far below the main line are the -200 receiving overs? (alt line / main line)
