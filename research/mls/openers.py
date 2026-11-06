"""MLS: the Poisson rating model (model.py) vs ESPN's OPENING lines, 2024-2026 (ESPN BET, then DraftKings):
three-way moneyline (home / away; the draw opener is often missing) and totals (over / under with prices).
Also the same bets at the closing line, and whether the line moved toward the model.
  python3 research/mls/model.py && python3 research/mls/openers.py"""
import gzip, json, glob
import numpy as np, pandas as pd
from scipy.stats import poisson

FD = {"ATL": "Atlanta Utd", "ATX": "Austin FC", "MTL": "CF Montreal", "CLT": "Charlotte", "CHI": "Chicago Fire", "COL": "Colorado Rapids",
      "CLB": "Columbus Crew", "DC": "DC United", "CIN": "FC Cincinnati", "DAL": "FC Dallas", "HOU": "Houston Dynamo", "MIA": "Inter Miami",
      "LAFC": "Los Angeles FC", "LA": "Los Angeles Galaxy", "MIN": "Minnesota United", "NSH": "Nashville SC", "NE": "New England Revolution",
      "NYC": "New York City", "RBNY": "New York Red Bulls", "ORL": "Orlando City", "PHI": "Philadelphia Union", "POR": "Portland Timbers",
      "RSL": "Real Salt Lake", "SD": "San Diego FC", "SJ": "San Jose Earthquakes", "SEA": "Seattle Sounders", "SKC": "Sporting Kansas City",
      "STL": "St. Louis City", "TOR": "Toronto FC", "VAN": "Vancouver Whitecaps"}
dec = lambda a: None if a is None else (1 + a / 100 if a > 0 else 1 + 100 / -a)

P = pd.read_csv("research/mls/data/model_preds.csv", parse_dates=["dt"])
need = ["lh", "la"]
rows = []
for f in sorted(glob.glob("research/mls/data/espn-202[4-6].jsonl.gz")):
    for l in gzip.open(f, "rt"):
        r = json.loads(l)
        bk = [b for b in r["books"] if "live" not in b["name"].lower() and b["open"]["ml"][0] is not None and b["open"]["total"] is not None]
        if not bk: continue
        b = bk[0]
        rows.append(dict(date=pd.Timestamp(r["date"]).tz_localize(None), home=FD.get(r["h"][1]), away=FD.get(r["a"][1]), hg=r["h"][2], ag=r["a"][2],
                         book=b["name"], o=b["open"], c=b["close"]))
E = pd.DataFrame(rows)
E = E[E.home.notna() & E.away.notna()]
# match to the model's predictions (football-data dates are local; allow a day either side)
P["key"] = P.Home + "|" + P.Away
M = []
for r in E.itertuples():
    cand = P[(P.key == f"{r.home}|{r.away}") & ((P.dt - r.date.normalize()).abs() <= pd.Timedelta(days=1))]
    if len(cand): M.append((r.Index, cand.index[0]))
E = E.loc[[a for a, _ in M]].copy()
for c in ("m_h", "m_d", "m_a", "Season"):
    E[c] = P.loc[[b for _, b in M], c].values
print("matched", len(E), "of", len(rows), "ESPN matches with openers;", E.groupby("Season").size().to_dict(), "books", E.book.value_counts().to_dict())

def ml_bets(which, edge):
    out = {}
    for s_, g in E.groupby("Season"):
        w = n = 0; u = 0.0
        for r in g.itertuples():
            ln = getattr(r, which)
            dh, da = dec(ln["ml"][0]), dec(ln["ml"][2])
            dd = dec(ln["ml"][1])
            if dh is None or da is None: continue
            # no-vig with the draw when it's there; otherwise compare to raw implied (conservative)
            imp = [1 / dh, 1 / dd if dd else None, 1 / da]
            tot = sum(x for x in imp if x)
            fair_h = imp[0] / tot if dd else imp[0]
            fair_a = imp[2] / tot if dd else imp[2]
            res = "H" if r.hg > r.ag else "A" if r.ag > r.hg else "D"
            for side, mp, fp, od in (("H", r.m_h, fair_h, dh), ("A", r.m_a, fair_a, da)):
                if mp - fp >= edge:
                    n += 1; win = res == side; w += win; u += (od - 1) if win else -1
        out[s_] = (w, n, u)
    return out

def tot_probs(r):
    # the model's expected goals: back out a Poisson pair matching its home/draw/away chances is overkill; use
    # the market-free approach: total goals ~ Poisson(lh + la) from the model's own prediction file isn't saved,
    # so approximate lh + la from the season's average scoring and the model's home/away strength
    return None

print("\nModel moneyline edges vs the OPENER (home / away only), flat 1u:")
for e in (0.03, 0.05, 0.08):
    o = ml_bets("o", e); c = ml_bets("c", e)
    print(f"  edge {int(e*100)}%+: open " + " ".join(f"{s}:{w}/{n} {u/max(1,n)*100:+.1f}%" for s, (w, n, u) in o.items()) +
          " || at close " + " ".join(f"{s}:{w}/{n} {u/max(1,n)*100:+.1f}%" for s, (w, n, u) in c.items()))

# does the moneyline move toward the model? (home price, open -> close)
mv = []
for r in E.itertuples():
    oh, ch = dec(r.o["ml"][0]), dec(r.c["ml"][0])
    oa, ca = dec(r.o["ml"][2]), dec(r.c["ml"][2])
    if None in (oh, ch, oa, ca): continue
    fo = (1 / oh) / (1 / oh + 1 / oa); fc = (1 / ch) / (1 / ch + 1 / ca)
    mm = r.m_h / (r.m_h + r.m_a)
    if abs(mm - fo) >= 0.05 and fc != fo: mv.append((np.sign(fc - fo) == np.sign(mm - fo)))
print(f"\nWhen the model is 5%+ off the opener, the line moves its way {np.mean(mv)*100:.1f}% of the time ({len(mv)} games)")

# totals at the opener: market's own over chance (no-vig) vs actual; blind over / under and by line
print("\nTotals at the opener (no model yet): blind over / under")
for s_, g in E.groupby("Season"):
    o_w = o_n = 0; o_u = u_u = 0.0
    for r in g.itertuples():
        t, ov, un = r.o["total"], dec(r.o["over"]), dec(r.o["under"])
        if t is None or ov is None or un is None: continue
        g_ = r.hg + r.ag
        if g_ == t: continue
        o_n += 1; win = g_ > t; o_w += win
        o_u += (ov - 1) if win else -1; u_u += (un - 1) if not win else -1
    print(f"  {s_}: overs {o_w}/{o_n} ({o_w/max(1,o_n)*100:.1f}%), over ROI {o_u/max(1,o_n)*100:+.1f}%, under ROI {u_u/max(1,o_n)*100:+.1f}%")
