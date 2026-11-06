"""Backup quarterbacks: does draft pick / NFL experience tell us how good a fill-in starter will be,
beyond the site's current rating (his own past STARTS only, pulled toward a flat 'rarely used QB' average)?
And does the betting market already know it (cover rate vs the closing spread)?
Data: nflverse games (starters, closing spread), weekly player stats (passing EPA incl. relief), draft picks.
  python3 research/football/scripts/backup_qb.py"""
import glob
import numpy as np, pandas as pd

W = pd.concat([pd.read_csv(f, usecols=["player_id", "player_display_name", "position", "season", "week", "season_type", "team",
                                       "attempts", "sacks_suffered", "passing_epa"], low_memory=False)
               for f in sorted(glob.glob("/root/fbdata/src/players/stats_player_week_*.csv"))])
W = W[(W.position == "QB")].copy()
W["db"] = W.attempts.fillna(0) + W.sacks_suffered.fillna(0)
W = W[W.db > 0]
W["epa"] = W.passing_epa.fillna(0)
W["t"] = W.season * 100 + W.week
D = pd.read_csv("/root/fbdata/draft/draft_picks.csv", usecols=["season", "pick", "gsis_id", "position"])
D = D[D.gsis_id.notna()].drop_duplicates("gsis_id").set_index("gsis_id")

G = pd.read_csv("/root/fbdata/src/nfl_games_now.csv", low_memory=False)
G = G[G.season >= 2002].copy()
G["t"] = G.season * 100 + G.week
G = G.sort_values(["t", "game_id"])
rows = []
for g in G.itertuples():
    for side, team, qb, opp in (("home", g.home_team, g.home_qb_id, g.away_team), ("away", g.away_team, g.away_qb_id, g.home_team)):
        if isinstance(qb, str):
            # spread_line = expected home margin; result = home margin. Cover margin from this team's side:
            cov = (g.result - g.spread_line) * (1 if side == "home" else -1) if pd.notna(g.result) and pd.notna(g.spread_line) else np.nan
            rows.append(dict(t=g.t, season=g.season, week=g.week, game_id=g.game_id, team=team, qb=qb, cover=cov, played=pd.notna(g.result)))
S = pd.DataFrame(rows)

# Walk-forward features per start, from everything before that week.
Wg = W.groupby(["player_id", "t"]).agg(db=("db", "sum"), epa=("epa", "sum")).reset_index().sort_values("t")
starts_before = {}
team_hist = {}
feat = []
wt_by_qb = {q: g for q, g in Wg.groupby("player_id")}
for (t,), grp in S.groupby(["t"]):
    for r in grp.itertuples():
        h = wt_by_qb.get(r.qb)
        prior = h[h.t < t] if h is not None else None
        seas = t // 100
        if prior is not None and len(prior):
            w = 0.6 ** (seas - prior.t // 100)
            cdb = float((w * prior.db).sum()); cepa = float((w * prior.epa).sum())
            raw_db = float(prior.db.sum())
        else:
            cdb = cepa = raw_db = 0.0
        ns = starts_before.get(r.qb, 0)
        th = team_hist.get(r.team, [])
        recent = [q for (tt, q) in th if tt // 100 >= seas - 1][-17:]
        if recent:
            sc = {}
            for i, q in enumerate(recent): sc[q] = sc.get(q, 0) + 0.93 ** (len(recent) - 1 - i)
            usual = max(sc, key=sc.get)
        else:
            usual = None
        d = D.loc[r.qb] if r.qb in D.index else None
        feat.append(dict(idx=r.Index, prior_starts=ns, cdb=cdb, cepa=cepa, raw_db=raw_db, usual=usual,
                         pick=float(d.pick) if d is not None else np.nan, draft_year=float(d.season) if d is not None else np.nan))
    for r in grp.itertuples():
        starts_before[r.qb] = starts_before.get(r.qb, 0) + 1
        team_hist.setdefault(r.team, []).append((t, r.qb))
F = pd.DataFrame(feat).set_index("idx")
S = S.join(F)
# this game's own EPA/db for the starter
S = S.merge(Wg.rename(columns={"player_id": "qb", "db": "g_db", "epa": "g_epa"}), on=["qb", "t"], how="left")
S["g_epadb"] = S.g_epa / S.g_db
S["backup"] = S.usual.notna() & (S.qb != S.usual)
S["yrs"] = S.season - S.draft_year
S["tier"] = pd.cut(S.pick.fillna(999), [0, 32, 100, 260, 1000], labels=["1st round", "rd 2-3", "rd 4-7", "undrafted"])

B = S[S.backup & (S.prior_starts < 8) & (S.g_db >= 10) & (S.season >= 2006)].copy()
print(f"backup starts (fewer than 8 career starts) 2006-2026: {len(B)}")

# --- 1. what predicts the backup's EPA/dropback that game? ---
lows = B.g_epadb.mean()
print(f"\nAverage EPA/dropback in those starts: {lows:+.3f} (league starters ~+0.05)")
print("\nBy draft tier (EPA/db that game, cover % vs closing spread):")
for k, g in B.groupby("tier", observed=True):
    c = g.cover.dropna(); c = c[c != 0]
    print(f"  {k:10s} n={len(g):4d}  EPA/db {g.g_epadb.mean():+.3f}  cover {np.mean(c>0)*100:5.1f}% ({len(c)})")
B["exp"] = pd.cut(B.raw_db, [-1, 50, 200, 500, 1e9], labels=["<50 db", "50-200", "200-500", "500+"])
print("\nBy career dropbacks before the start (incl. relief):")
for k, g in B.groupby("exp", observed=True):
    c = g.cover.dropna(); c = c[c != 0]
    print(f"  {k:8s} n={len(g):4d}  EPA/db {g.g_epadb.mean():+.3f}  cover {np.mean(c>0)*100:5.1f}% ({len(c)})")

# --- 2. predictors compared (walk-forward-ish: fit prior means on seasons before) ---
def site_rating(r, prior):   # starts-only shrink isn't reproducible exactly; use all dropbacks for both, per-dropback shrink
    return (r.cepa + 150 * prior) / (r.cdb + 150)
out = []
for s in range(2010, 2027):
    tr = B[B.season < s]; te = B[(B.season == s)]
    if not len(te): continue
    flat = tr.g_epadb.mean()
    tier_m = tr.groupby("tier", observed=True).g_epadb.mean()
    for r in te.itertuples():
        tp = tier_m.get(r.tier, flat)
        out.append(dict(season=s, y=r.g_epadb, w=r.g_db, flat=flat, tier=tp,
                        flat_hist=site_rating(r, flat), tier_hist=site_rating(r, tp), cover=r.cover, tiername=r.tier))
O = pd.DataFrame(out)
print("\nWeighted error predicting the backup's EPA/db (lower = better), 2010-2026:")
for c in ("flat", "tier", "flat_hist", "tier_hist"):
    print(f"  {c:10s} MAE {np.average((O.y - O[c]).abs(), weights=O.w):.4f}  corr {np.corrcoef(O.y, O[c])[0,1]:+.3f}")

# --- 3. does the market miss it? cover rate by predicted quality (tier_hist) quintile ---
O["q"] = pd.qcut(O.tier_hist, 4, labels=["worst", "2", "3", "best"])
print("\nCover vs the closing spread by predicted backup quality (tier + history):")
for k, g in O.groupby("q", observed=True):
    c = g.cover.dropna(); c = c[c != 0]
    print(f"  {k:6s} n={len(c):4d}  cover {np.mean(c>0)*100:5.1f}%  avg cover margin {c.mean():+.2f}")
for half, g in (("2010-17", O[O.season <= 2017]), ("2018-26", O[O.season >= 2018])):
    print(f"  {half}: " + "  ".join(f"{k}:{np.mean(x.cover.dropna()[x.cover.dropna()!=0]>0)*100:.1f}% ({x.cover.notna().sum()})" for k, x in g.groupby("q", observed=True)))

# --- 4. the site's way (his past STARTS only, 12-start shrink) vs every past dropback incl. relief ---
St = S[S.g_db >= 1].sort_values("t")
by = {q: g for q, g in St.groupby("qb")}
cmp = []
for s in range(2010, 2027):
    tr = B[B.season < s]; flat = tr.g_epadb.mean()
    for r in B[B.season == s].itertuples():
        h = by.get(r.qb); h = h[h.t < r.t] if h is not None else h
        if h is not None and len(h):
            w = 0.6 ** (s - h.t // 100); site = (float((w * h.g_epadb).sum()) + 12 * flat) / (float(w.sum()) + 12)
        else:
            site = flat
        cmp.append(dict(y=r.g_epadb, wt=r.g_db, site=site, alldb=(r.cepa + 150 * flat) / (r.cdb + 150), nst=r.prior_starts, rdb=r.raw_db))
C = pd.DataFrame(cmp)
for c in ("site", "alldb"):
    print(f"  {c:6s} MAE {np.average((C.y - C[c]).abs(), weights=C.wt):.4f}  corr {np.corrcoef(C.y, C[c])[0,1]:+.3f}")
z = C[C.nst == 0]
print(f"  first-ever starts only (n={len(z)}): site corr {np.corrcoef(z.y, z.site)[0,1]:+.3f} (always the flat average)  all-dropbacks corr {np.corrcoef(z.y, z.alldb)[0,1]:+.3f}")
