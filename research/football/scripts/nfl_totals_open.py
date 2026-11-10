# NFL totals vs the opening line (claude/nfl-totals-open.md). Part 1 builds nfl_games.csv (nflverse + SBR 2011-21 openers from
# github.com/FinnedAI/sportsbookreview-scraper data/nfl_archive_10Y.json + ESPN 2023-26 lines); part 2 runs the walk-forward points models.
import json, numpy as np, pandas as pd
F = pd.read_csv("/home/claude/gamblingnfl/research/football/data/football.csv")
F = F[(F.league == "nfl") & (F.season >= 2009)].copy()
F["date"] = pd.to_datetime(F.kickoff, utc=True).dt.tz_convert("America/New_York").dt.strftime("%Y-%m-%d")
# 2026 games from ESPN lines files (scores + lines)
fix = {"WSH": "WAS", "LAR": "LA", "JAX": "JAX"}
E = []
for y in range(2022, 2027):
    for g in json.load(open(f"/home/claude/nflo/lines-{y}.json")):
        E.append(dict(eid=g["id"], season=g["season"], week=g["week"], date=pd.Timestamp(g["date"]).tz_convert("America/New_York").strftime("%Y-%m-%d"),
                      home=fix.get(g["home"], g["home"]), away=fix.get(g["away"], g["away"]), hs=g["hs"], as_=g["as"],
                      e_open=(g.get("open") or [None, None])[1], e_close=(g.get("close") or [None, None])[1]))
E = pd.DataFrame(E)
print("espn teams not in nflverse:", set(E.home) - set(F.home))
# SBR openers 2011-21
NAME = {"Packers":"GB","Saints":"NO","Bears":"CHI","Falcons":"ATL","Bengals":"CIN","Browns":"CLE","Bills":"BUF","Chiefs":"KC","Eagles":"PHI","Rams":"LA","LARams":"LA","LosAngeles":"LA","Steelers":"PIT","Ravens":"BAL","Colts":"IND","Texans":"HOU","Titans":"TEN","Jaguars":"JAX","Lions":"DET","Buccaneers":"TB","Vikings":"MIN","Chargers":"LAC","LAChargers":"LAC","SanDiego":"LAC","Raiders":"LV","LVRaiders":"LV","LasVegas":"LV","Oakland":"LV","Seahawks":"SEA","Fortyniners":"SF","49ers":"SF","Cowboys":"DAL","Jets":"NYJ","Giants":"NYG","Patriots":"NE","Dolphins":"MIA","Broncos":"DEN","Cardinals":"ARI","Panthers":"CAR","Redskins":"WAS","Washington":"WAS","WashingtonFootballTeam":"WAS","Football Team":"WAS","FootballTeam":"WAS","Commanders":"WAS","Kansas":"KC","KCChiefs":"KC","Tampa":"TB","NYGiants":"NYG","NYJets":"NYJ","NewOrleans":"NO","NewEngland":"NE","GreenBay":"GB","SanFrancisco":"SF","Houston":"HOU","BuffaloBills":"BUF","Washingtom":"WAS","St.Louis":"LA"}
S = pd.DataFrame(json.load(open("/home/claude/nflsbr/src/data/nfl_archive_10Y.json")))
S["home"] = S.home_team.astype(str).str.replace(" ", "").map(lambda x: NAME.get(x))
S["away"] = S.away_team.astype(str).str.replace(" ", "").map(lambda x: NAME.get(x))
print("unmapped SBR:", set(S.home_team[S.home.isna()]) | set(S.away_team[S.away.isna()]))
S["date"] = pd.to_datetime(S.date.astype(int).astype(str)).dt.strftime("%Y-%m-%d")
# nflverse abbreviations for old franchises
F["home"] = F.home.replace({"OAK": "LV", "SD": "LAC", "STL": "LA"}); F["away"] = F.away.replace({"OAK": "LV", "SD": "LAC", "STL": "LA"})
S = S.dropna(subset=["home", "away"])
M = F.merge(S[["date", "home", "away", "open_over_under", "close_over_under"]], on=["date", "home", "away"], how="left")
M = M.merge(E[["date", "home", "away", "e_open", "e_close", "eid"]], on=["date", "home", "away"], how="left")
M["open"] = M.open_over_under.where(M.season <= 2021, M.e_open)
print(M.groupby("season").agg(n=("home", "size"), open=("open", lambda s: s.notna().sum())))
# append 2026 (not in football.csv)
N = E[E.season == 2026].rename(columns={"hs": "home_pts", "as_": "away_pts", "e_open": "open", "e_close": "total_close"})
N = N.dropna(subset=["home_pts"])
N = N.merge(M[["date","home","away"]], on=["date","home","away"], how="left", indicator=True)
N = N[N._merge == "left_only"].drop(columns="_merge")
cols = ["season", "week", "date", "home", "away", "home_pts", "away_pts", "total_close", "open", "wind", "temp", "roof", "neutral"]
for c in cols:
    if c not in N: N[c] = np.nan
G = pd.concat([M[cols], N[cols]]).sort_values(["date", "home"]).reset_index(drop=True)
G = G.dropna(subset=["home_pts"])
G.to_csv("nfl_games.csv", index=False)
print(len(G), G.groupby("season").open.apply(lambda s: s.notna().sum()).to_dict())
import numpy as np, pandas as pd, sys
G = pd.read_csv("nfl_games.csv", parse_dates=["date"]).sort_values(["date", "home"]).reset_index(drop=True)
G["tot"] = G.home_pts + G.away_pts
teams = sorted(set(G.home) | set(G.away)); T = {t: i for i, t in enumerate(teams)}; nT = len(teams)
def fit(sub, w, po, pd_, avg, pw, iters=25):
    hi = sub.home.map(T).values; ai = sub.away.map(T).values
    hs = sub.home_pts.values.astype(float); as_ = sub.away_pts.values.astype(float)
    off = po.copy(); de = pd_.copy(); h = 1.0
    ws = np.bincount(hi, w, nT) + np.bincount(ai, w, nT)
    for _ in range(iters):
        os_ = np.bincount(hi, w * (hs - avg - h - de[ai]), nT) + np.bincount(ai, w * (as_ - avg + h - de[hi]), nT)
        ds_ = np.bincount(ai, w * (hs - avg - h - off[hi]), nT) + np.bincount(hi, w * (as_ - avg + h - off[ai]), nT)
        off = (os_ + pw * po) / (ws + pw); de = (ds_ + pw * pd_) / (ws + pw)
    return off, de
CONF = [(None, 6), (8, 4), (5, 4), (3, 3)]  # (tau in weeks, prior weight in games)
out = []
prev_off = np.zeros(nT); prev_def = np.zeros(nT); prev_avg = 22.0
for season, S in G.groupby("season", sort=True):
    S = S.copy()
    for tau, pw in CONF:
        preds = np.full(len(S), np.nan)
        for wk in sorted(S.week.unique()):
            past = S[S.week < wk]; idx = np.where(S.week.values == wk)[0]
            carry = 0.6
            if len(past):
                age = (wk - past.week.values).astype(float)
                w = np.ones(len(past)) if tau is None else np.exp(-age / tau)
                sc = np.r_[past.home_pts, past.away_pts]; ww = np.r_[w, w]
                avg = (prev_avg * 16 + (sc * ww).sum() / ww.sum() * min(len(sc), 200)) / (16 + min(len(sc), 200))
                off, de = fit(past, w, carry * prev_off, carry * prev_def, avg, pw)
            else:
                off, de, avg = carry * prev_off, carry * prev_def, prev_avg
            today = S.iloc[idx]; hi = today.home.map(T).values; ai = today.away.map(T).values
            preds[idx] = 2 * avg + off[hi] + de[ai] + off[ai] + de[hi]
        S[f"m_{tau}"] = preds
    out.append(S)
    w = np.ones(len(S)); avg = np.r_[S.home_pts, S.away_pts].mean()
    prev_off, prev_def = fit(S, w, np.zeros(nT), np.zeros(nT), avg, 1); prev_avg = avg
D = pd.concat(out); D.to_csv("preds.csv", index=False)
D = D[D.open.notna()]
D["period"] = np.where(D.season <= 2016, "A 11-16", np.where(D.season <= 2021, "B 17-21", "C 23-26"))
rm = lambda e: np.sqrt(np.nanmean(e ** 2))
for p, x in D.groupby("period"):
    print(p, len(x), f"open {rm(x.tot-x.open):.2f} close {rm(x.tot-x.total_close):.2f}", " ".join(f"m{t} {rm(x.tot-x[f'm_{t}']):.2f}" for t, _ in CONF))
def ou(x, pred, lo, hi=99):
    e = pred - x.open; m = (e.abs() >= lo) & (e.abs() < hi) & (x.week >= 3)
    y = x[m]; over = e[m] > 0; r = np.sign(y.tot - y.open)
    w = ((over & (r > 0)) | (~over & (r < 0))).sum(); l = ((over & (r < 0)) | (~over & (r > 0))).sum()
    return f"{w}-{l} {100*w/max(1,w+l):.1f}%"
for t, _ in CONF:
    for lo in (2, 3, 4, 6):
        print(f"m_{t} {lo}+", " | ".join(f"{p}: {ou(x, x[f'm_{t}'], lo)}" for p, x in D.groupby("period")))
