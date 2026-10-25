#!/usr/bin/env python3
"""
GamblingCFB angle lab: tests candidate college betting angles the same way the four ★ rules
were found: look for it on the earlier seasons, then check it ONCE on later seasons it never saw,
at the consensus closing line, FBS vs FBS regular season, flat 1 unit at -110.

Run it on your own computer (it needs internet):

    export CFBD_API_KEY=...        # free key from collegefootballdata.com
    python3 cfb_angle_lab.py                       # 2013-2025, found 2013-2018, confirm 2019-2025
    python3 cfb_angle_lab.py --start 2013 --found-end 2018 --end 2025

It writes cfb_angle_findings.md and cfb_angle_findings.json next to the script and caches every
download in ./cfb_lab_cache/ so a second run is fast. Python 3.9+, standard library only.

    python3 cfb_angle_lab.py --selftest            # checks the logic on made-up data (no internet)

Data sources: CollegeFootballData.com (games, closing lines, venues, rankings, coaches) and
Open-Meteo's free archive (wind at kickoff). CFBD lines start in 2013, so this run can't reach
back to 2009 the way the original history did.

IMPORTANT: this tests many angles, so a couple will look good by luck. An angle is only a
CANDIDATE when it clears the bar on the found seasons AND is still profitable on the confirm
seasons. Even then it needs a reason it should work. The control rows reproduce the four rules
already on the site, so check those against the site's numbers first; if they are far off, the
data (not the angles) is the problem.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cfb_lab_cache")
WIN = 100 / 110
BREAKEVEN = 110 / 210  # 52.38%

# ----------------------------------------------------------------------------- fetching


def _cached_json(name: str, url: str, headers: dict | None = None, retries: int = 3):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.load(res)
            with open(path, "w") as f:
                json.dump(data, f)
            return data
        except Exception as e:  # network hiccup, rate limit
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"download failed: {url} ({last})")


def cfbd(path: str, **params):
    key = os.environ.get("CFBD_API_KEY")
    if not key:
        sys.exit("Set CFBD_API_KEY (free at collegefootballdata.com).")
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    name = "cfbd_" + path.strip("/").replace("/", "_") + "_" + q.replace("&", "_").replace("=", "-")
    return _cached_json(
        name,
        f"https://api.collegefootballdata.com/{path.strip('/')}?{q}",
        {"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )


def pick(d: dict, *names, default=None):
    """CFBD returns camelCase on v2 and snake_case on older routes: take whichever is there."""
    for n in names:
        if n in d and d[n] is not None:
            return d[n]
    return default


# ----------------------------------------------------------------------------- helpers


def haversine_miles(a, b):
    if not a or not b:
        return None
    rad = math.pi / 180
    h = math.sin((b[0] - a[0]) * rad / 2) ** 2 + math.cos(a[0] * rad) * math.cos(b[0] * rad) * math.sin(
        (b[1] - a[1]) * rad / 2
    ) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def parse_dt(s: str | None):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def binom_p_ge(w: int, n: int, p0: float = 0.5) -> float:
    """One-sided exact p-value: chance of w or more wins in n at win rate p0."""
    if n == 0:
        return 1.0
    total = 0.0
    lp, lq = math.log(p0), math.log(1 - p0)
    for k in range(w, n + 1):
        lc = math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)
        total += math.exp(lc + k * lp + (n - k) * lq)
    return min(1.0, total)


# ----------------------------------------------------------------------------- build games


def load_games(start: int, end: int):
    """Every regular-season game (FBS and FCS opponents) with its consensus closing line."""
    teams = cfbd("teams")
    team_loc, team_class, team_tz = {}, {}, {}
    for t in teams:
        loc = t.get("location") or {}
        team_tz[pick(t, "school")] = loc.get("timezone")
        lat, lon = loc.get("latitude"), loc.get("longitude")
        name = pick(t, "school")
        team_loc[name] = (lat, lon) if lat is not None and lon is not None else None
        team_class[name] = (pick(t, "classification") or "").lower()
    venues = {v["id"]: v for v in cfbd("venues")}

    games = []
    for year in range(start, end + 1):
        raw = cfbd("games", year=year, seasonType="regular")
        raw_lines = cfbd("lines", year=year, seasonType="regular")
        line_by_id = {}
        for row in raw_lines:
            spreads, totals = [], []
            for ln in row.get("lines", []):
                if ln.get("spread") is not None:
                    spreads.append(float(ln["spread"]))
                ou = pick(ln, "overUnder", "over_under")
                if ou is not None:
                    totals.append(float(ou))
            if spreads and totals:
                spreads.sort()
                totals.sort()
                line_by_id[row["id"]] = (spreads[len(spreads) // 2], totals[len(totals) // 2])
        for g in raw:
            hp, ap = pick(g, "homePoints", "home_points"), pick(g, "awayPoints", "away_points")
            home, away = pick(g, "homeTeam", "home_team"), pick(g, "awayTeam", "away_team")
            if hp is None or ap is None or not home or not away:
                continue
            hc = (pick(g, "homeClassification", "home_division") or team_class.get(home, "")).lower()
            ac = (pick(g, "awayClassification", "away_division") or team_class.get(away, "")).lower()
            line = line_by_id.get(g["id"])
            vid = pick(g, "venueId", "venue_id")
            venue = venues.get(vid) or {}
            neutral = bool(pick(g, "neutralSite", "neutral_site", default=False))
            kick = parse_dt(pick(g, "startDate", "start_date"))
            if kick is None:
                continue
            vloc = None
            if venue.get("latitude") is not None and venue.get("longitude") is not None:
                vloc = (venue["latitude"], venue["longitude"])
            site = vloc or team_loc.get(home)
            miles = None if neutral else haversine_miles(team_loc.get(away), site)
            games.append(
                {
                    "id": g["id"],
                    "season": year,
                    "week": max(1, int(g["week"])),  # week 0 counts as week 1, like ESPN
                    "home": home,
                    "away": away,
                    "hp": int(hp),
                    "ap": int(ap),
                    "fbs": hc == "fbs" and ac == "fbs",
                    "neutral": neutral,
                    "conf": bool(pick(g, "conferenceGame", "conference_game", default=False)),
                    "kick": kick.isoformat(),
                    "spread": line[0] if line else None,  # home perspective, negative = home favored
                    "total": line[1] if line else None,
                    "miles": miles,
                    "dome": bool(venue.get("dome")) if venue else None,
                    "site": site,
                    "tz_home": venue.get("timezone"),
                    "tz_away": team_tz.get(away),
                }
            )
    return games


def add_wind(games):
    """Average 10 m wind (mph) over the first three hours of each outdoor game, from Open-Meteo."""
    by_site = defaultdict(list)
    for g in games:
        if g["fbs"] and g["site"] and g["dome"] is not True:
            by_site[(round(g["site"][0], 3), round(g["site"][1], 3), g["season"])].append(g)
    done = 0
    for (lat, lon, year), lst in by_site.items():
        url = (
            "https://archive-api.open-meteo.com/v1/archive?"
            + urllib.parse.urlencode(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "start_date": f"{year}-08-20",
                    "end_date": f"{year}-12-31",
                    "hourly": "wind_speed_10m",
                    "wind_speed_unit": "mph",
                    "timezone": "UTC",
                }
            )
        )
        try:
            data = _cached_json(f"wind_{lat}_{lon}_{year}", url)
        except RuntimeError:
            continue
        times = data.get("hourly", {}).get("time", [])
        winds = data.get("hourly", {}).get("wind_speed_10m", [])
        index = {t: i for i, t in enumerate(times)}
        for g in lst:
            k = parse_dt(g["kick"])
            vals = []
            for h in range(3):
                stamp = (k + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00")
                i = index.get(stamp)
                if i is not None and winds[i] is not None:
                    vals.append(winds[i])
            if vals:
                g["wind"] = sum(vals) / len(vals)
        done += 1
        if done % 100 == 0:
            print(f"  wind: {done}/{len(by_site)} stadium-seasons", file=sys.stderr)
        time.sleep(0.15)  # be polite to the free API


def add_context(games, start: int, end: int):
    """Previous game, polls, first-year coaches."""
    # previous game / last results (all games incl. FCS opponents), per team and season
    per_team = defaultdict(list)
    for g in games:
        per_team[(g["season"], g["home"])].append(g)
        per_team[(g["season"], g["away"])].append(g)
    for lst in per_team.values():
        lst.sort(key=lambda x: x["kick"])
    for (season, team), lst in per_team.items():
        for i, g in enumerate(lst):
            side = "home" if g["home"] == team else "away"
            g[f"prev_{side}"] = None
            g[f"next_{side}"] = None
            if i > 0:
                p = lst[i - 1]
                m = p["hp"] - p["ap"] if p["home"] == team else p["ap"] - p["hp"]
                opp = p["away"] if p["home"] == team else p["home"]
                g[f"prev_{side}"] = {"margin": m, "opp": opp, "week": p["week"]}
            if i + 1 < len(lst):
                n = lst[i + 1]
                g[f"next_{side}"] = {"opp": n["away"] if n["home"] == team else n["home"], "week": n["week"]}

    # AP poll ranks
    ranks = {}  # (season, week) -> {school: rank}
    for year in range(start, end + 1):
        try:
            data = cfbd("rankings", year=year, seasonType="regular")
        except RuntimeError:
            continue
        for wk in data:
            for poll in wk.get("polls", []):
                if "AP" in poll.get("poll", ""):
                    ranks[(year, int(wk["week"]))] = {r["school"]: int(r["rank"]) for r in poll.get("ranks", [])}

    def rank_of(team, season, week):
        for w in range(week, 0, -1):
            m = ranks.get((season, w))
            if m is not None:
                return m.get(team)
        return None

    for g in games:
        g["rank_home"] = rank_of(g["home"], g["season"], g["week"])
        g["rank_away"] = rank_of(g["away"], g["season"], g["week"])
        for side in ("home", "away"):
            nxt = g.get(f"next_{side}")
            g[f"nextrank_{side}"] = rank_of(nxt["opp"], g["season"], nxt["week"]) if nxt else None
            prv = g.get(f"prev_{side}")
            g[f"prevrank_{side}"] = rank_of(prv["opp"], g["season"], prv["week"]) if prv else None

    # first-year head coaches
    try:
        coaches = cfbd("coaches", minYear=start - 1, maxYear=end)
    except RuntimeError:
        coaches = []
    games_by_school_year = {}
    first_year_of = {}  # (coach, school) -> earliest year
    for c in coaches:
        name = f"{pick(c, 'firstName', 'first_name', default='')} {pick(c, 'lastName', 'last_name', default='')}"
        for s in c.get("seasons", []):
            first_year_of[(name, s["school"])] = min(first_year_of.get((name, s["school"]), 9999), s["year"])
            key = (s["school"], s["year"])
            if key not in games_by_school_year or s.get("games", 0) > games_by_school_year[key][1]:
                games_by_school_year[key] = (name, s.get("games", 0))
    for g in games:
        for side in ("home", "away"):
            team = g[side]
            held = games_by_school_year.get((team, g["season"]))
            g[f"newcoach_{side}"] = (first_year_of.get((held[0], team)) == g["season"]) if held else None


# ----------------------------------------------------------------------------- angles


def grade(diff):
    if diff is None:
        return None
    return "W" if diff > 0 else "L" if diff < 0 else "P"


def ats_home(g):
    return g["hp"] - g["ap"] + g["spread"]


def tot_over(g):
    return g["hp"] + g["ap"] - g["total"]


def _bet(g, market, side):
    if market == "ats":
        d = ats_home(g)
        return grade(d if side == "home" else -d)
    d = tot_over(g)
    return grade(d if side == "over" else -d)


ACADEMIES = {"Army", "Navy", "Air Force"}


def angle_list():
    """(id, title, market, selector(g) -> 'home'/'away'/'over'/'under'/None, hypothesis)."""
    A = []

    def add(id, title, market, fn, why):
        A.append((id, title, market, fn, why))

    # ---- controls: the four rules already on the site
    add("c_bounce21", "CONTROL road bounce-back (lost by 21+)", "ats",
        lambda g: "away" if g.get("prev_away") and g["prev_away"]["margin"] <= -21 else None,
        "Lines overreact to a blowout loss.")
    add("c_travel2000", "CONTROL home vs visitor who traveled 2,000+ mi", "ats",
        lambda g: "home" if (g["miles"] or 0) >= 2000 else None, "Cross-country trips under-priced.")
    add("c_early", "CONTROL under in weeks 1-2", "ou",
        lambda g: "under" if g["week"] <= 2 else None, "Opening totals lean on last year's offenses.")
    add("c_academy", "CONTROL under, academy vs academy", "ou",
        lambda g: "under" if g["home"] in ACADEMIES and g["away"] in ACADEMIES else None, "Option offenses, few possessions.")

    # ---- 1. wind unders
    for thr in (8, 10, 12, 15):
        add(f"wind{thr}", f"Under, outdoor, wind {thr}+ mph", "ou",
            (lambda t: lambda g: "under" if g.get("wind") is not None and g["wind"] >= t and g["dome"] is not True else None)(thr),
            "Totals under-adjust for wind (the NFL's best rule).")

    # ---- 2. sharpen the existing rules
    for m in (14, 28):
        add(f"bounce{m}", f"Road bounce-back (lost by {m}+)", "ats",
            (lambda m: lambda g: "away" if g.get("prev_away") and g["prev_away"]["margin"] <= -m else None)(m),
            "Same idea, different loss size.")
    add("bounce_dog", "Road bounce-back, as an underdog", "ats",
        lambda g: "away" if g.get("prev_away") and g["prev_away"]["margin"] <= -21 and g["spread"] < 0 else None,
        "Road dogs after a blowout loss.")
    for mi in (1500, 2500):
        add(f"travel{mi}", f"Home vs visitor who traveled {mi}+ mi", "ats",
            (lambda mi: lambda g: "home" if (g["miles"] or 0) >= mi else None)(mi), "Distance sensitivity.")
    add("travel_tz3", "Home vs visitor 3+ time zones from home", "ats",
        lambda g: "home" if tz_shift(g) is not None and abs(tz_shift(g)) >= 3 and not g["neutral"] else None,
        "Body clock, not just miles.")
    add("early_w3", "Under in week 3", "ou", lambda g: "under" if g["week"] == 3 else None, "Does the early-season edge persist?")
    add("early_w4", "Under in week 4", "ou", lambda g: "under" if g["week"] == 4 else None, "Does the early-season edge persist?")
    add("early_nonconf", "Under in weeks 1-2, non-conference", "ou",
        lambda g: "under" if g["week"] <= 2 and not g["conf"] else None, "Non-conference is where totals lean on last year.")
    add("early_w1", "Under in week 1 only", "ou", lambda g: "under" if g["week"] == 1 else None, "Is it all week 1?")

    # ---- 3. total extremes
    for t in (60, 65):
        add(f"high{t}", f"Under, total {t}+", "ou",
            (lambda t: lambda g: "under" if g["total"] >= t else None)(t), "Public loves overs in shootouts.")
    for t in (40, 45):
        add(f"low{t}", f"Over, total {t} or lower", "ou",
            (lambda t: lambda g: "over" if g["total"] <= t else None)(t), "Low totals under-price scoring.")

    # ---- 4. look-ahead / letdown (fade the favorite)
    for fav in (10, 14, 21):
        add(f"lookahead{fav}", f"Fade a {fav}+ pt favorite before a top-10 opponent", "ats",
            (lambda fav: lambda g: fade_lookahead(g, fav))(fav), "Starters rest, minds elsewhere.")
    add("letdown7", "Fade a 7+ pt favorite coming off a win over a top-10 team", "ats",
        lambda g: fade_letdown(g, 7), "Emotional letdown after a big win.")

    # ---- 5. first-year coaches (fade, weeks 1-4)
    add("newcoach_fade", "Fade a first-year head coach, weeks 1-4", "ats",
        lambda g: ("away" if g.get("newcoach_home") and not g.get("newcoach_away") else
                   "home" if g.get("newcoach_away") and not g.get("newcoach_home") else None) if g["week"] <= 4 else None,
        "Market pays for hype.")
    add("newcoach_under", "Under with a first-year coach, weeks 1-4", "ou",
        lambda g: "under" if g["week"] <= 4 and (g.get("newcoach_home") or g.get("newcoach_away")) else None,
        "New staffs and schemes start slow.")
    return A


def tz_shift(g):
    try:
        from zoneinfo import ZoneInfo

        d = parse_dt(g["kick"])
        if not g.get("tz_home") or not g.get("tz_away"):
            return None
        a = d.astimezone(ZoneInfo(g["tz_home"])).utcoffset().total_seconds() / 3600
        b = d.astimezone(ZoneInfo(g["tz_away"])).utcoffset().total_seconds() / 3600
        return a - b
    except Exception:
        return None


def fade_lookahead(g, fav):
    # favorite = team laid fav+ points; fade it (bet the other side)
    if g["spread"] <= -fav and (g.get("nextrank_home") or 99) <= 10:
        return "away"
    if g["spread"] >= fav and (g.get("nextrank_away") or 99) <= 10:
        return "home"
    return None


def fade_letdown(g, fav):
    if g["spread"] <= -fav and (g.get("prevrank_home") or 99) <= 10 and (g.get("prev_home") or {}).get("margin", -1) > 0:
        return "away"
    if g["spread"] >= fav and (g.get("prevrank_away") or 99) <= 10 and (g.get("prev_away") or {}).get("margin", -1) > 0:
        return "home"
    return None


# ----------------------------------------------------------------------------- analysis


def tally(results):
    w = sum(1 for r in results if r == "W")
    l = sum(1 for r in results if r == "L")
    p = sum(1 for r in results if r == "P")
    n = w + l
    return {
        "w": w, "l": l, "p": p,
        "pct": (w / n * 100) if n else None,
        "units": round(w * WIN - l, 2),
        "p_vs_even": binom_p_ge(w, n, 0.5),
        "p_vs_breakeven": binom_p_ge(w, n, BREAKEVEN),
    }


def analyze(games, found_end: int, min_n: int = 60):
    out = []
    usable = [g for g in games if g["fbs"] and g["spread"] is not None and g["total"] is not None]
    for id, title, market, fn, why in angle_list():
        per_season = defaultdict(list)
        for g in usable:
            side = None
            try:
                side = fn(g)
            except (KeyError, TypeError):
                side = None
            if not side:
                continue
            res = _bet(g, "ats" if market == "ats" else "ou", side)
            if res:
                per_season[g["season"]].append(res)
        found = tally([r for y, rs in per_season.items() if y <= found_end for r in rs])
        confirm = tally([r for y, rs in per_season.items() if y > found_end for r in rs])
        seasons = {y: [rs.count("W"), rs.count("L"), rs.count("P")] for y, rs in sorted(per_season.items())}
        fn_ = found["w"] + found["l"]
        cn_ = confirm["w"] + confirm["l"]
        is_control = id.startswith("c_")
        # the bar: found well (p < .10 against a coin flip, 53%+), then still profitable on new seasons
        found_ok = fn_ >= min_n and found["pct"] is not None and found["pct"] >= 53.0 and found["p_vs_even"] < 0.10
        confirm_ok = cn_ >= min_n and confirm["pct"] is not None and confirm["pct"] > BREAKEVEN * 100 and confirm["p_vs_even"] < 0.10
        status = "control" if is_control else ("CANDIDATE" if found_ok and confirm_ok else "found only" if found_ok else "no")
        winning = sum(1 for rs in seasons.values() if rs[0] > rs[1])
        out.append({"id": id, "title": title, "market": market, "why": why, "found": found, "confirm": confirm,
                    "seasons": seasons, "winning_seasons": winning, "n_seasons": len(seasons), "status": status})
    return out


def report(results, args, n_games):
    lines = [
        "# GamblingCFB angle lab",
        "",
        f"{n_games} FBS vs FBS games with closing lines, {args.start}-{args.end}. Found on {args.start}-{args.found_end}, "
        f"confirmed on {args.found_end + 1}-{args.end}. Flat 1 unit at -110 (break-even 52.4%).",
        f"{sum(1 for r in results if not r['id'].startswith('c_'))} angles tested: expect one or two to look good by luck alone.",
        "",
        "| Angle | Found | Confirmed | Winning seasons | Status |",
        "|---|---|---|---|---|",
    ]

    def cell(t):
        if t["pct"] is None:
            return "no games"
        return f"{t['w']}-{t['l']}-{t['p']} · {t['pct']:.1f}% · {t['units']:+.1f}u (p={t['p_vs_even']:.2f})"

    order = {"CANDIDATE": 0, "found only": 1, "control": 2, "no": 3}
    for r in sorted(results, key=lambda r: (order[r["status"]], r["title"])):
        lines.append(f"| {r['title']} | {cell(r['found'])} | {cell(r['confirm'])} | {r['winning_seasons']}/{r['n_seasons']} | {r['status']} |")
    lines += [
        "",
        "Compare the CONTROL rows with the site's published records (2018-25: bounce 395-337, travel 70-45, early unders 374-295, "
        "academy 17-6). Large gaps mean a data or definition problem, not an angle problem.",
        "",
        "A CANDIDATE still needs a reason it should work before it goes on the site.",
    ]
    return "\n".join(lines)


# ----------------------------------------------------------------------------- self-test


def _synthetic(seed=3):
    rnd = random.Random(seed)
    teams = [f"T{i}" for i in range(60)]
    games = []
    gid = 0
    for season in range(2013, 2026):
        for week in range(1, 14):
            order = teams[:]
            rnd.shuffle(order)
            for k in range(0, len(order), 2):
                home, away = order[k], order[k + 1]
                spread = round(rnd.gauss(0, 9) * 2) / 2
                total = round(rnd.gauss(56, 6) * 2) / 2
                wind = max(0.0, rnd.gauss(7, 5))
                # planted truth: windy games score 5 fewer points than the market expects from week 1 on
                margin = -spread + rnd.gauss(0, 13)
                tot = total + rnd.gauss(0, 13) - (5 if wind >= 10 else 0)
                hp = max(0, round((tot + margin) / 2))
                ap = max(0, round((tot - margin) / 2))
                games.append({
                    "id": gid, "season": season, "week": week, "home": home, "away": away, "hp": hp, "ap": ap,
                    "fbs": True, "neutral": False, "conf": week > 3, "kick": f"{season}-09-{(week % 28) + 1:02d}T18:00:00+00:00",
                    "spread": spread, "total": total, "miles": rnd.choice([100, 500, 2200]), "dome": False,
                    "site": (40, -90), "wind": wind, "tz_home": None, "tz_away": None,
                })
                gid += 1
    return games


def selftest():
    games = _synthetic()
    res = {r["id"]: r for r in analyze(games, 2018)}
    wind10 = res["wind10"]
    assert wind10["status"] == "CANDIDATE", wind10
    # a null angle (nothing planted) must not be flagged
    assert res["early_w3"]["status"] in ("no", "found only"), res["early_w3"]
    assert res["high65"]["status"] != "CANDIDATE", res["high65"]
    print("self-test passed: the planted wind effect was found, null angles were not flagged.")
    for id in ("wind10", "early_w3", "high65"):
        r = res[id]
        print(f"  {id:10s} found {r['found']['w']}-{r['found']['l']} confirm {r['confirm']['w']}-{r['confirm']['l']} -> {r['status']}")


# ----------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=2013)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--found-end", type=int, default=2018)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        return selftest()

    print("downloading games and lines...", file=sys.stderr)
    games = load_games(args.start, args.end)
    print(f"{len(games)} games; adding context...", file=sys.stderr)
    add_context(games, args.start, args.end)
    print("adding wind (Open-Meteo)...", file=sys.stderr)
    add_wind(games)

    # sanity: the spread sign. Home margin + spread should average about 0 if the sign is right.
    sample = [g for g in games if g["fbs"] and g["spread"] is not None]
    mean_cover = sum(ats_home(g) for g in sample) / len(sample)
    if abs(mean_cover) > 1.5:
        sys.exit(f"Spread sign looks wrong (home covers by {mean_cover:+.1f} on average). Flip the sign in load_games().")

    results = analyze(games, args.found_end)
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "cfb_angle_findings.json"), "w") as f:
        json.dump(results, f, indent=1)
    md = report(results, args, len(sample))
    with open(os.path.join(here, "cfb_angle_findings.md"), "w") as f:
        f.write(md)
    print(md)


if __name__ == "__main__":
    main()
