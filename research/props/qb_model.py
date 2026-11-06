"""Candidate QB prop model vs the site's current projections, on every primary QB start.

Features (all known before kickoff, walk-forward):
  form       recency-weighted per-game average this season (partial games scaled by pass share),
             pulled toward his previous seasons (career, recent seasons weighted more), then the league
  implied    team implied points from the closing spread and total (minus the league average)
  opp        opponent's QB-stat allowed per game vs league so far this season (shrunk), log scale
  weather    outdoor wind (mph above 10), dome/closed roof, home
Fitted with least squares on 1999-2012, tested on 2013-2025 (and 2022-25 separately).
"""
import math

import numpy as np
import pandas as pd

q = pd.read_csv("/root/fbdata/qb_games.csv")
q = q[q.season <= 2025].copy()
STATS = {
    "pass_yds": "passing_yards", "pass_att": "attempts", "pass_cmp": "completions",
    "pass_tds": "passing_tds", "pass_int": "passing_interceptions", "rush_yds": "rushing_yards",
}
q["pass_rush_yds"] = q.passing_yards + q.rushing_yards.fillna(0)
STATS["pass_rush_yds"] = "pass_rush_yds"
for c in ["rushing_yards", "carries", "rushing_tds", "passing_interceptions", "passing_tds"]:
    q[c] = q[c].fillna(0)
q["outdoor"] = q.roof.isin(["outdoors", "open"])
q["wind_x"] = np.where(q.outdoor & q.wind.notna(), np.clip(q.wind.fillna(0) - 10, 0, None), 0)
q["dome"] = ~q.outdoor
q = q.sort_values(["season", "week"]).reset_index(drop=True)


def build_features(col, half_life=4.0, k_prior=4.0, career_decay=0.6):
    """Walk-forward form + opponent factor for one stat column."""
    decay = 0.5 ** (1 / half_life)
    league = q[q.primary].groupby("season")[col].mean()
    form = np.full(len(q), np.nan)
    opp = np.ones(len(q))
    hist = {}  # player -> {season: [sum, n]} for primary-ish games
    for season, sq in q.groupby("season", sort=True):
        lg_prev = league.get(season - 1, league.get(season))
        # opponent allowed so far (primary QB games against them), by week
        allowed = {}
        league_sum = league_n = 0.0
        weeks = sorted(sq.week.unique())
        season_games = {}  # player -> list of (value, share)
        for w in weeks:
            wk = sq[sq.week == w]
            lg_now = league_sum / league_n if league_n >= 32 else lg_prev
            for i, r in wk.iterrows():
                if not r.primary:
                    continue
                # opponent factor
                a = allowed.get(r.opponent_team)
                if a and lg_now > 0:
                    raw = (a[0] / a[1]) / lg_now
                    opp[i] = 1 + (raw - 1) * (a[1] / (a[1] + 4))
                # prior from previous seasons (decaying), then league
                ps = hist.get(r.player_id, {})
                num = den = 0.0
                for s_, (sm, nn) in ps.items():
                    wgt = career_decay ** (season - 1 - s_)
                    num += wgt * sm
                    den += wgt * nn
                prior_mean = (num + 4 * lg_prev) / (den + 4) if den else lg_prev
                prior_w = min(den, 12) * 0.5 + 1  # games of evidence the prior is worth
                g = season_games.get(r.player_id, [])
                fn = fd = 0.0
                for j, (v, sh) in enumerate(g):
                    wj = decay ** (len(g) - 1 - j) * sh
                    fn += wj * v / sh
                    fd += wj
                form[i] = (fn + prior_w * prior_mean * k_prior / 4) / (fd + prior_w * k_prior / 4)
            for i, r in wk.iterrows():
                v = r[col]
                if r.primary:
                    a = allowed.setdefault(r.opponent_team, [0.0, 0])
                    a[0] += v
                    a[1] += 1
                    league_sum += v
                    league_n += 1
                sh = min(1.0, max(0.5, r.share if r.share == r.share else 1.0))
                if r.attempts >= 5:
                    season_games.setdefault(r.player_id, []).append((v, sh))
        for pid, g in season_games.items():
            hist.setdefault(pid, {})[season] = (sum(v / sh for v, sh in g), len(g))
    return form, opp


def league_level(col):
    """Walk-forward league level: this season's primary starts before the week, blended with the
    previous two seasons (worth 64 starts), so a league-wide trend shows up within weeks."""
    prim = q[q.primary]
    by_season = prim.groupby("season")[col].agg(["sum", "count"])
    by_week = prim.groupby(["season", "week"])[col].agg(["sum", "count"])
    out = pd.Series(np.nan, index=q.index)
    for (season, week), idx in q.groupby(["season", "week"]).groups.items():
        prev = [by_season.loc[s_] for s_ in (season - 1, season - 2) if s_ in by_season.index]
        if not prev:
            continue
        base = sum(p["sum"] for p in prev) / sum(p["count"] for p in prev)
        cur = by_week.loc[season] if season in by_week.index.get_level_values(0) else None
        if cur is not None:
            cur = cur[cur.index < week]
            sm, n = cur["sum"].sum(), cur["count"].sum()
        else:
            sm = n = 0
        out[idx] = (sm + 64 * base) / (n + 64)
    return out


def design(df, form, opp, col):
    x = pd.DataFrame({
        "const": 1.0,
        "league": df["league_" + col],
        "form": form,
        "form_x_implied": form * (df.implied_pts - 22) / 22,
        "form_x_opp": form * np.log(np.clip(opp, 0.6, 1.6)),
        "total_dev": df.total_line - 44,
        "own_line": df.own_line,
        "wind_x": df.wind_x,
        "dome": df.dome.astype(float),
        "home": df.home.astype(float),
    }, index=df.index)
    return x


def fit(x, y):
    """Median (least absolute deviation) fit: a prop line sits at the typical game, not the average."""
    from statsmodels.regression.quantile_regression import QuantReg
    return QuantReg(y.values, x.values).fit(q=0.5, max_iter=5000).params


def metrics(p, y):
    e = p - y
    return np.mean(np.abs(e)), np.sqrt(np.mean(e ** 2)), np.mean(e)


if __name__ == "__main__":
    site = pd.read_csv("/root/fbdata/qb_site_replay.csv")
    rows = []
    for key, col in STATS.items():
        form, opp = build_features(col)
        q["league_" + col] = league_level(col)
        q["form_" + key] = form
        q["opp_" + key] = opp
        d = q[q.primary & q.total_line.notna() & ~np.isnan(form) & q["league_" + col].notna()].copy()
        x = design(d, d["form_" + key], d["opp_" + key], col)
        y = d[col]
        # refit every season on all earlier seasons (what the site would do), from 2013 on
        d["pred"] = np.nan
        for season in range(2013, 2026):
            tr = d.season < season
            te = d.season == season
            beta = fit(x[tr], y[tr])
            d.loc[te, "pred"] = np.clip(x[te].values @ beta, 0, None)
        d = d[d.pred.notna()]
        s = site[site.market == key][["game_id", "player_id", "projected"]]
        d = d.merge(s, on=["game_id", "player_id"], how="inner")
        for lab, a, b in (("2013-2025", 2013, 2025), ("2022-2025", 2022, 2025)):
            t = d[d.season.between(a, b)]
            m_site = metrics(t.projected, t[col])
            m_new = metrics(t.pred, t[col])
            rows.append(dict(stat=key, test=lab, n=len(t), site_mae=round(m_site[0], 2), new_mae=round(m_new[0], 2),
                             better=f"{100*(1-m_new[0]/m_site[0]):+.1f}%", site_bias=round(m_site[2], 2), new_bias=round(m_new[2], 2)))
        q.loc[d.index if False else q.index, "x"] = 0
        d[["season", "week", "game_id", "player_id", "player_display_name", "team", "opponent_team", col, "pred", "projected",
           "implied_pts", "total_line", "own_line", "wind_x", "dome"]].rename(columns={col: "actual"}).to_csv(
            f"/root/fbdata/qb_pred_{key}.csv", index=False)
        print(key, "coefficients:", dict(zip(x.columns, np.round(beta, 3))))
    print(pd.DataFrame(rows).to_string(index=False))
