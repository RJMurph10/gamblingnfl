"""QB passing-yards (and pass+rush yards) overs: the candidate QB model (qb_model.py) vs real opening prop lines.
The model is refit each season on all earlier seasons (walk-forward). 2024-2025 were the research seasons;
2026 (weeks so far) is new data the rule has never seen. Rule fixed in advance: over when the model is 8%+
above the line (pass yards); pass+rush yards at 4%+ and 8%+.
  python3 research/props/nfl_qb_bets.py <props-history dir with nfl_YYYY.jsonl.gz>"""
import gzip, json, sys, re
import numpy as np, pandas as pd

src = open("research/props/qb_model.py").read().split('if __name__ == "__main__":')[0]
src = src.replace('q = q[q.season <= 2025].copy()', 'q = q[q.season <= 2026].copy()')
exec(src)
PH = sys.argv[1] if len(sys.argv) > 1 else "ph"
pay = lambda o: 100 / -o if o < 0 else o / 100
imp = lambda o: -o / (-o + 100) if o < 0 else 100 / (o + 100)

preds = {}
for key in ("pass_yds", "pass_rush_yds"):
    col = STATS[key]
    form, opp = build_features(col)
    q["league_" + col] = league_level(col)
    d = q[q.primary & q.total_line.notna() & ~np.isnan(form) & q["league_" + col].notna()].copy()
    x = design(d, pd.Series(form, index=q.index)[d.index], pd.Series(opp, index=q.index)[d.index], col)
    d["pred"] = np.nan
    for season in (2024, 2025, 2026):
        tr, te = d.season < season, d.season == season
        if te.sum() == 0: continue
        beta = fit(x[tr], d[col][tr])
        d.loc[te, "pred"] = np.clip(x[te].values @ beta, 0, None)
    preds[key] = d[d.pred.notna()][["season", "week", "gameday", "player_id", "player_display_name", "team", "pred", col]].rename(columns={col: "actual"})

norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", str(s).lower()))
MK = {"Total Passing Yards (incl. overtime)": "pass_yds", "Total Passing Plus Rushing Yards (incl. overtime)": "pass_rush_yds"}
rows = []
for season in (2024, 2025, 2026):
    for l in gzip.open(f"{PH}/nfl_{season}.jsonl.gz", "rt"):
        g = json.loads(l)
        day = (pd.Timestamp(g["date"]) - pd.Timedelta(hours=5)).strftime("%Y-%m-%d")
        for pid, b in (g.get("books") or {}).items():
            pairs = {}
            for r in b.get("rows", []):
                if r.get("t") not in MK or not r.get("a") or not r.get("op") or r["op"][0] is None: continue
                k = (r["a"], r["t"], r["op"][0])
                p = pairs.setdefault(k, [None, None])
                if r["op"][1] is not None: p[0] = r["op"][1]
                if r["op"][2] is not None: p[1] = r["op"][2]
            best = {}
            # 2026 DraftKings lines come without prices on ESPN: the line the book lists most, graded at -110
            if season >= 2026 and not any(o is not None and u is not None for (o, u) in pairs.values()):
                count = {}
                for (a_, t_, line_) in pairs: count.setdefault((a_, t_), {}).setdefault(line_, 0); count[(a_, t_)][line_] += 1
                for (a_, t_), m in count.items():
                    line_ = sorted(m.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
                    best[(a_, t_)] = (line_, -110, -110, 0)
            for (a, t, line), (o, u) in pairs.items():
                if o is None or u is None: continue
                bal = abs(imp(o) - imp(u))
                if bal > 0.25: continue
                if (a, t) not in best or bal < best[(a, t)][3]: best[(a, t)] = (line, o, u, bal)
            for (a, t), (line, o, u, bal) in best.items():
                bx = (g.get("box") or {}).get(a)
                if not bx: continue
                rows.append((season, day, b.get("name", pid), norm(bx["n"]), MK[t], line, o, u))
L = pd.DataFrame(rows, columns=["season", "day", "book", "name", "stat", "line", "over", "under"])
print("opening main lines:", len(L), L.groupby(["season", "stat"]).size().to_dict())

for key, edges in (("pass_yds", (0.08,)), ("pass_rush_yds", (0.04, 0.08))):
    P = preds[key].copy()
    P["name"] = P.player_display_name.map(norm)
    P["day"] = pd.to_datetime(P.gameday).dt.strftime("%Y-%m-%d")
    X = L[L.stat == key].merge(P, on=["season", "day", "name"])
    X = X[X.actual != X.line]
    X["diff"] = (X.pred - X.line) / X.line
    print(f"\n== {key}: {len(X)} book-lines matched to model projections ==")
    for s_, g in X.groupby("season"):
        print(f"  every over (no model), {s_}: {(g.actual > g.line).mean()*100:.1f}% of {len(g)}; model above the line at all: {(g[g['diff'] > 0].actual > g[g['diff'] > 0].line).mean()*100:.1f}% of {(g['diff'] > 0).sum()}")
    for e in edges:
        d = X[X["diff"] >= e]
        d = d.assign(won=d.actual > d.line, u=[pay(o) if w else -1.0 for o, w in zip(d.over, d.actual > d.line)])
        print(f"  over, model {int(e*100)}%+ above the line (single book each):")
        for (s), g in d.groupby("season"):
            print(f"    {s}{' (new)' if s == 2026 else ''}: {int(g.won.sum())}-{int((~g.won).sum())} ({g.won.mean()*100:.1f}%), ROI {g.u.mean()*100:+.1f}%  books: {', '.join(sorted(g.book.unique()))}")
        # one bet per QB-game (best price among books)
        b1 = d.sort_values("over", key=lambda s: s.map(pay), ascending=False).drop_duplicates(["season", "day", "name"])
        for s, g in b1.groupby("season"):
            print(f"    {s} one bet per QB game: {int(g.won.sum())}-{int((~g.won).sum())} ({g.won.mean()*100:.1f}%), ROI {g.u.mean()*100:+.1f}%")

# ---- experience: the QB's earlier primary starts (career, before this game) ----
qq = q[q.primary].sort_values(["season", "week"])
qq["prior_starts"] = qq.groupby("player_id").cumcount()
ps = qq.set_index(["season", "week", "player_id"]).prior_starts
P = preds["pass_yds"].copy(); P["name"] = P.player_display_name.map(norm); P["day"] = pd.to_datetime(P.gameday).dt.strftime("%Y-%m-%d")
X = L[L.stat == "pass_yds"].merge(P, on=["season", "day", "name"]); X = X[X.actual != X.line]
X["diff"] = (X.pred - X.line) / X.line
X["prior"] = [ps.get((s, w, p), np.nan) for s, w, p in zip(X.season, X.week, X.player_id)]
d = X[X["diff"] >= 0.08].sort_values("over", key=lambda s: s.map(pay), ascending=False).drop_duplicates(["season", "day", "name"])
d = d.assign(won=d.actual > d.line, u=[pay(o) if w else -1.0 for o, w in zip(d.over, d.actual > d.line)])
d["exp"] = pd.cut(d.prior, [-1, 0, 2, 5, 10, 1000], labels=["first start", "1-2 starts", "3-5", "6-10", "11+"])
print("\n== QB ★ (8%+ over) by the QB's earlier career starts, one bet per QB game ==")
for e, g in d.groupby("exp", observed=True):
    by = " ".join(f"{s}:{int(x.won.sum())}-{int((~x.won).sum())}" for s, x in g.groupby("season"))
    print(f"  {str(e):12} {int(g.won.sum())}-{int((~g.won).sum())} ({g.won.mean()*100:.1f}%) ROI {g.u.mean()*100:+.1f}%  [{by}]  e.g. {', '.join(g.player_display_name.head(3))}")
for cut in (1, 3, 6):
    g = d[d.prior >= cut]
    by = " ".join(f"{s}:{int(x.won.sum())}-{int((~x.won).sum())} {x.u.mean()*100:+.1f}%" for s, x in g.groupby("season"))
    print(f"  require {cut}+ earlier starts: {int(g.won.sum())}-{int((~g.won).sum())} ROI {g.u.mean()*100:+.1f}%  [{by}]")
