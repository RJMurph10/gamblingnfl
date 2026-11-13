"""College baseball model v2: game context on top of the run ratings (research/cbase/features.py,
project doc cbase-research.md).

Each side's expected runs move by:
  the opposing starter   projected from the team's last start on the same kind of day (Fri / Sat / Sun /
                         midweek) within 10 days, since the NCAA publishes no probable starters; rated
                         from his earlier starts (this season, last season at half weight), pulled toward
                         the league rate by 15 innings, times his usual innings
  weather                temperature and wind at the home team's town over the first three hours
                         (Open-Meteo: the archive for past games, the forecast for recent and upcoming)
  altitude               the home town's elevation
  travel                 the visitors' time-zone change and distance from home

Coefficients: the research fit on 2022–25 (walk-forward), used for 2026 there. Rain is left out: its fitted
effect flipped sign from season to season.
"""

import gzip
import json
import math
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

COEF = dict(opp_sp=-0.154, opp_spd=0.101, temp=0.014, wind=0.059, elev=0.104, tz_bat=-0.132, tz_pitch=-0.099, dist_bat=0.205)
SHRINK_IP = 15.0
IP_PRIOR, IP_PRIOR_N = 4.5, 3.0


def read_box(path):
    p = Path(path)
    if not p.exists():
        return []
    with gzip.open(p, "rt") as f:
        return [json.loads(l) for l in f if l.strip()]


def ip_outs(ip):
    whole, _, frac = str(ip or "0").partition(".")
    try:
        return int(whole or 0) * 3 + int(frac or 0)
    except ValueError:
        return 0


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def starter_of(pitchers):
    """The starting pitcher: position "p" and in the starting lineup; else the one listed as a starter."""
    for p in pitchers:
        if len(p) > 12 and p[12] and str(p[11]).lower() == "p":
            return p
    for p in pitchers:
        if len(p) > 12 and p[12]:
            return p
    return None


def day_kind(date):
    """'fri' / 'sat' / 'sun' / 'mid' for a YYYY-MM-DD game day."""
    w = datetime.strptime(date, "%Y-%m-%d").weekday()
    return {4: "fri", 5: "sat", 6: "sun"}.get(w, "mid")


class Pitchers:
    """Starting pitchers' ratings, fed one game day at a time (each projection sees only earlier days)."""

    def __init__(self, last_box):
        self.num_name = {}
        self.hist = defaultdict(lambda: {"outs": 0.0, "runs": 0.0, "starts": 0.0, "souts": 0.0})
        self.lg = {"outs": 3.0, "runs": 2.1}
        self.team_starts = defaultdict(list)  # team -> [(date, kind, key, display name)]
        self._names(last_box)
        for g in sorted(last_box, key=lambda g: g["date"]):
            self._add(g)
        self.last = {k: dict(v) for k, v in self.hist.items()}
        self.hist = defaultdict(lambda: {"outs": 0.0, "runs": 0.0, "starts": 0.0, "souts": 0.0})
        self.team_starts = defaultdict(list)

    def _names(self, box):
        for g in box:
            for t in g["teams"]:
                for p in t["pitchers"]:
                    if (p[1] or "").strip() and p[2] is not None:
                        self.num_name.setdefault(
                            (g["date"][:4], t["seo"], p[2]), f"{(p[1] or '').strip().lower()}|{(p[0] or '').strip().lower()[:1]}"
                        )

    def key(self, team, p, year):
        first, last = (p[0] or "").strip().lower(), (p[1] or "").strip().lower()
        if last:
            return f"{team}|{last}|{first[:1]}"
        named = self.num_name.get((year, team, p[2]))
        return f"{team}|{named}" if named else f"{team}|#{p[2]}"

    def _add(self, g):
        for t in g["teams"]:
            sp = starter_of(t["pitchers"])
            for p in t["pitchers"]:
                k = self.key(t["seo"], p, g["date"][:4])
                outs, runs = ip_outs(p[3]), num(p[5])
                h = self.hist[k]
                h["outs"] += outs
                h["runs"] += runs
                self.lg["outs"] += outs
                self.lg["runs"] += runs
                if p is sp:
                    h["starts"] += 1
                    h["souts"] += outs
                    name = f"{(p[0] or '').strip()[:1].upper()}. {(p[1] or '').strip()}".strip(". ") or f"#{p[2]}"
                    self.team_starts[t["seo"]].append((g["date"], day_kind(g["date"]), k, name))

    def add_day(self, games):
        self._names(games)
        for g in games:
            self._add(g)

    def rating(self, k):
        h = self.hist[k]
        l = self.last.get(k, {"outs": 0, "runs": 0, "starts": 0, "souts": 0})
        inn = h["outs"] / 3 + 0.5 * l["outs"] / 3
        runs = h["runs"] + 0.5 * l["runs"]
        lr = self.lg["runs"] / max(self.lg["outs"] / 3, 1)
        rate = (runs + SHRINK_IP * lr) / (inn + SHRINK_IP)
        st = h["starts"] + 0.5 * l["starts"]
        sip = (h["souts"] / 3 + 0.5 * l["souts"] / 3 + IP_PRIOR * IP_PRIOR_N) / (st + IP_PRIOR_N)
        return rate, sip, lr

    def projected(self, team, date):
        """(runs saved vs a league-average starter, vs the team's usual starter, name) for the team's
        projected starter on this date, or None."""
        prev = self.team_starts.get(team, [])
        kd = day_kind(date)
        d = datetime.strptime(date, "%Y-%m-%d")
        cand = next(
            (x for x in reversed(prev) if x[1] == kd and 0 < (d - datetime.strptime(x[0], "%Y-%m-%d")).days <= 10), None
        )
        if not cand:
            return None
        rate, sip, lr = self.rating(cand[2])
        team_avg = None
        if prev:
            team_avg = float(np.mean([self.rating(k)[0] * self.rating(k)[1] for _, _, k, _ in prev[-15:]]))
        return ((lr - rate) * sip, (team_avg - rate * sip) if team_avg is not None else 0.0, cand[3])


class Weather:
    """Temperature and wind at a home town around first pitch: the season archive, else the forecast."""

    def __init__(self, archive, venues):
        self.archive = archive or {}
        self.venues = venues
        self.forecast = {}

    def _fetch(self, espn_id):
        if espn_id in self.forecast:
            return self.forecast[espn_id]
        v = self.venues.get(espn_id)
        out = None
        if v and v.get("lat") is not None and v.get("tz"):
            url = (
                f"https://api.open-meteo.com/v1/forecast?latitude={v['lat']}&longitude={v['lon']}"
                "&hourly=temperature_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph"
                f"&past_days=14&forecast_days=14&timezone={v['tz']}"
            )
            try:
                with urllib.request.urlopen(url, timeout=20) as r:
                    h = json.load(r).get("hourly") or {}
                out = {t: (h["temperature_2m"][i], h["wind_speed_10m"][i]) for i, t in enumerate(h.get("time", []))}
            except Exception:
                out = None
        self.forecast[espn_id] = out
        return out

    def at(self, espn_id, date, hour):
        hours = [h for h in range(hour, hour + 3) if 10 <= h <= 22]
        w = self.archive.get(espn_id)
        temps, winds = [], []
        if w:
            day_i = (datetime.strptime(date, "%Y-%m-%d") - datetime.strptime(w["start"], "%Y-%m-%d")).days
            for h in hours:
                j = day_i * 13 + (h - 10)
                if 0 <= j < len(w["t"]) and w["t"][j] is not None:
                    temps.append(w["t"][j])
                    if w["w"][j] is not None:
                        winds.append(w["w"][j])
        if not temps:
            f = self._fetch(espn_id)
            for h in hours:
                x = (f or {}).get(f"{date}T{h:02d}:00")
                if x and x[0] is not None:
                    temps.append(x[0])
                    if x[1] is not None:
                        winds.append(x[1])
        if not temps:
            return None
        return float(np.mean(temps)), (float(np.mean(winds)) if winds else None)


def _hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def _offset(tz, date):
    d = datetime.strptime(date, "%Y-%m-%d")
    return ZoneInfo(tz).utcoffset(datetime(d.year, d.month, d.day, 15)).total_seconds() / 3600


class Context:
    def __init__(self, venues, seo_to_espn, weather):
        self.venues = venues
        self.seo_to_espn = seo_to_espn
        self.weather = weather

    def venue(self, team):
        e = self.seo_to_espn.get(team)
        v = self.venues.get(e) if e else None
        return (e, v) if v and v.get("lat") is not None and v.get("tz") else (e, None)

    def adjust(self, home, away, date, start_iso, sp_home, sp_away):
        """(home runs adjustment, away runs adjustment, details) for one game. sp_*: Pitchers.projected()."""
        adj_h = adj_a = 0.0
        info = {}
        # the home side scores against the away starter, and the other way round
        if sp_away:
            adj_h += COEF["opp_sp"] * sp_away[0] + COEF["opp_spd"] * sp_away[1]
            info["spa"] = sp_away[2]
        if sp_home:
            adj_a += COEF["opp_sp"] * sp_home[0] + COEF["opp_spd"] * sp_home[1]
            info["sph"] = sp_home[2]
        eh, vh = self.venue(home)
        _, va = self.venue(away)
        if vh:
            elev = (vh.get("elev") or 0) * 3.281 / 1000
            adj_h += COEF["elev"] * elev
            adj_a += COEF["elev"] * elev
            if va:
                tzd = abs(_offset(vh["tz"], date) - _offset(va["tz"], date))
                dist = _hav(vh, va) / 1000
                adj_a += COEF["tz_bat"] * tzd + COEF["dist_bat"] * dist
                adj_h += COEF["tz_pitch"] * tzd
            hour = None
            if start_iso:
                hour = datetime.fromisoformat(start_iso.replace("Z", "+00:00")).astimezone(ZoneInfo(vh["tz"])).hour
            if hour is None:
                hour = 14 if day_kind(date) in ("sat", "sun") else 18
            w = self.weather.at(eh, date, hour)
            if w:
                temp, wind = w
                adj_h += COEF["temp"] * (temp - 65)
                adj_a += COEF["temp"] * (temp - 65)
                info["temp"] = round(temp)
                if wind is not None:
                    adj_h += COEF["wind"] * (wind - 8)
                    adj_a += COEF["wind"] * (wind - 8)
                    info["wind"] = round(wind)
        return adj_h, adj_a, info
