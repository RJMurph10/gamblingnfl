"""NBA first-half and quarter totals at the opening line (ESPN BET 2024-25 / 2025-26, DraftKings when present),
graded with the line scores now saved in props-history.
  1. blind over / under by market and season
  2. "derivative" check: the 1st-half (or 1st-quarter) total vs the full-game total implied by the two team totals.
     Books mostly set the half as a fixed share of the game; teams that start fast or slow break that.
  3. a simple model: each team's recent share of its points scored + allowed in the 1st half (or quarter),
     recency-weighted, from earlier games only; projected half total = game total x the two teams' average share.
     Bet when it's X%+ off the half line.
  python3 research/nba/period_totals.py <dir with nba/*.jsonl.gz>"""
import gzip, json, sys, glob
import numpy as np, pandas as pd

D = sys.argv[1]
pay = lambda o: (100 / -o if o < 0 else o / 100) if o else 100 / 110
MK = {"1st Half Total": (0, 2), "1st Quarter Total": (0, 1), "2nd Quarter Total": (1, 2), "3rd Quarter Total": (2, 3), "4th Quarter Total": (3, 4)}
rows, games = [], []
for f in sorted(glob.glob(f"{D}/nba/20*.jsonl.gz")):
    season = f.split("/")[-1][:7]
    for l in gzip.open(f, "rt"):
        if not l.strip(): continue
        g = json.loads(l)
        ls = g.get("ls")
        if not ls or len(ls["home"]) < 4 or g.get("seasonType") not in (2, None): continue
        q = [ls["home"][i] + ls["away"][i] for i in range(4)]
        if None in q: continue
        games.append(dict(season=season, id=g["id"], date=g["date"], h=g["home"]["abbr"], a=g["away"]["abbr"],
                          hq=ls["home"][:4], aq=ls["away"][:4], final=sum(ls["home"]) + sum(ls["away"])))
        for pid, b in sorted(g["books"].items()):
            pairs, tt = {}, []
            for r in b["rows"]:
                if r.get("a") or not r.get("op") or r["op"][0] is None: continue
                if r["t"] == "Team Total Points": tt.append(r["op"][0]); continue
                if r["t"] not in MK: continue
                p = pairs.setdefault((r["t"], r["op"][0]), [None, None])
                if r["op"][1] is not None: p[0] = r["op"][1]
                if r["op"][2] is not None: p[1] = r["op"][2]
            gt = sum(tt) if len(tt) == 2 else None
            seen = set()
            for (t, line), (o, u) in pairs.items():
                if t in seen: continue
                seen.add(t)
                a, z = MK[t]
                rows.append(dict(season=season, id=g["id"], book=b["name"], market=t, line=line, o=o, u=u, game_total=gt, actual=sum(q[a:z])))
R = pd.DataFrame(rows)
R = R.sort_values("book", key=lambda s: s.map({"ESPN BET": 0, "Draft Kings": 1}).fillna(2)).drop_duplicates(["id", "market"])
R = R[R.actual != R.line].copy()
R["over"] = R.actual > R.line
R["o_roi"] = np.where(R.over, R.o.map(pay), -1); R["u_roi"] = np.where(~R.over, R.u.map(pay), -1)
print("games with line scores:", len(games), "| period lines:", len(R), R.groupby("season").size().to_dict())
print("\n1. Blind at the opener")
for (mk, s), g in R.groupby(["market", "season"]):
    print(f"  {mk:18s} {s}  n={len(g):4d} over {g.over.mean()*100:5.1f}%  over ROI {g.o_roi.mean()*100:+5.1f}%  under ROI {g.u_roi.mean()*100:+5.1f}%")

# 2. a points model per period: each team's recent points scored and allowed in that period (recency-weighted,
#    earlier games only, this season + last), home and away combined; projected = (H for + A against)/2 + (A for + H against)/2
G = pd.DataFrame(games).sort_values("date").reset_index(drop=True)
print("\n2. Period points model (walk-forward)")
for mk, (a, z) in MK.items():
    if mk not in ("1st Half Total", "1st Quarter Total"): continue
    hist, proj = {}, []
    for g in G.itertuples():
        def ew(team, i):
            v = [x[i] for x in hist.get(team, [])[-25:]]
            if len(v) < 6: return None
            w = 0.5 ** (np.arange(len(v))[::-1] / 10); return float(np.sum(w * np.array(v)) / w.sum())
        hf, ha, af, aa = ew(g.h, 0), ew(g.h, 1), ew(g.a, 0), ew(g.a, 1)
        proj.append(None if None in (hf, ha, af, aa) else (hf + aa) / 2 + (af + ha) / 2)
        hp, ap = sum(g.hq[a:z]), sum(g.aq[a:z])
        hist.setdefault(g.h, []).append((hp, ap)); hist.setdefault(g.a, []).append((ap, hp))
    G["proj"] = proj
    d = R[R.market == mk].merge(G[["id", "proj"]], on="id")
    d = d[d.proj.notna()].copy()
    # calibrate the model's level on the other season's lines (median line / projection), no peeking
    d["edge"] = np.nan
    for s_ in d.season.unique():
        k = (d[d.season != s_].line / d[d.season != s_].proj).median()
        m = d.season == s_
        d.loc[m, "edge"] = d[m].proj * k / d[m].line - 1
    print(f"  {mk}: model misses by {(d.proj - d.actual).abs().mean():.2f}, line by {(d.line - d.actual).abs().mean():.2f} (n={len(d)})")
    for e in (0.02, 0.04, 0.06):
        print(f"    {int(e*100)}%+: " + " | ".join(
            f"{s} over {g[g.edge>=e].over.sum()}-{(~g[g.edge>=e].over).sum()} ({g[g.edge>=e].o_roi.mean()*100:+.1f}%) under {(~g[g.edge<=-e].over).sum()}-{g[g.edge<=-e].over.sum()} ({g[g.edge<=-e].u_roi.mean()*100:+.1f}%)"
            for s, g in d.groupby("season")))
