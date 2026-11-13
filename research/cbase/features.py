"""College baseball model v2: starting pitchers, weather, altitude and travel on top of the run ratings.

Inputs
  preds   research/cbase/model.py output (lam_h / lam_a, walk-forward run ratings, lines)
  games   research/cbase/build_games.py output (for ESPN start times) and its team_map.json
  box     cbase-history box/<year>.jsonl.gz (scripts/cbase/export-box.mjs): every game's pitchers in order
  env     cbase-history env/venues.json and env/weather-<year>.json (scripts/cbase/venues.mjs,
          scripts/cbase/weather-history.mjs)

Features, each known before first pitch:
  starter quality   the starter's runs allowed per inning in earlier starts (this season, plus last season
                    at half weight), pulled toward the league rate by 15 innings; times his usual innings.
                    "actual" uses the box score's starter; "projected" uses the team's starter from its last
                    game on the same kind of day (Fri / Sat / Sun / midweek) within 10 days, which is what
                    can be known before a game (no NCAA probables).
  weather           temperature, wind speed and rain at the home team's town over the first three hours
  altitude          the home town's elevation
  travel            the visitors' time-zone change and distance from home

Second stage: each side's runs minus the rating model's expected runs, regressed on the features,
fit on earlier seasons only (walk-forward by season). Writes preds with lam_h / lam_a adjusted, one file
per feature set, for research/cbase/evaluate.py.

  python research/cbase/features.py <preds.csv.gz> <games.csv.gz> <team_map.json> <box dir> <env dir> <out dir>
"""

import gzip
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

PREDS, GAMES, TEAM_MAP, BOX, ENV, OUT = sys.argv[1:7]
OUT = Path(OUT)
OUT.mkdir(parents=True, exist_ok=True)

P = pd.read_csv(PREDS, low_memory=False)
P["ncaa_id"] = P["ncaa_id"].astype(str)
P["date"] = pd.to_datetime(P["date"])
G = pd.read_csv(GAMES, low_memory=False, usecols=["season", "date", "ncaa_id", "espn_start"])
G["ncaa_id"] = G["ncaa_id"].astype(str)
G["date"] = pd.to_datetime(G["date"])
P = P.merge(G, on=["season", "date", "ncaa_id"], how="left")
team_map = json.loads(Path(TEAM_MAP).read_text())
venues = json.loads((Path(ENV) / "venues.json").read_text())

# ---------------------------------------------------------------- pitchers
box = {}
for p in sorted(Path(BOX).glob("*.jsonl.gz")):
    with gzip.open(p, "rt") as f:
        for line in f:
            g = json.loads(line)
            box[(g["date"], str(g["id"]))] = g


def ip_outs(ip):
    """'5.2' innings → 17 outs."""
    if ip in (None, ""):
        return 0
    s = str(ip)
    whole, _, frac = s.partition(".")
    try:
        return int(whole or 0) * 3 + int(frac or 0)
    except ValueError:
        return 0


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


# some box scores (much of 2025) leave names blank: a team's jersey number → the name it goes with that season
num_name = {}
for (d, _), g in box.items():
    for t in g["teams"]:
        for p in t["pitchers"]:
            if (p[1] or "").strip() and p[2] is not None:
                num_name.setdefault((d[:4], t["seo"], p[2]), f"{(p[1] or '').strip().lower()}|{(p[0] or '').strip().lower()[:1]}")


def pkey(team, p, year):
    first, last = (p[0] or "").strip().lower(), (p[1] or "").strip().lower()
    if last:
        return f"{team}|{last}|{first[:1]}"
    named = num_name.get((year, team, p[2]))
    return f"{team}|{named}" if named else f"{team}|#{p[2]}"


def starter_of(pitchers):
    """The starting pitcher: position "p" and in the starting lineup; else the one listed as a starter."""
    for p in pitchers:
        if len(p) > 12 and p[12] and str(p[11]).lower() == "p":
            return p
    for p in pitchers:
        if len(p) > 12 and p[12]:
            return p
    return None


LEAGUE_RATE = 0.70  # runs per inning, updated from the data below
SHRINK_IP = 15.0
IP_PRIOR, IP_PRIOR_N = 4.5, 3.0

# chronological pass over every game: features use only earlier starts
P = P.sort_values(["date", "ncaa_id"]).reset_index(drop=True)
hist = defaultdict(lambda: {"outs": 0.0, "runs": 0.0, "starts": 0.0, "souts": 0.0})  # this season
last = {}  # last season's totals per pitcher
team_starts = defaultdict(list)  # team -> [(date, dow kind, pitcher key)]
lg = {"outs": 1.0, "runs": LEAGUE_RATE}
season_now = None


def kind(d):
    w = d.dayofweek
    return {4: "fri", 5: "sat", 6: "sun"}.get(w, "mid")


def rating(k):
    h = hist[k]
    l = last.get(k, {"outs": 0, "runs": 0, "starts": 0, "souts": 0})
    inn = h["outs"] / 3 + 0.5 * l["outs"] / 3
    runs = h["runs"] + 0.5 * l["runs"]
    lr = lg["runs"] / max(lg["outs"] / 3, 1)
    rate = (runs + SHRINK_IP * lr) / (inn + SHRINK_IP)
    st = h["starts"] + 0.5 * l["starts"]
    sip = (h["souts"] / 3 + 0.5 * l["souts"] / 3 + IP_PRIOR * IP_PRIOR_N) / (st + IP_PRIOR_N)
    return rate, sip, lr


feat = {c: np.full(len(P), np.nan) for c in (
    "sp_h", "sp_a", "spd_h", "spd_a", "psp_h", "psp_a", "pspd_h", "pspd_a", "sp_known")}
rows_by_day = P.groupby("date").indices
for day in sorted(rows_by_day):
    idxs = rows_by_day[day]
    season = int(P.at[idxs[0], "season"])
    if season != season_now:
        # new season: last season's totals carry at half weight
        if season_now is not None:
            last = {k: dict(v) for k, v in hist.items()}
        hist = defaultdict(lambda: {"outs": 0.0, "runs": 0.0, "starts": 0.0, "souts": 0.0})
        team_starts = defaultdict(list)
        season_now = season
    d = pd.Timestamp(day)
    updates = []
    for i in idxs:
        g = box.get((d.strftime("%Y-%m-%d"), P.at[i, "ncaa_id"]))
        sides = {}
        if g:
            for t in g["teams"]:
                sides["h" if t["home"] else "a"] = t
        for s, team in (("h", P.at[i, "home"]), ("a", P.at[i, "away"])):
            # this side's starter quality, as a runs-per-game effect against the OTHER side
            o = "a" if s == "h" else "h"
            t = sides.get(s)
            # team's usual starter (average of its earlier starts' ratings)
            prev = team_starts.get(team, [])
            team_avg = None
            if prev:
                rs = [rating(k)[0] * rating(k)[1] for _, _, k in prev[-15:]]
                team_avg = float(np.mean(rs))
            sp = starter_of(t["pitchers"]) if t else None
            if sp:
                k = pkey(team, sp, str(season))
                rate, sip, lr = rating(k)
                feat[f"sp_{s}"][i] = (lr - rate) * sip  # runs saved vs a league-average starter
                if team_avg is not None:
                    feat[f"spd_{s}"][i] = team_avg - rate * sip  # better than his team's usual starter
                feat["sp_known"][i] = 1
            # projected: last start on the same kind of day within 10 days
            kd = kind(d)
            cand = [k for dd, kk, k in reversed(prev) if kk == kd and (d - dd).days <= 10]
            if cand:
                rate, sip, lr = rating(cand[0])
                feat[f"psp_{s}"][i] = (lr - rate) * sip
                if team_avg is not None:
                    feat[f"pspd_{s}"][i] = team_avg - rate * sip
            if t:
                updates.append((team, t, d))
    # after the day's games: add their pitching lines
    for team, t, d0 in updates:
        sp = starter_of(t["pitchers"])
        for p in t["pitchers"]:
            k = pkey(team, p, str(d0.year))
            outs = ip_outs(p[3])
            r = num(p[5])
            hist[k]["outs"] += outs
            hist[k]["runs"] += r
            lg["outs"] += outs
            lg["runs"] += r
            if p is sp:
                hist[k]["starts"] += 1
                hist[k]["souts"] += outs
                team_starts[team].append((d0, kind(d0), k))
for c, v in feat.items():
    P[c] = v
print(f"box scores matched: {int(np.nansum(P.sp_known))} of {len(P)} games; league runs/inning {lg['runs'] / (lg['outs'] / 3):.3f}")

# ---------------------------------------------------------------- venues, weather, travel
weather = {}
for p in sorted(Path(ENV).glob("weather-*.json")):
    weather[int(p.stem.split("-")[1])] = json.loads(p.read_text())


def venue(team):
    e = team_map.get(team)
    v = venues.get(e) if e else None
    return v if v and v.get("lat") is not None and v.get("tz") else None


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def utc_offset(tz, d):
    return ZoneInfo(tz).utcoffset(datetime(d.year, d.month, d.day, 15)).total_seconds() / 3600


temp, wind, rain, elev, tzd, dist, east = (np.full(len(P), np.nan) for _ in range(7))
for i, r in P.iterrows():
    vh, va = venue(r.home), venue(r.away)
    if not vh:
        continue
    d = r.date
    elev[i] = (vh["elev"] or 0) * 3.281 / 1000  # thousands of feet
    if va:
        dist[i] = hav(vh, va) / 1000  # thousands of km
        diff = utc_offset(vh["tz"], d) - utc_offset(va["tz"], d)
        tzd[i] = abs(diff)
        east[i] = max(diff, 0)  # hours the visitors moved east
    # first pitch, local hour
    hour = None
    if isinstance(r.espn_start, str) and r.espn_start:
        t = datetime.fromisoformat(r.espn_start.replace("Z", "+00:00")).astimezone(ZoneInfo(vh["tz"]))
        hour = t.hour
    if hour is None:
        hour = 14 if d.dayofweek in (5, 6) else 18
    w = weather.get(int(r.season), {}).get(team_map.get(r.home))
    if not w:
        continue
    day_i = (d - pd.Timestamp(w["start"])).days
    hs = [h for h in range(hour, hour + 3) if 10 <= h <= 22]
    ix = [day_i * 13 + (h - 10) for h in hs]
    vals = lambda arr: [arr[j] for j in ix if 0 <= j < len(arr) and arr[j] is not None]
    tv, wv, pv = vals(w["t"]), vals(w["w"]), vals(w["p"])
    if tv:
        temp[i] = np.mean(tv)
    if wv:
        wind[i] = np.mean(wv)
    if pv:
        rain[i] = np.sum(pv)
P["temp"], P["wind"], P["rain"], P["elev"], P["tzd"], P["dist"], P["east"] = temp, wind, rain, elev, tzd, dist, east
print(f"venue for {np.isfinite(elev).mean():.0%} of games, weather {np.isfinite(temp).mean():.0%}, visitors' venue {np.isfinite(tzd).mean():.0%}")
P.to_csv(OUT / "features.csv.gz", index=False)

# ---------------------------------------------------------------- second stage
SETS = {
    "base": [],
    "pitchers": ["sp", "spd"],
    "pitchers_proj": ["psp", "pspd"],
    "env": ["temp", "wind", "elev", "travel"],
    "all": ["sp", "spd", "temp", "wind", "elev", "travel"],
    "all_proj": ["psp", "pspd", "temp", "wind", "elev", "travel"],
    # rain's fitted effect flips sign from season to season, so it's tested here but left out of the rest
    "all_proj_rain": ["psp", "pspd", "temp", "wind", "rain", "elev", "travel"],
}


def side_rows(D, feats):
    """Two rows per game (home scoring, away scoring) with the features that move that side's runs."""
    out = []
    for s, o in (("h", "a"), ("a", "h")):
        X = pd.DataFrame(index=D.index)
        if "sp" in feats:
            X["opp_sp"] = D[f"sp_{o}"].fillna(0)
        if "spd" in feats:
            X["opp_spd"] = D[f"spd_{o}"].fillna(0)
        if "psp" in feats:
            X["opp_sp"] = D[f"psp_{o}"].fillna(0)
        if "pspd" in feats:
            X["opp_spd"] = D[f"pspd_{o}"].fillna(0)
        if "temp" in feats:
            X["temp"] = (D["temp"] - 65).fillna(0)
        if "wind" in feats:
            X["wind"] = (D["wind"] - 8).fillna(0)
        if "rain" in feats:
            X["rain"] = D["rain"].fillna(0).clip(0, 1)
        if "elev" in feats:
            X["elev"] = D["elev"].fillna(0)
        if "travel" in feats:
            # only the visitors travel; their hitting (side "a") and their pitching (side "h" scoring)
            X["tz_bat"] = (D["tzd"].fillna(0) if s == "a" else 0.0)
            X["tz_pitch"] = (D["tzd"].fillna(0) if s == "h" else 0.0)
            X["dist_bat"] = (D["dist"].fillna(0) if s == "a" else 0.0)
        y = (D["hr"] if s == "h" else D["ar"]) - D[f"lam_{s}"]
        out.append((s, X, y))
    return out


base = P[P.lam_h.notna()].copy()
for name, feats in SETS.items():
    Q = P.copy()
    coefs = {}
    for season in sorted(base.season.unique()):
        if season < 2023:
            continue
        train = base[(base.season >= 2022) & (base.season < season)]
        test_idx = base.index[base.season == season]
        if not feats or train.empty:
            continue
        Xs, ys = [], []
        for _, X, y in side_rows(train, feats):
            Xs.append(X)
            ys.append(y)
        X = pd.concat(Xs).astype(float)
        y = pd.concat(ys).astype(float)
        X1 = np.column_stack([np.ones(len(X)), X.values])
        lam = 50.0 * np.eye(X1.shape[1])
        lam[0, 0] = 0
        beta = np.linalg.solve(X1.T @ X1 + lam, X1.T @ y.values)
        coefs[season] = dict(zip(["const"] + list(X.columns), np.round(beta, 3)))
        T = base.loc[test_idx]
        for s, Xt, _ in side_rows(T, feats):
            adj = np.column_stack([np.zeros(len(Xt)), Xt.values.astype(float)]) @ beta  # intercept left out
            Q.loc[test_idx, f"lam_{s}"] = T[f"lam_{s}"].values + adj
    Q.to_csv(OUT / f"preds_v2_{name}.csv.gz", index=False)
    ok = Q.lam_h.notna() & (Q.season >= 2024)
    mae = np.mean(np.abs(Q.loc[ok, "lam_h"] + Q.loc[ok, "lam_a"] - Q.loc[ok, "hr"] - Q.loc[ok, "ar"]))
    mm = np.mean(np.abs(Q.loc[ok, "lam_h"] - Q.loc[ok, "lam_a"] - Q.loc[ok, "hr"] + Q.loc[ok, "ar"]))
    print(f"\n{name}: 2024-26 total MAE {mae:.3f} margin MAE {mm:.3f}")
    for s, c in coefs.items():
        print(f"   fit for {s}: {c}")
