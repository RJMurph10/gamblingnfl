"""The site's quarterback-change angle (a starter change worth 2+ points → bet the side it favors, vs the closing
spread), re-run with variations of the QB rating to see which make it more thorough without hurting it:
  base     = the site today (src/lib/nfl/qb-ratings.ts): each START scored by the team's passing EPA/dropback
  relief   = also count relief appearances (his own EPA/dropback, weighted by dropbacks / 35)
  rush     = add QB rushing EPA (pass + rush EPA per dropback + carry)
  both     = relief + rush
  python3 research/football/scripts/qb_change_variants.py"""
import glob, numpy as np, pandas as pd

cols = ["player_id", "position", "season", "week", "season_type", "team", "attempts", "sacks_suffered", "passing_epa", "carries", "rushing_epa"]
W = pd.concat([pd.read_csv(f, usecols=cols, low_memory=False) for f in sorted(glob.glob("/root/fbdata/src/players/stats_player_week_*.csv"))])
W = W[W.position == "QB"].copy()
W["db"] = W.attempts.fillna(0) + W.sacks_suffered.fillna(0)
W["car"] = W.carries.fillna(0)
W["pe"] = W.passing_epa.fillna(0); W["re"] = W.rushing_epa.fillna(0)
W = W[(W.db + W.car) > 0]
W["t"] = W.season * 100 + W.week
team = W.groupby(["team", "t"]).agg(tdb=("db", "sum"), tpe=("pe", "sum"), tre=("re", "sum"), tcar=("car", "sum")).reset_index()

G = pd.read_csv("/root/fbdata/src/nfl_games_now.csv", low_memory=False)
G = G[G.season >= 2001].copy(); G["t"] = G.season * 100 + G.week
fix = {"OAK": "LV", "SD": "LAC", "STL": "LA"}  # weekly stats use current abbreviations
for c in ("home_team", "away_team"): G[c] = G[c].replace(fix)
team["team"] = team.team.replace(fix); W["team"] = W.team.replace(fix)
team = team.groupby(["team", "t"]).sum().reset_index()

starts = []
for g in G.itertuples():
    for tm, qb in ((g.home_team, g.home_qb_id), (g.away_team, g.away_qb_id)):
        if isinstance(qb, str): starts.append((g.t, tm, qb))
ST = pd.DataFrame(starts, columns=["t", "team", "qb"]).merge(team, on=["team", "t"], how="left")
startset = set(zip(ST.t, ST.qb))
R = W[[(t, q) not in startset for t, q in zip(W.t, W.player_id)]][["t", "player_id", "db", "pe", "re", "car"]].rename(columns={"player_id": "qb"})

def events(variant):
    """per-QB rating events (t, qb, value, weight) and the team start list."""
    rush = variant in ("rush", "both")
    s = ST.dropna(subset=["tdb"]).copy()
    s = s[s.tdb > 0]
    s["v"] = (s.tpe + (s.tre if rush else 0)) / (s.tdb + (s.tcar if rush else 0))
    s["w"] = 1.0
    ev = [s[["t", "qb", "v", "w"]]]
    if variant in ("relief", "both"):
        r = R[(R.db + R.car) >= 3].copy()
        r["v"] = (r.pe + (r.re if rush else 0)) / (r.db + (r.car if rush else 0))
        r["w"] = np.minimum(1, r.db / 35)
        ev.append(r[["t", "qb", "v", "w"]])
    return pd.concat(ev).sort_values("t")

def run(variant, priorStarts=12, lowCut=4, ppe=30, thresh=2.0, cap=7):
    ev = events(variant)
    ev_t = ev.t.values; ev_q = ev.qb.values; ev_v = ev.v.values; ev_w = ev.w.values
    st_sorted = ST.sort_values("t")
    out = []
    for season in range(2003, 2027):
        weeks = sorted(G[G.season == season].t.unique())
        for t in weeks:
            m = ev_t < t
            w = (0.6 ** (season - ev_t[m] // 100)) * ev_w[m]
            df = pd.DataFrame({"q": ev_q[m], "wv": w * ev_v[m], "w": w}).groupby("q").sum()
            lows = df[(df.w > 0) & (df.w < lowCut)]
            prior = (lows.wv / lows.w).mean() if len(lows) else -0.1
            rating = lambda q: ((df.wv.get(q, 0.0)) + priorStarts * prior) / (df.w.get(q, 0.0) + priorStarts)
            rec = st_sorted[(st_sorted.t < t) & (st_sorted.t // 100 >= season - 1)]
            def usual(tm):
                lst = rec[rec.team == tm]
                if not len(lst): return None
                this = set(lst[lst.t // 100 == season].qb)
                sc = {}
                n = len(lst)
                for i, (q, tt) in enumerate(zip(lst.qb, lst.t)):
                    if this and q not in this: continue
                    sc[q] = sc.get(q, 0) + 0.93 ** (n - 1 - i) * (1 if tt // 100 == season else 0.5)
                if not sc: return None
                reg = max(sc, key=sc.get)
                last = lst.tail(8); ws = 0.85 ** np.arange(len(last) - 1, -1, -1)
                base = float(np.sum(ws * np.array([rating(q) for q in last.qb])) / ws.sum())
                return reg, base
            for g in G[G.t == t].itertuples():
                if not (isinstance(g.home_qb_id, str) and isinstance(g.away_qb_id, str)) or pd.isna(g.spread_line): continue
                pts = {}
                ch = False
                for side, tm, qb in (("h", g.home_team, g.home_qb_id), ("a", g.away_team, g.away_qb_id)):
                    u = usual(tm)
                    if u is None: pts[side] = 0; continue
                    pts[side] = ppe * (rating(qb) - u[1]); ch |= (u[0] != qb)
                marg = max(-cap, min(cap, pts["h"] - pts["a"]))
                if not ch or abs(marg) < thresh: continue
                cov = None if pd.isna(g.result) else (g.result - g.spread_line) * (1 if marg > 0 else -1)
                out.append(dict(season=season, week=g.week, marg=abs(marg), cover=cov, game=g.game_id))
    return pd.DataFrame(out)

def report(name, d):
    d = d[d.cover.notna() & (d.cover != 0)]
    by = d.groupby("season").apply(lambda x: (x.cover > 0).mean())
    def rec(x):
        w = int((x.cover > 0).sum()); l = len(x) - w
        return f"{w}-{l} {w/len(x)*100:.1f}% ({(w*0.909-l)/len(x)*100:+.1f}%)" if len(x) else "-"
    print(f"{name:8s} all {rec(d)} | 2003-14 {rec(d[d.season<=2014])} | 2015-25 {rec(d[(d.season>=2015)&(d.season<=2025)])} | 2026 {rec(d[d.season==2026])} | seasons >50%: {(by>0.5).sum()}/{len(by)}")

if __name__ == "__main__":
    import sys
    res = {}
    for v in ("base", "relief", "rush", "both"):
        res[v] = run(v); report(v, res[v])
    pd.concat([d.assign(variant=k) for k, d in res.items()]).to_csv("/tmp/claude-0/qbvar.csv", index=False)
