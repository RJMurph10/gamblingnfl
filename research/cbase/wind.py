"""College baseball: does the wind's direction matter, not just its speed?

Park orientations aren't on file, so each home park's response to the wind is learned from its games:
total runs left over after the model (v2 with wind speed) ~ a_p · east wind + b_p · north wind (the
direction the wind blows toward, mph), ridge-shrunk toward zero, fit on earlier seasons only. A park whose
field points east gets runs when the wind blows east, and so on. Also tested: one league-wide direction
(most fields point roughly east-northeast).

Writes preds_wind_<variant>.csv.gz with lam_h / lam_a adjusted (half the total adjustment each side) and
simulated p_over for the opening total, for compare.py.

  python research/cbase/wind.py <preds_v3 csv.gz> <team_map.json> <env dir> <out dir>
"""

import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

PREDS, TEAM_MAP, ENV, OUT = sys.argv[1:5]
OUT = Path(OUT)
OUT.mkdir(parents=True, exist_ok=True)
P = pd.read_csv(PREDS, low_memory=False)
P["date"] = pd.to_datetime(P["date"])
team_map = json.loads(Path(TEAM_MAP).read_text())
venues = json.loads((Path(ENV) / "venues.json").read_text())
weather = {int(p.stem.split("-")[1]): json.loads(p.read_text()) for p in Path(ENV).glob("weather-*.json")}

ux = np.full(len(P), np.nan)
uy = np.full(len(P), np.nan)
for i, r in enumerate(P.itertuples()):
    e = team_map.get(r.home)
    v = venues.get(e) if e else None
    w = weather.get(int(r.season), {}).get(e) if e else None
    if not v or not w or "d" not in w or not v.get("tz"):
        continue
    hour = None
    if isinstance(r.espn_start, str) and r.espn_start:
        hour = datetime.fromisoformat(r.espn_start.replace("Z", "+00:00")).astimezone(ZoneInfo(v["tz"])).hour
    if hour is None:
        hour = 14 if r.date.dayofweek in (5, 6) else 18
    day_i = (r.date - pd.Timestamp(w["start"])).days
    xs, ys = [], []
    for h in range(hour, hour + 3):
        j = day_i * 13 + (h - 10)
        if 10 <= h <= 22 and 0 <= j < len(w["d"]) and w["d"][j] is not None and w["w"][j] is not None:
            to = np.radians((w["d"][j] + 180) % 360)  # direction the wind blows toward
            xs.append(w["w"][j] * np.sin(to))
            ys.append(w["w"][j] * np.cos(to))
    if xs:
        ux[i], uy[i] = np.mean(xs), np.mean(ys)
P["ux"], P["uy"] = ux, uy
print(f"wind vector for {np.isfinite(ux).mean():.0%} of games")

base = P[P.lam_h.notna() & np.isfinite(P.ux)].copy()
base["resid"] = (base.hr + base.ar) - (base.lam_h + base.lam_a)


def fit_parks(tr, lam):
    """Per-park (a, b): ridge on that park's games."""
    out = {}
    for park, g in tr.groupby("home"):
        X = g[["ux", "uy"]].values
        y = g["resid"].values - g["resid"].values.mean()
        out[park] = np.linalg.solve(X.T @ X + lam * np.eye(2), X.T @ y)
    return out


def fit_global(tr, bearing):
    to = np.radians(bearing)
    x = tr.ux * np.sin(to) + tr.uy * np.cos(to)  # wind blowing toward the bearing (out to center)
    return float((x * tr.resid).sum() / (x * x).sum())


variants = {"park_l200": ("park", 200.0), "park_l800": ("park", 800.0), "global_ene": ("global", 60.0)}
for name, (kind, arg) in variants.items():
    Q = P.copy()
    adj_all = np.zeros(len(Q))
    for season in (2024, 2025, 2026):
        tr = base[(base.season >= 2022) & (base.season < season)]
        te = Q.index[(Q.season == season) & np.isfinite(Q.ux) & Q.lam_h.notna()]
        if kind == "park":
            coef = fit_parks(tr, arg)
            adj = np.array([coef.get(h, np.zeros(2)) @ np.array([x, y]) for h, x, y in zip(Q.loc[te, "home"], Q.loc[te, "ux"], Q.loc[te, "uy"])])
        else:
            c = fit_global(tr, arg)
            to = np.radians(arg)
            adj = c * (Q.loc[te, "ux"] * np.sin(to) + Q.loc[te, "uy"] * np.cos(to)).values
            print(f"{name} {season}: {c:+.3f} runs per mph blowing out (toward {arg:.0f}°)")
        Q.loc[te, "lam_h"] += adj / 2
        Q.loc[te, "lam_a"] += adj / 2
        adj_all[Q.index.get_indexer(te)] = adj
    ok = Q.lam_h.notna() & (Q.season >= 2024) & np.isfinite(Q.ux)
    for nm, D in (("before", P), ("after", Q)):
        e = (D.loc[ok, "lam_h"] + D.loc[ok, "lam_a"]) - (D.loc[ok, "hr"] + D.loc[ok, "ar"])
        print(f"  {name} {nm}: total MAE {np.mean(np.abs(e)):.4f}, sd of adjustment {np.std(adj_all[ok.values]):.3f}")
    # validation on the residual: does the out-of-sample adjustment predict the residual?
    rr = (P.loc[ok, "hr"] + P.loc[ok, "ar"]) - (P.loc[ok, "lam_h"] + P.loc[ok, "lam_a"])
    a = adj_all[ok.values]
    print(f"  {name}: corr(adjustment, residual) {np.corrcoef(a, rr)[0, 1]:+.4f}, slope {np.polyfit(a, rr, 1)[0]:+.3f}")
    Q.to_csv(OUT / f"preds_wind_{name}.csv.gz", index=False)

# ---- per-park wind coefficients for the season builder (ridge 800): each season fit on earlier seasons ----
coefs = {}
for season in (2024, 2025, 2026, 2027):
    tr = base[(base.season >= 2022) & (base.season < season)]
    coefs[str(season)] = {k: [round(float(v[0]), 4), round(float(v[1]), 4)] for k, v in fit_parks(tr, 800.0).items()}
(OUT / "wind_parks.json").write_text(json.dumps(coefs, separators=(",", ":")))
print("wind_parks.json:", {k: len(v) for k, v in coefs.items()})
