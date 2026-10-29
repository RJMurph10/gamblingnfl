"""One football table for the NFL (nflverse, 1999-2025) and college (cfbfastR/CFBD, 2013-2025).

Same columns for both leagues so every rule can run on either:
  league, season, week, kickoff (UTC), home, away, home_pts, away_pts, neutral,
  spread_close / spread_open (HOME line, negative = home favored), total_close / total_open,
  ml_home, ml_away, wind, temp (NFL only), home_tz / away_tz (UTC offset at kickoff),
  travel_miles (visitor's home to the game), and from each team's previous game:
  last_margin, rest days, last_was_home.

College: FBS vs FBS, regular season (as the site's college rules). NFL: regular season.
"""
import math
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from pathlib import Path

FB = Path(__file__).resolve().parents[1]  # research/football
REPO = FB.parents[1]
ROOT = FB  # sources/ and data/ live here


# ---------------- home locations ----------------
def nfl_stadiums():
    text = open(f"{REPO}/src/lib/nfl/stadiums.ts").read()
    out = {}
    for m in re.finditer(r"\b([A-Z]{2,3}):\s*\{[^}]*?lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+),\s*timezone:\s*\"([^\"]+)\"", text):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)), m.group(4))
    # retired homes in nflverse's history
    out.update({
        "STL": (38.6328, -90.1885, "America/Chicago"), "SD": (32.7831, -117.1196, "America/Los_Angeles"),
        "OAK": (37.7516, -122.2005, "America/Los_Angeles"),
    })
    out.setdefault("LA", out.get("LAR"))
    return out


def cfb_stadiums():
    text = open(f"{REPO}/src/data/cfb/cfb-stadiums.ts").read()
    out = {}
    for m in re.finditer(r"^\s*(\d+):\s*\[(-?[\d.]+),\s*(-?[\d.]+),\s*\"([^\"]+)\"", text, re.M):
        out[int(m.group(1))] = (float(m.group(2)), float(m.group(3)), m.group(4))
    return out


def miles(a, b):
    if a is None or b is None:
        return np.nan
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def utc_offset(tzname, when):
    if tzname is None or pd.isna(when):
        return np.nan
    return ZoneInfo(tzname).utcoffset(when.to_pydatetime().replace(tzinfo=None)).total_seconds() / 3600


# ---------------- NFL ----------------
def nfl():
    g = pd.read_csv(f"{ROOT}/sources/nfl_games.csv")
    g = g[(g.game_type == "REG") & g.home_score.notna() & g.spread_line.notna()].copy()
    st = nfl_stadiums()
    # kickoff in UTC from Eastern date + time
    et = ZoneInfo("America/New_York")
    def ko(r):
        t = r.gametime if isinstance(r.gametime, str) else "13:00"
        return pd.Timestamp(datetime.strptime(f"{r.gameday} {t}", "%Y-%m-%d %H:%M").replace(tzinfo=et)).tz_convert("UTC")
    g["kickoff"] = g.apply(ko, axis=1)
    out = pd.DataFrame({
        "league": "nfl", "season": g.season, "week": g.week, "kickoff": g.kickoff,
        "home": g.home_team, "away": g.away_team, "home_pts": g.home_score, "away_pts": g.away_score,
        "neutral": g.location.eq("Neutral"),
        # nflverse spread_line = points the home team is favored by → home line is its negative
        "spread_close": -g.spread_line, "spread_open": np.nan, "total_close": g.total_line, "total_open": np.nan,
        "ml_home": g.home_moneyline, "ml_away": g.away_moneyline,
        "wind": g.wind, "temp": g.temp, "roof": g.roof, "div_game": g.div_game,
        "home_qb": g.home_qb_name, "away_qb": g.away_qb_name, "game_id": g.game_id,
    })
    loc = lambda t: st.get(t)
    out["home_tz"] = [utc_offset(loc(h)[2] if loc(h) else None, k) for h, k in zip(out.home, out.kickoff)]
    out["away_tz"] = [utc_offset(loc(a)[2] if loc(a) else None, k) for a, k in zip(out.away, out.kickoff)]
    out["travel_miles"] = [miles(loc(a), loc(h)) for a, h in zip(out.away, out.home)]
    out["home_loc_tz"] = [loc(h)[2] if loc(h) else None for h in out.home]
    return out


# ---------------- college ----------------
def _name_score(code, name):
    """How well a sportsbook's team code fits a team name: exact 4, letters in order from the first 2-3, else 0."""
    code = str(code).lower().replace(" ", "").replace(".", "").replace("&", "")
    full = str(name).lower().replace("é", "e")
    flat = re.sub(r"[^a-z]", "", full)
    if code == flat or str(code) == str(name).lower():
        return 4
    i = 0
    for ch in flat:
        if i < len(code) and ch == code[i]:
            i += 1
    if i < len(code):
        return 0
    initials = "".join(w[0] for w in re.findall(r"[a-z]+", full))
    if code == initials:
        return 3
    return 2 if flat[0] == code[0] else 1


def home_side(b):
    """1 = this spread/moneyline row is the home team's, 0 = the away team's, NaN = can't tell (skipped)."""
    out = pd.Series(np.nan, index=b.index)
    rows = b[b.market_type.isin(["spread", "money_line"])]
    for (gid, book, mt), grp in rows.groupby(["game_id", "book", "market_type"]):
        codes = grp.abbr.unique()
        if len(codes) != 2:
            continue
        h, a = grp.home_team.iloc[0], grp.away_team.iloc[0]
        d = [_name_score(c, h) - _name_score(c, a) for c in codes]
        if d[0] == d[1]:
            continue
        home_code = codes[0] if d[0] > d[1] else codes[1]
        out[grp.index] = (grp.abbr == home_code).astype(float).values
    return out


def cfb():
    sched = pd.concat([pd.read_csv(f"{ROOT}/sources/cfbfastR-data/schedules/csv/cfb_schedules_{y}.csv") for y in range(2013, 2026)], ignore_index=True)
    sched = sched[(sched.season_type == "regular") & (sched.home_division == "fbs") & (sched.away_division == "fbs")]
    sched = sched[sched.home_points.notna() & sched.away_points.notna()].copy()
    b = pd.read_csv(f"{ROOT}/sources/cfbfastR-data/betting/csv/cfb_line_odds.csv.gz")
    b = b[b.game_id.isin(sched.game_id)]
    names = sched.set_index("game_id")[["home_team", "away_team"]]
    b = b.join(names, on="game_id")
    b["is_home"] = home_side(b)
    sp = b[(b.market_type == "spread") & (b.is_home == 1)]
    to = b[(b.market_type == "total") & (b.abbr == "over")]
    mlh = b[(b.market_type == "money_line") & (b.is_home == 1)]
    mla = b[(b.market_type == "money_line") & (b.is_home == 0)]
    cons = pd.DataFrame({
        "spread_close": sp.groupby("game_id").lines.median(),
        "spread_open": sp.groupby("game_id").opening_lines.median(),
        "total_close": to.groupby("game_id").lines.median(),
        "total_open": to.groupby("game_id").opening_lines.median(),
        "ml_home": mlh.groupby("game_id").odds.median(),
        "ml_away": mla.groupby("game_id").odds.median(),
        "books": sp.groupby("game_id").book.nunique(),
    })
    s = sched.join(cons, on="game_id")
    s = s[s.spread_close.notna()].copy()
    st = cfb_stadiums()
    s["kickoff"] = pd.to_datetime(s.start_date, utc=True)
    loc = lambda tid: st.get(int(tid))
    out = pd.DataFrame({
        "league": "cfb", "season": s.season, "week": s.week, "kickoff": s.kickoff,
        "home": s.home_team, "away": s.away_team, "home_pts": s.home_points, "away_pts": s.away_points,
        "neutral": s.neutral_site.astype(bool),
        "spread_close": s.spread_close, "spread_open": s.spread_open, "total_close": s.total_close, "total_open": s.total_open,
        "ml_home": s.ml_home, "ml_away": s.ml_away, "wind": np.nan, "temp": np.nan, "roof": None, "div_game": s.conference_game.astype(float),
        "home_qb": None, "away_qb": None, "game_id": s.game_id, "books": s.books,
        "home_id": s.home_id, "away_id": s.away_id,
    })
    out["home_tz"] = [utc_offset(loc(h)[2] if loc(h) else None, k) for h, k in zip(out.home_id, out.kickoff)]
    out["away_tz"] = [utc_offset(loc(a)[2] if loc(a) else None, k) for a, k in zip(out.away_id, out.kickoff)]
    out["travel_miles"] = [miles(loc(a), loc(h)) for a, h in zip(out.away_id, out.home_id)]
    out["home_loc_tz"] = [loc(h)[2] if loc(h) else None for h in out.home_id]
    return out


def add_previous_game(df, all_games):
    """Each team's previous game in the same season (any opponent, from `all_games`)."""
    rows = []
    for _, r in all_games.iterrows():
        rows.append((r.league, r.season, r.kickoff, r.home, r.home_pts - r.away_pts, True))
        rows.append((r.league, r.season, r.kickoff, r.away, r.away_pts - r.home_pts, False))
    tg = pd.DataFrame(rows, columns=["league", "season", "kickoff", "team", "margin", "was_home"]).sort_values("kickoff")
    tg["prev_kickoff"] = tg.groupby(["league", "season", "team"]).kickoff.shift(1)
    tg["prev_margin"] = tg.groupby(["league", "season", "team"]).margin.shift(1)
    tg["prev_home"] = tg.groupby(["league", "season", "team"]).was_home.shift(1)
    key = tg.set_index(["league", "kickoff", "team"])
    for side in ("home", "away"):
        k = key.reindex(list(zip(df.league, df.kickoff, df[side])))
        df[f"{side}_last_margin"] = k.prev_margin.values
        df[f"{side}_rest"] = ((df.kickoff.values - k.prev_kickoff.values) / np.timedelta64(1, "D"))
        df[f"{side}_last_home"] = k.prev_home.values
    return df


if __name__ == "__main__":
    n = nfl()
    c = cfb()
    # previous games: NFL from all NFL games; college from all FBS games incl. ones without lines
    n = add_previous_game(n, n)
    every = pd.concat([pd.read_csv(f"{ROOT}/sources/cfbfastR-data/schedules/csv/cfb_schedules_{y}.csv") for y in range(2013, 2026)], ignore_index=True)
    every = every[every.home_points.notna() & every.away_points.notna()]
    every = pd.DataFrame({"league": "cfb", "season": every.season, "kickoff": pd.to_datetime(every.start_date, utc=True),
                          "home": every.home_team, "away": every.away_team, "home_pts": every.home_points, "away_pts": every.away_points})
    c = add_previous_game(c, every)  # last game against anyone (FCS and games without lines included)
    df = pd.concat([n, c], ignore_index=True)
    df["margin"] = df.home_pts - df.away_pts
    df["pts"] = df.home_pts + df.away_pts
    df.to_csv(f"{ROOT}/data/football.csv", index=False)
    for lg, d in df.groupby("league"):
        print(lg, len(d), "games", d.season.min(), "-", d.season.max(),
              "| open spread", int(d.spread_open.notna().sum()), "| travel known", int(d.travel_miles.notna().sum()),
              "| last margin known", int(d.away_last_margin.notna().sum()))
