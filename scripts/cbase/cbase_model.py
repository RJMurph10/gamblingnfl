"""College baseball: NCAA results + ESPN lines join, and the run-ratings model (shared by build_season.py).

Model (research/cbase, project doc cbase-research.md): runs scored = mu + home + midweek / Friday / Sunday
+ home park + offense − opponent defense, weighted ridge least squares refit every game day on the
season's earlier games (weights halve every HALF_LIFE days), each team pulled toward CARRY × last
season's rating with the weight of PRIOR_GAMES games.
"""

import gzip
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from math import erf, sqrt
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import lsqr

HALF_LIFE = 120.0
CARRY = 0.7
PRIOR_GAMES = 15.0
# fit on 2019 and 2021–23, seasons without lines (research/cbase/evaluate.py, rl.py)
K = 0.349  # P(home win) = logistic(K × predicted margin)
SIGMA = 6.12  # sd of the total around the predicted total
SD_MARGIN = 5.77  # sd of the margin around the predicted margin
MIN_GP = 5  # both teams need this many earlier games for a pick
ML_EDGE = 0.08  # watch: model win chance 8+ points over the no-vig opening moneyline
RL_EDGE = 0.05  # watch: model cover chance 5+ points over the no-vig opening run line


def read_jsonl(p):
    with gzip.open(p, "rt") as f:
        return [json.loads(l) for l in f if l.strip()]


# ---------- NCAA results ----------
def load_ncaa(paths):
    rows = []
    for p in paths:
        season = int(Path(p).name.split(".")[0])
        for g in read_jsonl(p):
            h, a = g["home"], g["away"]
            rows.append(
                dict(
                    season=season,
                    date=g["date"],
                    ncaa_id=str(g["id"]),
                    home=h["seo"],
                    away=a["seo"],
                    home_name=h["short"],
                    away_name=a["short"],
                    home_conf=h.get("conf", ""),
                    away_conf=a.get("conf", ""),
                    hr=h.get("score"),
                    ar=a.get("score"),
                    final="final" in (g.get("state") or "").lower() and h.get("score") is not None and a.get("score") is not None,
                    epoch=g.get("epoch"),
                )
            )
    return rows


# ---------- names ----------
ALIASES = {
    "st": "state", "u": "", "univ": "", "university": "", "of": "", "the": "", "and": "", "college": "",
    "mt": "mount", "so": "southern", "fla": "florida", "ga": "georgia", "ala": "alabama", "miss": "mississippi",
    "ark": "arkansas", "la": "louisiana", "tenn": "tennessee", "ky": "kentucky", "okla": "oklahoma",
    "wash": "washington", "ill": "illinois", "mich": "michigan", "ind": "indiana", "cal": "california",
    "n": "north", "s": "south", "e": "east", "w": "west", "intl": "international",
}


def norm(s):
    s = (s or "").lower().replace("&", " and ").replace("'", "").replace("’", "")
    s = re.sub(r"[().,\-/]", " ", s)
    return " ".join(w for w in (ALIASES.get(w, w) for w in s.split()) if w)


def sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    return 1.0 if a == b else SequenceMatcher(None, a, b).ratio()


# ---------- ESPN lines ----------
def num(v):
    if v in (None, "", "OFF"):
        return None
    if v == "EVEN":
        return 100.0
    try:
        return float(str(v).replace("+", ""))
    except ValueError:
        return None


def block(o, which):
    h = (o.get("homeTeamOdds") or {}).get(which) or {}
    a = (o.get("awayTeamOdds") or {}).get(which) or {}
    t = o.get(which) or {}
    am = lambda x, k: num((x.get(k) or {}).get("american"))
    b = dict(mlH=am(h, "moneyLine"), mlA=am(a, "moneyLine"), rl=am(h, "pointSpread"), rlH=am(h, "spread"),
             rlA=am(a, "spread"), tot=am(t, "total"), ov=am(t, "over"), un=am(t, "under"))
    return b if any(v is not None for v in b.values()) else None


def flip_block(b):
    if not b:
        return b
    return dict(mlH=b["mlA"], mlA=b["mlH"], rl=-b["rl"] if b["rl"] is not None else None, rlH=b["rlA"],
                rlA=b["rlH"], tot=b["tot"], ov=b["ov"], un=b["un"])


BOOK_ORDER = ["100", "58", "40", "47", "45", "41", "52", "57"]  # DraftKings, ESPN BET, then older books


def espn_lines(e):
    """(book name, open block, latest block) from an ESPN record, home/away as ESPN lists them."""
    books = {b["id"]: b for b in e.get("books") or []}
    if not books:
        return None
    pid = next((k for k in BOOK_ORDER if k in books), next(iter(books)))
    o = books[pid]
    op, cu = block(o, "open"), block(o, "current")
    if not op and not cu:
        return None
    return o.get("name", pid), op, cu


def espn_label(t, espn_teams):
    x = espn_teams.get(t["id"])
    return x["location"] if x else re.sub(r"\s+\S+$", "", t.get("name", ""))


def match_espn(espn_records, ncaa, espn_teams):
    """Match finished ESPN games to NCAA games (date ±1, both runs, names). Returns
    {ncaa row index: (espn record, flipped)} and the ESPN team id → NCAA seo map it implies."""
    by_day = defaultdict(list)
    for i, g in enumerate(ncaa):
        if g["final"]:
            by_day[g["date"]].append(i)
    out, votes = {}, defaultdict(Counter)
    for e in espn_records:
        if e.get("state") == "pre" or len(e.get("teams", [])) != 2:
            continue
        th = next((t for t in e["teams"] if t["homeAway"] == "home"), None)
        ta = next((t for t in e["teams"] if t["homeAway"] == "away"), None)
        if not th or not ta or th["score"] is None or ta["score"] is None:
            continue
        d0 = datetime.fromisoformat(e["date"].replace("Z", "+00:00")) - timedelta(hours=5)
        best = None
        for dd in (0, -1, 1):
            for i in by_day.get((d0 + timedelta(days=dd)).strftime("%Y-%m-%d"), []):
                g = ncaa[i]
                for flip in (False, True):
                    gh, ga = (g["away_name"], g["home_name"]) if flip else (g["home_name"], g["away_name"])
                    rh, ra = (g["ar"], g["hr"]) if flip else (g["hr"], g["ar"])
                    if rh != th["score"] or ra != ta["score"]:
                        continue
                    s = max(min(sim(espn_label(th, espn_teams), gh), sim(espn_label(ta, espn_teams), ga)),
                            (sim(th["name"], gh) + sim(ta["name"], ga)) / 2) - 0.05 * abs(dd)
                    if best is None or s > best[0]:
                        best = (s, i, flip)
        if not best or best[0] < 0.55:
            continue
        _, i, flip = best
        if i in out:
            continue
        out[i] = (e, flip)
        g = ncaa[i]
        hs, as_ = (g["away"], g["home"]) if flip else (g["home"], g["away"])
        votes[th["id"]][hs] += 1
        votes[ta["id"]][as_] += 1
    team_map = {k: c.most_common(1)[0][0] for k, c in votes.items()}
    return out, team_map


# ---------- model ----------
def add_day_flags(df):
    dow = pd.to_datetime(df["date"]).dt.dayofweek
    df["midweek"] = (dow <= 3).astype(float)
    df["fri"] = (dow == 4).astype(float)
    df["sun"] = (dow == 6).astype(float)
    return df


def fit(hist, teams, prior, today):
    T = len(teams)
    idx = {t: i for i, t in enumerate(teams)}
    n = len(hist)
    w = 0.5 ** ((today - pd.to_datetime(hist["date"])).dt.days.values / HALF_LIFE)
    h_i = hist["home"].map(idx).values
    a_i = hist["away"].map(idx).values
    r = np.arange(2 * n)
    two = lambda x: np.concatenate([x, x])
    rows = np.concatenate([r] * 8)
    cols = np.concatenate([
        np.concatenate([h_i, a_i]), T + np.concatenate([a_i, h_i]), np.full(2 * n, 2 * T), np.full(2 * n, 2 * T + 1),
        np.full(2 * n, 2 * T + 2), np.full(2 * n, 2 * T + 3), np.full(2 * n, 2 * T + 4), two(h_i) + 2 * T + 5,
    ])
    vals = np.concatenate([
        np.ones(2 * n), -np.ones(2 * n), np.ones(2 * n), np.concatenate([np.ones(n), np.zeros(n)]),
        two(hist["midweek"].values), two(hist["fri"].values), two(hist["sun"].values), np.ones(2 * n),
    ])
    y = list(np.concatenate([hist["hr"].values, hist["ar"].values]).astype(float))
    ws = list(two(w))
    rows, cols, vals = list(rows), list(cols), list(vals)
    for t, i in idx.items():
        p = prior.get(t, (0.0, 0.0, 0.0))
        for c, v in ((i, p[0]), (T + i, p[1]), (2 * T + 5 + i, p[2])):
            rows.append(len(y)); cols.append(c); vals.append(1.0); y.append(CARRY * v); ws.append(PRIOR_GAMES)
    sw = np.sqrt(np.array(ws))
    A = coo_matrix((np.array(vals) * sw[np.array(rows)], (rows, cols)), shape=(len(y), 3 * T + 5)).tocsr()
    sol = lsqr(A, np.array(y) * sw, atol=1e-6, btol=1e-6, iter_lim=400)[0]
    return idx, sol


def expected(sol, idx, T, home, away, flags):
    """Expected runs (home, away) for a game; None if a team has never played."""
    if sol is None or home not in idx or away not in idx:
        return None
    i, j = idx[home], idx[away]
    mu, hh, mm, ff, ss = sol[2 * T : 2 * T + 5]
    base = mu + mm * flags["midweek"] + ff * flags["fri"] + ss * flags["sun"] + sol[2 * T + 5 + i]
    return base + hh + sol[i] - sol[T + j], base + sol[j] - sol[T + i]


def walk_forward(df, prior, extra=None):
    """Predict every finished game of one season from earlier games; then fit on the whole season.
    extra: upcoming games (home, away, date) to predict from everything played so far.
    Returns (preds by row index, final (idx, sol, T), end-of-season prior, games played before each game)."""
    df = add_day_flags(df.copy())
    teams = sorted(set(df["home"]) | set(df["away"]) | set((extra or {}).get("teams", [])))
    T = len(teams)
    done = df[df["final"]].copy()
    done["hr"] = done["hr"].astype(float)
    done["ar"] = done["ar"].astype(float)
    preds, gp_before = {}, {}
    played = Counter()
    idx, sol = None, None
    for day in sorted(done["date"].unique()):
        today = done[done["date"] == day]
        hist = done[done["date"] < day]
        if len(hist) >= 50:
            idx, sol = fit(hist, teams, prior, pd.Timestamp(day))
        for k, g in today.iterrows():
            gp_before[k] = (played[g["home"]], played[g["away"]])
            e = expected(sol, idx, T, g["home"], g["away"], g)
            if e:
                preds[k] = e
        for _, g in today.iterrows():
            played[g["home"]] += 1
            played[g["away"]] += 1
    if len(done) >= 50:
        idx, sol = fit(done, teams, prior, pd.Timestamp(done["date"].max()) + pd.Timedelta(days=1))
    else:
        idx = {t: i for i, t in enumerate(teams)}
        sol = None
    new_prior = {t: (sol[i], sol[T + i], sol[2 * T + 5 + i]) for t, i in idx.items()} if sol is not None else prior
    return preds, (idx, sol, T), new_prior, gp_before, played


# ---------- prices ----------
def implied(x):
    if x is None:
        return None
    return -x / (-x + 100) if x < 0 else 100 / (x + 100)


def payout(x):
    return 100 / -x if x < 0 else x / 100


def phi(z):
    return 0.5 * (1 + erf(z / sqrt(2)))


def model_numbers(h, a):
    return dict(h=round(h, 2), a=round(a, 2), p=round(1 / (1 + np.exp(-K * (h - a))), 4), t=round(h + a, 2))


def picks_for(m, line):
    """Watch picks from the model numbers and an opening line block."""
    out = []
    if not line:
        return out
    ih, ia = implied(line["mlH"]), implied(line["mlA"])
    if ih and ia:
        edge = m["p"] - ih / (ih + ia)
        if abs(edge) >= ML_EDGE:
            side = "home" if edge > 0 else "away"
            out.append(dict(k="ml", side=side, edge=round(abs(edge), 4), price=line["mlH"] if side == "home" else line["mlA"]))
    if line["rl"] in (-1.5, 1.5) and line["rlH"] is not None and line["rlA"] is not None:
        ch, ca = implied(line["rlH"]), implied(line["rlA"])
        p_cover = 1 - phi((-line["rl"] - (m["h"] - m["a"])) / SD_MARGIN)
        edge = p_cover - ch / (ch + ca)
        if abs(edge) >= RL_EDGE:
            side = "home" if edge > 0 else "away"
            out.append(dict(k="rl", side=side, edge=round(abs(edge), 4), line=line["rl"] if side == "home" else -line["rl"],
                            price=line["rlH"] if side == "home" else line["rlA"]))
    return out


def grade(p, hr, ar):
    margin = (hr - ar) if p["side"] == "home" else (ar - hr)
    if p["k"] == "ml":
        return "W" if margin > 0 else "L"
    return "W" if margin + p["line"] > 0 else "L"
