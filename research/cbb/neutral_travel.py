"""Neutral-site travel (men's CBB): in "neutral" games, does the team that is much closer to the arena
(a pseudo home game) cover more than the line allows? Distances run from each school's home arena city
(its most common home-game city that season) to the neutral arena's city.
Placebo: 2020-21 was played mostly without fans, so a crowd effect should vanish that season.
  python3 research/cbb/neutral_travel.py <venues dir> <cities.json>"""
import sys, json, gzip, math, collections
import numpy as np, pandas as pd

VEN, CITIES = sys.argv[1], sys.argv[2]
SEAS = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
cities = json.load(open(CITIES))
STATES = {"alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar", "california": "ca", "colorado": "co",
          "connecticut": "ct", "delaware": "de", "florida": "fl", "georgia": "ga", "hawaii": "hi", "idaho": "id",
          "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks", "kentucky": "ky", "louisiana": "la",
          "maine": "me", "maryland": "md", "massachusetts": "ma", "michigan": "mi", "minnesota": "mn",
          "mississippi": "ms", "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv",
          "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc",
          "north dakota": "nd", "ohio": "oh", "oklahoma": "ok", "oregon": "or", "pennsylvania": "pa",
          "rhode island": "ri", "south carolina": "sc", "south dakota": "sd", "tennessee": "tn", "texas": "tx",
          "utah": "ut", "vermont": "vt", "virginia": "va", "washington": "wa", "west virginia": "wv",
          "wisconsin": "wi", "wyoming": "wy", "district of columbia": "dc"}
MANUAL = {  # common tournament sites missing from the city list
    "paradise island": (25.085, -77.32), "nassau": (25.058, -77.343), "cancun": (21.161, -86.851),
    "montego bay": (18.47, -77.92), "st. thomas": (18.34, -64.93), "saint thomas": (18.34, -64.93),
    "charlotte amalie": (18.34, -64.93), "san juan": (18.466, -66.106), "fajardo": (18.326, -65.652),
    "lahaina": (20.875, -156.68), "honolulu": (21.307, -157.858), "uncasville": (41.434, -72.11),
    "washington": (38.895, -77.036), "new york": (40.75, -73.99), "bronx": (40.85, -73.87),
    "maui": (20.875, -156.68), "villanova": (40.037, -75.345), "university park": (40.80, -77.86),
    "laval": (45.57, -73.69), "george town": (19.29, -81.37), "moon township": (40.52, -80.22), "estero": (26.438, -81.807), "niceville": (30.517, -86.482),
}
miss = collections.Counter()

def geo(city, state, country):
    c = (city or "").strip().lower()
    if not c: return None
    s = (state or "").strip().lower()
    s = STATES.get(s, s)
    for k in (f"{c}|{s}", f"{c.replace('st.', 'saint')}|{s}", f"{c.replace('saint', 'st.')}|{s}"):
        if k in cities: return cities[k]
    if c in MANUAL: return MANUAL[c]
    miss[(city, state, country)] += 1
    return None

def miles(p, q):
    la1, lo1, la2, lo2 = map(math.radians, (p[0], p[1], q[0], q[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3959 * 2 * math.asin(math.sqrt(h))

rows = []
home_by_team_all = collections.defaultdict(collections.Counter)
season_venues = {}
for s in SEAS:
    try:
        v = json.load(open(f"{VEN}/venues-{s}.json"))
    except FileNotFoundError:
        continue
    season_venues[s] = v
    for gid, date, h, a, neu, name, city, st, country in v:
        if not neu and city: home_by_team_all[h][(city, st, country)] += 1
for s, v in season_venues.items():
    hb = collections.defaultdict(collections.Counter)
    for gid, date, h, a, neu, name, city, st, country in v:
        if not neu and city: hb[h][(city, st, country)] += 1
    def home_of(t):
        c = hb.get(t) or home_by_team_all.get(t)
        return geo(*c.most_common(1)[0][0]) if c else None
    ven = {r[0]: r for r in v}
    try:
        games = [json.loads(l) for l in gzip.open(f"research/cbb/data/{s}.jsonl.gz", "rt")]
    except FileNotFoundError:
        games = []
    for g in games:
        if not g.get("neutral") or g["h"][1] is None: continue
        r = ven.get(g["id"])
        if not r: continue
        site = geo(r[6], r[7], r[8])
        ph, pa = home_of(g["h"][0]), home_of(g["a"][0])
        if not (site and ph and pa): continue
        c = g.get("close") or [None] * 4; o = g.get("open") or [None] * 4
        rows.append(dict(season=s, date=g["date"], id=g["id"], h=g["h"][0], a=g["a"][0], note=g.get("note") or "",
                         type=g["type"], margin=g["h"][1] - g["a"][1], pts=g["h"][1] + g["a"][1],
                         close=c[0], open=o[0], ctot=c[1], otot=o[1], dh=miles(ph, site), da=miles(pa, site),
                         lngh=ph[1], lnga=pa[1], lngs=site[1], city=r[6]))
D = pd.DataFrame(rows)
for k in ("close", "open", "ctot", "otot"): D[k] = pd.to_numeric(D[k], errors="coerce")
print(f"neutral games with both distances: {len(D)}; unresolved arena/home cities (top): {miss.most_common(8)}")

# orient every game to the CLOSER team
D["adv"] = (D.da - D.dh).abs()             # miles closer
D["near"] = np.minimum(D.dh, D.da)          # closer team's distance
D["far"] = np.maximum(D.dh, D.da)
hc = D.dh <= D.da
D["m"] = np.where(hc, D.margin, -D.margin)                 # closer team's margin
D["sc"] = np.where(hc, D.close, -D.close)                  # closer team's spread (neg = favored)
D["so"] = np.where(hc, D.open, -D.open)
D["cov_c"] = D.m + D.sc; D["cov_o"] = D.m + D.so
D["post"] = D.type == 3

def rec(x, key):
    x = x[x[key].notna() & (x[key] != 0)]
    w, l = int((x[key] > 0).sum()), int((x[key] < 0).sum())
    return f"{w}-{l} {w / max(1, w + l) * 100:5.1f}%  avg {x[key].mean():+5.2f}"

def table(title, d):
    print(f"\n{title}")
    print(f"  {'':34} {'vs close':>26} {'vs opener':>26}   by season (close)")
    for lab, x in d:
        by = " ".join(f"{s[2:4]}:{(g.cov_c > 0).sum()}-{(g.cov_c < 0).sum()}" for s, g in x[x.cov_c.notna()].groupby("season"))
        print(f"  {lab:34} {rec(x, 'cov_c'):>26} {rec(x, 'cov_o'):>26}   {by}")

fans = D[D.season != "2020-21"]
table("Closer team ATS, by how much closer (all seasons except 2020-21)", [
    ("all neutral games", fans),
    ("0-100 mi closer", fans[fans.adv < 100]),
    ("100-300", fans[(fans.adv >= 100) & (fans.adv < 300)]),
    ("300-700", fans[(fans.adv >= 300) & (fans.adv < 700)]),
    ("700+", fans[fans.adv >= 700]),
])
table("Pseudo home game: closer team within X miles, other team 300+ away", [
    (f"near <= {r} mi, far 300+", fans[(fans.near <= r) & (fans.far >= 300)]) for r in (50, 100, 200)
] + [("  ...favorite", fans[(fans.near <= 100) & (fans.far >= 300) & (fans.sc < 0)]),
     ("  ...underdog", fans[(fans.near <= 100) & (fans.far >= 300) & (fans.sc > 0)]),
     ("  ...regular season", fans[(fans.near <= 100) & (fans.far >= 300) & ~fans.post]),
     ("  ...postseason (conf tourney / NCAA)", fans[(fans.near <= 100) & (fans.far >= 300) & fans.post])])
nf = D[D.season == "2020-21"]
table("Placebo 2020-21 (mostly no fans)", [("near <= 100, far 300+", nf[(nf.near <= 100) & (nf.far >= 300)]), ("all", nf)])

# time zones: the farther team crossed 2+ time zones (~22.5 deg longitude) to get there
D["tzfar"] = np.where(hc, (D.lnga - D.lngs).abs(), (D.lngh - D.lngs).abs())
D["tznear"] = np.where(hc, (D.lngh - D.lngs).abs(), (D.lnga - D.lngs).abs())
fans = D[D.season != "2020-21"]
table("Time zones: farther team crossed 2+ zones, closer team within 1", [
    ("all", fans[(fans.tzfar >= 22.5) & (fans.tznear < 11)]),
    ("farther team went WEST", fans[(fans.tzfar >= 22.5) & (fans.tznear < 11) & (np.where(D.dh <= D.da, D.lnga, D.lngh)[fans.index] > fans.lngs)]),
    ("farther team went EAST", fans[(fans.tzfar >= 22.5) & (fans.tznear < 11) & (np.where(D.dh <= D.da, D.lnga, D.lngh)[fans.index] < fans.lngs)]),
])
# totals: long trips and scoring
D["ov_c"] = D.pts - D.ctot; D["ov_o"] = D.pts - D.otot
fans = D[D.season != "2020-21"]
print("\nTotals (overs vs close / opener) by the farther team's trip:")
for lab, x in (("both within 300 mi", fans[fans.far < 300]), ("far team 300-1000", fans[(fans.far >= 300) & (fans.far < 1000)]),
               ("far team 1000+", fans[fans.far >= 1000]), ("both 1000+", fans[fans.near >= 1000])):
    xc = x[x.ov_c.notna() & (x.ov_c != 0)]; xo = x[x.ov_o.notna() & (x.ov_o != 0)]
    print(f"  {lab:22} close {int((xc.ov_c > 0).sum())}-{int((xc.ov_c < 0).sum())} avg {xc.ov_c.mean():+.2f}   open {int((xo.ov_o > 0).sum())}-{int((xo.ov_o < 0).sum())} avg {xo.ov_o.mean():+.2f}")
D.to_pickle("/tmp/claude-0/neutral_travel.pkl")
