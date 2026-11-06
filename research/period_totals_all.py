"""Partial-game totals at the opening line, every league with saved line scores (props-history):
  NFL 1st half / 1st quarter, MLB first 5 innings, NHL 1st period (NBA: research/nba/period_totals.py).
  1. blind over / under by season   2. a team model: each team's recent points (runs, goals) scored and allowed in
  that part of the game (recency-weighted, earlier games only), level calibrated on the OTHER season's lines.
  python3 research/period_totals_all.py <dir with <league>/*.jsonl.gz>"""
import gzip, json, sys, glob
import numpy as np, pandas as pd

D = sys.argv[1]
pay = lambda o: (100 / -o if o < 0 else o / 100) if o and o == o else 100 / 110
CFG = {"nfl": {"1st Half Total": (0, 2), "1st Quarter Total": (0, 1)},
       "mlb": {"1st 5 Innings Total Runs": (0, 5)},
       "nhl": {"1st Period Total Goals": (0, 1)}}
PREF = {"Draft Kings": 0, "DraftKings": 0, "ESPN BET": 1}
for lg, MK in CFG.items():
    rows, games, nlines = [], [], {}
    for f in sorted(glob.glob(f"{D}/{lg}/*.jsonl.gz")):
        season = f.split("/")[-1].split(".")[0]
        for l in gzip.open(f, "rt"):
            if not l.strip(): continue
            g = json.loads(l)
            ls = g.get("ls")
            if not ls: continue
            need = max(z for _, z in MK.values())
            hq, aq = ls["home"][:need], ls["away"][:need]
            if len(hq) < need or len(aq) < need or None in hq or None in aq: continue
            games.append(dict(season=season, id=g["id"], date=g["date"], h=g["home"]["abbr"], a=g["away"]["abbr"], hq=hq, aq=aq))
            for pid, b in sorted(g["books"].items(), key=lambda kv: PREF.get(kv[1]["name"], 5)):
                pairs = {}
                for r in b["rows"]:
                    if r.get("a") or r.get("t") not in MK or not r.get("op") or r["op"][0] is None: continue
                    p = pairs.setdefault((r["t"], r["op"][0]), [None, None])
                    if r["op"][1] is not None: p[0] = r["op"][1]
                    if r["op"][2] is not None: p[1] = r["op"][2]
                best = {}
                for (t, line), (o, u) in pairs.items():  # the most balanced priced (main) line per market
                    if o is None or u is None: continue
                    bal = abs(pay(o) - pay(u))
                    if t not in best or bal < best[t][3]: best[t] = (line, o, u, bal)
                # no prices (2026 DraftKings on ESPN): the middle of the lines listed, graded at -110
                for t in {t for t, _ in pairs} - set(best):
                    ls_ = sorted(line for tt, line in pairs if tt == t)
                    best[t] = (ls_[len(ls_) // 2], None, None, 0)
                    nlines[len(ls_)] = nlines.get(len(ls_), 0) + 1
                for t, (line, o, u, _) in best.items():
                    a, z = MK[t]
                    rows.append(dict(season=season, id=g["id"], book=b["name"], market=t, line=line, o=o, u=u, actual=sum(hq[a:z]) + sum(aq[a:z])))
    if not rows: print(lg, "no lines"); continue
    print(f"{lg}: unpriced markets by how many lines were listed: {dict(sorted(nlines.items()))}")
    R = pd.DataFrame(rows).drop_duplicates(["id", "market"])  # best-preferred book first
    R = R[R.actual != R.line].copy()
    R["over"] = R.actual > R.line
    R["o_roi"] = np.where(R.over, R.o.map(pay), -1); R["u_roi"] = np.where(~R.over, R.u.map(pay), -1)
    print(f"\n===== {lg.upper()}: {len(games)} games with line scores, {len(R)} partial-game lines {R.groupby('season').size().to_dict()}")
    for (mk, s), g in R.groupby(["market", "season"]):
        print(f"  blind {mk:26s} {s}  n={len(g):5d} over {g.over.mean()*100:5.1f}%  over ROI {g.o_roi.mean()*100:+5.1f}%  under ROI {g.u_roi.mean()*100:+5.1f}%")
    G = pd.DataFrame(games).sort_values("date").reset_index(drop=True)
    for mk, (a, z) in MK.items():
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
        d = d[d.proj.notna() & (d.proj > 0)].copy()
        if d.season.nunique() < 2: print(f"  model {mk}: only one season with lines"); continue
        d["edge"] = np.nan
        for s_ in d.season.unique():
            k = (d[d.season != s_].line / d[d.season != s_].proj).median()
            m = d.season == s_
            d.loc[m, "edge"] = d[m].proj * k / d[m].line - 1
        print(f"  model {mk}: misses by {(d.proj - d.actual).abs().mean():.2f}, line by {(d.line - d.actual).abs().mean():.2f} (n={len(d)})")
        for e in ((0.03, 0.06, 0.10) if lg != "nfl" else (0.04, 0.08, 0.12)):
            print(f"    {int(e*100)}%+: " + " | ".join(
                f"{s} over {g[g.edge>=e].over.sum()}-{(~g[g.edge>=e].over).sum()} ({g[g.edge>=e].o_roi.mean()*100:+.1f}%) under {(~g[g.edge<=-e].over).sum()}-{g[g.edge<=-e].over.sum()} ({g[g.edge<=-e].u_roi.mean()*100:+.1f}%)"
                for s, g in d.groupby("season")))
