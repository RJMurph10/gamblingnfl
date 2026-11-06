"""MLS: situations vs Pinnacle's closing odds (football-data.co.uk, 2012-2026). Each idea is tested on 2012-2019
(found) and 2021-2026 (confirm); 2020 (bubble, no fans) is left out. Flat 1u bets at Pinnacle closing decimals.
  python3 research/mls/situations.py"""
import math
import numpy as np, pandas as pd

d = pd.read_csv("research/mls/data/football-data-USA.csv", encoding="utf-8-sig")
d = d[[c for c in d.columns if not c.startswith("Unnamed")]]
d = d[d.PSCH.notna() & d.PSCD.notna() & d.PSCA.notna()].copy()
d["dt"] = pd.to_datetime(d.Date, dayfirst=True)
d = d.sort_values("dt").reset_index(drop=True)
# stadium (lat, lon, metres above sea level, artificial turf)
S = {
    "Atlanta Utd": (33.755, -84.401, 320, 1), "Austin FC": (30.388, -97.719, 230, 0), "CF Montreal": (45.563, -73.553, 30, 0),
    "Charlotte": (35.226, -80.853, 230, 1), "Chicago Fire": (41.862, -87.617, 180, 0), "Chivas USA": (33.864, -118.261, 10, 0),
    "Colorado Rapids": (39.806, -104.892, 1600, 0), "Columbus Crew": (39.968, -83.017, 230, 0), "DC United": (38.868, -77.013, 10, 0),
    "FC Cincinnati": (39.111, -84.522, 150, 0), "FC Dallas": (33.155, -96.835, 200, 0), "Houston Dynamo": (29.752, -95.352, 15, 0),
    "Inter Miami": (26.193, -80.161, 3, 0), "Los Angeles FC": (34.013, -118.284, 60, 0), "Los Angeles Galaxy": (33.864, -118.261, 10, 0),
    "Minnesota United": (44.953, -93.165, 270, 0), "Nashville SC": (36.130, -86.766, 150, 0), "New England Revolution": (42.091, -71.264, 90, 1),
    "New York City": (40.829, -73.926, 15, 0), "New York Red Bulls": (40.737, -74.150, 5, 0), "Orlando City": (28.541, -81.389, 30, 0),
    "Philadelphia Union": (39.832, -75.379, 5, 0), "Portland Timbers": (45.521, -122.692, 20, 1), "Real Salt Lake": (40.583, -111.893, 1350, 0),
    "San Diego FC": (32.784, -117.122, 20, 0), "San Jose Earthquakes": (37.351, -121.925, 20, 0), "Seattle Sounders": (47.595, -122.332, 5, 1),
    "Sporting Kansas City": (39.122, -94.823, 250, 0), "St. Louis City": (38.631, -90.211, 140, 0), "Toronto FC": (43.633, -79.419, 80, 0),
    "Vancouver Whitecaps": (49.277, -123.112, 5, 1),
}
def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (S[a][0], S[a][1], S[b][0], S[b][1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3959 * 2 * math.asin(math.sqrt(h))
d["travel"] = [miles(a, h) for h, a in zip(d.Home, d.Away)]
d["tz_shift"] = [(S[h][1] - S[a][1]) / 15 for h, a in zip(d.Home, d.Away)]  # >0: visitor travelled east
d["alt_home"] = [S[h][2] >= 1000 and S[a][2] < 1000 for h, a in zip(d.Home, d.Away)]
d["turf_home"] = [S[h][3] == 1 and S[a][3] == 0 for h, a in zip(d.Home, d.Away)]
# rest days since each team's previous MLS match
last = {}
rh, ra = [], []
for r in d.itertuples():
    rh.append((r.dt - last[r.Home]).days if r.Home in last else 99)
    ra.append((r.dt - last[r.Away]).days if r.Away in last else 99)
    last[r.Home] = r.dt; last[r.Away] = r.dt
d["rest_h"], d["rest_a"] = rh, ra
d["period"] = np.where(d.Season <= 2019, "2012-19", np.where(d.Season >= 2021, "2021-26", "2020"))
d = d[d.period != "2020"]
inv = 1 / d.PSCH + 1 / d.PSCD + 1 / d.PSCA
d["p_h"], d["p_d"], d["p_a"] = 1 / d.PSCH / inv, 1 / d.PSCD / inv, 1 / d.PSCA / inv

def bet(mask, side):
    odds = {"H": d.PSCH, "D": d.PSCD, "A": d.PSCA}[side]
    out = []
    for per in ("2012-19", "2021-26"):
        m = mask & (d.period == per)
        n = int(m.sum())
        if n == 0: out.append(f"{per}: -"); continue
        win = d.Res[m] == side
        roi = ((odds[m] - 1) * win - (~win)).mean() * 100
        out.append(f"{per}: {int(win.sum())}/{n} ({win.mean()*100:.1f}% vs fair {d['p_'+side.lower()][m].mean()*100:.1f}%) ROI {roi:+.1f}%")
    return " | ".join(out)

all_ = d.index == d.index
print("Pinnacle margin (avg overround):", round((inv.mean() - 1) * 100, 2), "%")
print("\nBaselines (every match):")
for s in "HDA": print(f"  bet {s}:", bet(all_, s))
print("\nFavourite / longshot (home side):")
for lo, hi in ((1.0, 1.6), (1.6, 2.2), (2.2, 3.0), (3.0, 99)):
    print(f"  home odds {lo}-{hi}:", bet((d.PSCH >= lo) & (d.PSCH < hi), "H"))
print("\nSituations (bet the side that should benefit):")
for name, mask, side in [
    ("visitor travelled 2,000+ miles -> home", d.travel >= 2000, "H"),
    ("visitor travelled 1,500+ miles -> home", d.travel >= 1500, "H"),
    ("visitor travelled < 400 miles -> away", d.travel < 400, "A"),
    ("visitor crossed 3 time zones -> home", d.tz_shift.abs() >= 2.5, "H"),
    ("west-coast visitor playing east (2.5+ zones) -> home", d.tz_shift >= 2.5, "H"),
    ("east-coast visitor playing west (2.5+ zones) -> home", d.tz_shift <= -2.5, "H"),
    ("altitude home (COL, RSL) vs low visitor -> home", d.alt_home, "H"),
    ("turf home vs grass visitor -> home", d.turf_home, "H"),
    ("home rested 6+ days, visitor 3 or fewer -> home", (d.rest_h >= 6) & (d.rest_a <= 3), "H"),
    ("visitor rested 6+, home 3 or fewer -> away", (d.rest_a >= 6) & (d.rest_h <= 3), "A"),
    ("both teams on short rest -> draw", (d.rest_h <= 3) & (d.rest_a <= 3), "D"),
    ("evenly matched (home 2.2-2.8) -> draw", (d.PSCH >= 2.2) & (d.PSCH <= 2.8), "D"),
    ("first 4 weeks of the season -> home", d.groupby("Season").dt.transform(lambda x: (x - x.min()).dt.days) < 28, "H"),
    ("decision day / last 2 weeks -> draw", d.groupby("Season").dt.transform(lambda x: (x.max() - x).dt.days) < 14, "D"),
]:
    print(f"  {name:<52}", bet(mask, side))

print("\nFlipped (after seeing the travel results, so treat as a new idea to confirm):")
for name, mask, side in [
    ("visitor travelled 2,000+ miles -> away", d.travel >= 2000, "A"),
    ("visitor travelled 2,000+ miles -> draw", d.travel >= 2000, "D"),
    ("visitor crossed 3 time zones -> away", d.tz_shift.abs() >= 2.5, "A"),
    ("east visitor playing west (2.5+ zones) -> away", d.tz_shift <= -2.5, "A"),
]:
    print(f"  {name:<52}", bet(mask, side))
print("\nTurf by season (home side, turf home vs grass visitor):")
for s_, g in d[d.turf_home].groupby("Season"):
    win = g.Res == "H"; roi = ((g.PSCH - 1) * win - (~win)).mean() * 100
    print(f"  {s_}: {int(win.sum())}/{len(g)} ROI {roi:+.1f}%")
