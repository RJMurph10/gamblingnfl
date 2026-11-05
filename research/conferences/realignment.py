"""Teams in their first two seasons in a new conference: conference games vs the spread and total.
CFB FBS 2014-2025 (closing consensus), CBB 2020-21 to 2025-26 (ESPN closing)."""
import gzip, json, glob, os
from math import erf, sqrt
import pandas as pd

def pv(w, n):
    z = (w - n / 2) / sqrt(n / 4) if n else 0; return 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))
def rec(name, hits):
    w, n = int(sum(hits)), len(hits)
    print(f"  {name:<52} {w}-{n-w} ({w/max(1,n)*100:.1f}%, p {pv(w,n):.2f})")

def study(df, label):
    # df: season, home, away, hconf, aconf, hnew, anew, margin (home-away), pts, spread (home), total
    g = df[(df.hconf == df.aconf)].copy()
    one = g[g.hnew ^ g.anew]  # exactly one newcomer
    s = one[one.spread.notna() & (one.margin + one.spread != 0)]
    new_home = s.hnew
    cover_home = s.margin + s.spread > 0
    print(f"\n{label}: conference games with exactly one newcomer (first 2 seasons in the conference)")
    rec("newcomer covers", list((cover_home == new_home)))
    rec("  newcomer at home covers", list(cover_home[new_home]))
    rec("  newcomer on the road covers", list(~cover_home[~new_home]))
    t = g[(g.hnew | g.anew) & g.total.notna() & (g.pts != g.total)]
    rec("over, any game with a newcomer", list(t.pts > t.total))
    o = g[~(g.hnew | g.anew) & g.total.notna() & (g.pts != g.total)]
    rec("over, conference games without one", list(o.pts > o.total))
    for (c, ss), x in s.assign(nc=lambda d: d.hconf).groupby(["nc", "season"]):
        if len(x) >= 15 and ss >= 2023:
            nh = x.hnew; ch = x.margin + x.spread > 0
            w = int((ch == nh).sum()); print(f"    {ss} {c:<18} newcomers {w}-{len(x)-w}")

# ---------- CFB ----------
S = pd.concat([pd.read_csv(f, low_memory=False) for f in glob.glob("/root/fbdata/src/cfbfastR-data/schedules/csv/cfb_schedules_20*.csv")])
S = S[S.season_type == "regular"]
conf = {}
for _, r in S[["season", "home_id", "home_conference", "away_id", "away_conference"]].iterrows():
    conf[(r.season, r.home_id)] = r.home_conference; conf[(r.season, r.away_id)] = r.away_conference
def is_new(season, tid):
    c = conf.get((season, tid))
    return c is not None and (conf.get((season - 1, tid)) not in (None, c) and conf.get((season - 1, tid)) != c
           or conf.get((season - 2, tid)) not in (None, c) and conf.get((season - 1, tid)) == c)
fb = pd.read_csv("research/football/data/football.csv", low_memory=False)
c = fb[(fb.league == "cfb") & (fb.season >= 2014)].copy()
c["hconf"] = [conf.get((s, h)) for s, h in zip(c.season, c.home_id)]
c["aconf"] = [conf.get((s, a)) for s, a in zip(c.season, c.away_id)]
c["hnew"] = [is_new(s, h) for s, h in zip(c.season, c.home_id)]
c["anew"] = [is_new(s, a) for s, a in zip(c.season, c.away_id)]
c["margin"] = c.home_pts - c.away_pts
c = c.rename(columns={"spread_close": "spread", "total_close": "total"})
c = c[c.hconf.notna()]
study(c, "CFB 2014-2025")
x = c[(c.season >= 2024) & (c.hconf == c.aconf) & (c.hnew | c.anew)]
print("  CFB newcomer teams 2024-25:", sorted({t for s, h, a, hn, an in zip(x.season, x.home, x.away, x.hnew, x.anew) for t, n in ((h, hn), (a, an)) if n}))

# ---------- CBB ----------
rows, confs = [], {}
for f in sorted(glob.glob("research/cbb/data/20*.jsonl.gz")):
    s = int(f.split("/")[-1][:4])
    for t in json.load(open(f.replace(".jsonl.gz", "-teams.json"))): confs[(s, t["id"])] = t.get("conf")
for f in sorted(glob.glob("research/cbb/data/20*.jsonl.gz")):
    s = int(f.split("/")[-1][:4])
    if s < 2020: continue
    for l in gzip.open(f, "rt"):
        if '"close"' not in l: continue
        r = json.loads(l)
        h, a = r["h"][0], r["a"][0]
        if r["h"][1] is None or r["a"][1] is None: continue
        cl = r.get("close") or [None, None]
        rows.append(dict(season=s, home=h, away=a, hconf=confs.get((s, h)), aconf=confs.get((s, a)),
                         margin=r["h"][1] - r["a"][1], pts=r["h"][1] + r["a"][1], spread=cl[0], total=cl[1]))
b = pd.DataFrame(rows)
def cnew(s, t):
    c0, c1, c2 = confs.get((s, t)), confs.get((s - 1, t)), confs.get((s - 2, t))
    return bool(c0) and ((c1 is not None and c1 != c0) or (c1 == c0 and c2 is not None and c2 != c0))
b["hnew"] = [cnew(s, t) for s, t in zip(b.season, b.home)]
b["anew"] = [cnew(s, t) for s, t in zip(b.season, b.away)]
b = b[b.hconf.notna() & (b.hconf != "")]
b["spread"] = pd.to_numeric(b.spread, errors="coerce"); b["total"] = pd.to_numeric(b.total, errors="coerce")
study(b, "CBB 2020-21 to 2025-26")
