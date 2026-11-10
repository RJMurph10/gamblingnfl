"""Which v2 inputs carry the opening-total edge, and does it survive forecast-quality weather?
Variants refit walk-forward per season (2021-2025) and graded on 8%+ unders vs the DK / FanDuel opener."""
import numpy as np, pandas as pd, statsmodels.api as sm
src = open("research/mlb/scripts/model_v2.py").read()
head = src.split("S = side_rows(g)")[0]
exec(head)  # builds g (with plat, pen, ump, dan, weather) and side_rows()
g0 = g.copy()
X1 = ["home", "off_w", "off_k", "sp_x", "pen_x", "sp_k", "sp_bb", "sp_hr", "sp_share", "park", "night"]
X2 = X1 + ["plat", "pen_tired", "ump", "dan", "temp", "w_out", "w_in", "w_cross", "wrig_out", "wrig_in"]
O = pd.read_csv("/root/mlbdata/src/mlb-reference-data/odds_flat.csv", low_memory=False)
RS = {"ANA": "LAA", "CHA": "CHW", "CHN": "CHC", "KCA": "KC", "LAN": "LAD", "NYA": "NYY", "NYN": "NYM", "SDN": "SD", "SFN": "SF", "SLN": "STL", "TBA": "TB"}
O["home"] = O.home.replace({"AZ": "ARI"}); O["away"] = O.away.replace({"AZ": "ARI"})
from scipy.stats import nbinom
imp = lambda o: np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
pay = lambda o: np.where(o < 0, 100 / -o, o / 100)
def p_over(mu_a, mu_h, r_a, r_h, line):
    mu = mu_a + mu_h; var = mu_a + mu_a**2 / r_a + mu_h + mu_h**2 / r_h
    r = mu**2 / np.maximum(var - mu, 1e-6); p = r / (r + mu); k = np.floor(line)
    over = 1 - nbinom.cdf(k, r, p); push = np.where(line == k, nbinom.pmf(k, r, p), 0)
    return over / np.maximum(1 - push, 1e-9)

def with_weather_noise(g, temp_sd, wind_sd, seed=1):
    g = g.copy(); rng = np.random.default_rng(seed)
    dome = g.sky.eq("dome") | (g.windspeed < 0)
    t = np.where(dome | (g.temp <= 0), 72, g.temp + rng.normal(0, temp_sd, len(g)))
    g["temp_c"] = np.where(dome, 0, t - 72)
    ws = (g.windspeed.clip(lower=0).fillna(0) + rng.normal(0, wind_sd, len(g))).clip(lower=0)
    for c, dirs in (("w_out", ["tolf", "tocf", "torf"]), ("w_in", ["fromlf", "fromcf", "fromrf"]), ("w_cross", ["ltor", "rtol"])):
        g[c] = np.where(~dome & g.winddir.isin(dirs), ws, 0)
    wrig = (g.park_id == "CHI11").astype(float); g["wrig_out"], g["wrig_in"] = g.w_out * wrig, g.w_in * wrig
    return g

def run(g, X):
    S = side_rows(g[g.outs >= 51].reset_index(drop=True))
    out = []
    for season in range(2021, 2026):
        tr = S[S.season < season].dropna(subset=X + ["runs"]); te = S[S.season == season]
        m = sm.GLM(tr.runs, sm.add_constant(tr[X]), family=sm.families.Poisson()).fit()
        o = te[["game_id", "home"]].copy(); o["mu"] = m.predict(sm.add_constant(te[X].fillna(0)))
        mt = m.predict(sm.add_constant(tr[X])); o["r"] = (mt**2).sum() / max(1e-6, ((tr.runs - mt) ** 2 - mt).sum())
        out.append(o)
    P = pd.concat(out).pivot(index="game_id", columns="home", values=["mu", "r"])
    P.columns = [f"{a}_{'h' if b else 'a'}" for a, b in P.columns]
    G = g.merge(P.reset_index(), on="game_id")
    G["h"] = G.home.map(lambda t: RS.get(t, t)); G["a"] = G.away.map(lambda t: RS.get(t, t))
    G["d"] = pd.to_datetime(G.date).dt.strftime("%Y-%m-%d")
    res = []
    for book in ("draftkings", "fanduel"):
        T = O[(O.market == "totals") & (O.sportsbook == book)].drop_duplicates(["date", "home", "away"], keep=False)
        T = T.merge(G, left_on=["date", "home", "away"], right_on=["d", "h", "a"])
        T = T[T.opening_total.notna() & T.opening_under_odds.notna()]
        po = p_over(T.mu_a, T.mu_h, T.r_a, T.r_h, T.opening_total)
        fo, fu = imp(T.opening_over_odds), imp(T.opening_under_odds); fair = fo / (fo + fu)
        e = (1 - po) - (1 - fair)
        z = T[e >= 0.08]; runs = z.home_score + z.away_score
        r_ = np.sign(runs - z.opening_total); nz = r_ != 0
        u = np.where(~nz, 0, np.where(r_ < 0, pay(z.opening_under_odds), -1))
        seas = " ".join(f"{s % 100}:{u[(z.season == s).values].sum():+.0f}" for s in sorted(z.season.unique()))
        res.append(f"{book[:2]} n={nz.sum():4} {(r_[nz] < 0).mean()*100:5.1f}% ROI {u.sum()/max(1,nz.sum())*100:+5.1f}% [{seas}]")
    return " || ".join(res)

V = {
    "v1 (pitchers, offense, park)": X1,
    "+ weather": X1 + ["temp", "w_out", "w_in", "w_cross", "wrig_out", "wrig_in"],
    "+ weather + bullpen/schedule": X1 + ["temp", "w_out", "w_in", "w_cross", "wrig_out", "wrig_in", "pen_tired", "dan"],
    "+ weather + bullpen/schedule + umpire": X1 + ["temp", "w_out", "w_in", "w_cross", "wrig_out", "wrig_in", "pen_tired", "dan", "ump"],
    "full v2 (+ lineup platoon)": X2,
}
for name, X in V.items():
    print(f"{name:42} {run(g0, X)}", flush=True)
morning = X1 + ["temp", "w_out", "w_in", "w_cross", "wrig_out", "wrig_in", "pen_tired", "dan", "ump"]
print(f"{'morning set, forecast-error weather':42} {run(with_weather_noise(g0, 3, 4), morning)}", flush=True)
print(f"{'morning set, worse forecasts (5F, 6mph)':42} {run(with_weather_noise(g0, 5, 6, 2), morning)}", flush=True)
