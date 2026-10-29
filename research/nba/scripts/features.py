"""Walk-forward features for every NBA game (only information from before the game's day).

Writes research/nba/data/features.csv with the games plus:
  rest / schedule: rest days, back-to-backs, 3-in-4 nights, road-trip / home-stand position, travel miles,
                   time zones crossed, altitude games
  ratings:         results-based (opponent-adjusted margin, recency-weighted) and market-based (team
                   ratings implied by earlier closing spreads), each turned into a predicted home margin
  pace:            recency-weighted points scored/allowed for a total prediction
"""
import math

from pathlib import Path

import numpy as np
import pandas as pd

NBA = Path(__file__).resolve().parents[1]  # research/nba

ARENAS = {  # lat, lon, utc offset (standard), altitude ft
    "ATL": (33.757, -84.396, -5, 1050), "BOS": (42.366, -71.062, -5, 20), "BKN": (40.683, -73.976, -5, 30),
    "CHA": (35.225, -80.839, -5, 750), "CHI": (41.881, -87.674, -6, 600), "CLE": (41.496, -81.688, -5, 650),
    "DAL": (32.790, -96.810, -6, 430), "DEN": (39.749, -105.008, -7, 5280), "DET": (42.341, -83.055, -5, 600),
    "GSW": (37.768, -122.388, -8, 10), "HOU": (29.751, -95.362, -6, 50), "IND": (39.764, -86.156, -5, 715),
    "LAC": (34.043, -118.267, -8, 300), "LAL": (34.043, -118.267, -8, 300), "MEM": (35.138, -90.051, -6, 340),
    "MIA": (25.781, -80.188, -5, 10), "MIL": (43.045, -87.917, -6, 620), "MIN": (44.979, -93.276, -6, 830),
    "NOP": (29.949, -90.082, -6, 10), "NYK": (40.751, -73.993, -5, 30), "OKC": (35.463, -97.515, -6, 1200),
    "ORL": (28.539, -81.384, -5, 100), "PHI": (39.901, -75.172, -5, 40), "PHX": (33.446, -112.071, -7, 1100),
    "POR": (45.532, -122.667, -8, 50), "SAC": (38.580, -121.500, -8, 30), "SAS": (29.427, -98.438, -6, 650),
    "TOR": (43.643, -79.379, -5, 250), "UTA": (40.768, -111.901, -7, 4300), "WAS": (38.898, -77.021, -5, 50),
}


def miles(a, b):
    (la1, lo1, *_), (la2, lo2, *_) = ARENAS[a], ARENAS[b]
    p1, p2 = math.radians(la1), math.radians(la2)
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 3959 * 2 * math.asin(math.sqrt(d))


def ridge_ratings(rows, teams, target, weights, lam):
    """Least-squares team ratings: target ≈ h + r[home] - r[away] (ridge toward 0)."""
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    A = np.zeros((n + 1, n + 1))
    b = np.zeros(n + 1)
    for (h, a, y), w in zip(rows, weights):
        x = np.zeros(n + 1)
        x[idx[h]] = 1
        x[idx[a]] = -1
        x[n] = 1
        A += w * np.outer(x, x)
        b += w * x * y
    A[:n, :n] += lam * np.eye(n)
    A[n, n] += 1e-6
    sol = np.linalg.solve(A, b)
    return {t: sol[idx[t]] for t in teams}, sol[n]


def build():
    g = pd.read_csv(f"{NBA}/data/games.csv")
    g["d"] = pd.to_datetime(g.date)
    g = g.sort_values(["d", "home"]).reset_index(drop=True)
    g["margin"] = g.home_pts - g.away_pts
    g["pts"] = g.home_pts + g.away_pts
    # the best available "market" number per game for ratings: close if known, else open
    g["mkt_spread"] = g.spread_close.fillna(g.spread_open)
    g["mkt_total"] = g.total_close.fillna(g.total_open)

    feats = []
    for season, sg in g.groupby("season", sort=True):
        teams = sorted(set(sg.home) | set(sg.away))
        last = {}  # team -> (date, city)
        trip = {t: 0 for t in teams}  # >0 consecutive road games, <0 consecutive home games
        history = []  # (day, home, away, margin, mkt_spread, home_pts, away_pts)
        days = sorted(sg.d.unique())
        for day in days:
            today = sg[sg.d == day]
            past = [h for h in history if h[0] < day]
            # ---- ratings from games before today (recency-weighted) ----
            if len(past) >= 30:
                age = np.array([(day - h[0]).days for h in past], dtype=float)
                w = 0.5 ** (age / 30.0)  # half-life 30 days
                res, hca_r = ridge_ratings([(h[1], h[2], h[3]) for h in past], teams, None, w, lam=8.0)
                mk_rows = [(h[1], h[2], -h[4]) for h in past if h[4] == h[4]]
                mk_w = [wi for h, wi in zip(past, w) if h[4] == h[4]]
                mkt, hca_m = ridge_ratings(mk_rows, teams, None, mk_w, lam=2.0)
                # pace: recency-weighted points for/against per team
                pf = {t: [0.0, 0.0] for t in teams}
                pa = {t: [0.0, 0.0] for t in teams}
                for h, wi in zip(past, w):
                    for t, f, a_ in ((h[1], h[5], h[6]), (h[2], h[6], h[5])):
                        pf[t][0] += wi * f
                        pf[t][1] += wi
                        pa[t][0] += wi * a_
                        pa[t][1] += wi
                lg = sum(h[5] + h[6] for h in past) / (2 * len(past))
            else:
                res = mkt = None
            for _, r in today.iterrows():
                H, A = r.home, r.away
                f = dict(idx=r.name)
                for side, t, opp_city in (("h", H, H), ("a", A, H)):
                    prev = last.get(t)
                    rest = (day - prev[0]).days - 1 if prev else 7
                    f[f"{side}_rest"] = min(rest, 7)
                    f[f"{side}_b2b"] = int(rest == 0)
                    recent = [x for x in history if (x[1] == t or x[2] == t) and 0 < (day - x[0]).days <= 3]
                    f[f"{side}_3in4"] = int(len(recent) >= 2)
                    from_city = prev[1] if prev else t
                    f[f"{side}_travel"] = miles(from_city, opp_city)
                    f[f"{side}_tz"] = ARENAS[opp_city][2] - ARENAS[from_city][2]
                    f[f"{side}_trip"] = trip[t]
                f["altitude"] = int(ARENAS[H][3] > 4000)
                if res is not None:
                    f["pred_res"] = hca_r + res[H] - res[A]
                    f["pred_mkt"] = hca_m + mkt[H] - mkt[A]
                    ph = (pf[H][0] / pf[H][1] + pa[A][0] / pa[A][1]) / 2 if pf[H][1] and pa[A][1] else lg
                    pa_ = (pf[A][0] / pf[A][1] + pa[H][0] / pa[H][1]) / 2 if pf[A][1] and pa[H][1] else lg
                    f["pred_total"] = ph + pa_
                feats.append(f)
            for _, r in today.iterrows():
                history.append((day, r.home, r.away, r.margin, r.mkt_spread, r.home_pts, r.away_pts))
                last[r.home] = (day, r.home)
                last[r.away] = (day, r.home)
                trip[r.home] = trip[r.home] - 1 if trip[r.home] <= 0 else -1
                trip[r.away] = trip[r.away] + 1 if trip[r.away] >= 0 else 1
        print("season", season, "done", flush=True)
    f = pd.DataFrame(feats).set_index("idx")
    out = g.join(f)
    # the site model's own predictions (from replay.ts), for comparison
    site = pd.read_csv(f"{NBA}/data/replay-open.csv")[["date", "home", "away", "pred_margin", "pred_total"]]
    out = out.merge(site.rename(columns={"pred_margin": "site_margin", "pred_total": "site_total"}), on=["date", "home", "away"], how="left")
    out.to_csv(f"{NBA}/data/features.csv", index=False)
    return out


if __name__ == "__main__":
    build()
