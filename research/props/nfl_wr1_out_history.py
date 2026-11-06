"""Ten-plus years of the next-man-up idea without prop lines (none exist free before 2024):
how much does the next man up's receiving production actually rise when the top target is out, season by season
2012-2026, vs his own recent level (recency-weighted mean of earlier games this season + last season's final 8)?
Then the books' bump in 2024-2026 (his opening line vs that same recent level) and what that bump would have done in
every earlier season (a simulated line = recent level x the books' 2024-26 ratio).
  python3 research/props/nfl_wr1_out_history.py"""
import glob, numpy as np, pandas as pd

cols = ["player_id", "player_display_name", "position", "season", "week", "season_type", "team", "targets", "receiving_yards",
        "attempts", "sacks_suffered", "carries"]
S = pd.concat([pd.read_csv(f, usecols=cols, low_memory=False) for f in sorted(glob.glob("/root/fbdata/src/players/stats_player_week_*.csv"))
               if int(f[-8:-4]) >= 2011])
S = S[S.season_type == "REG"].fillna({"targets": 0, "receiving_yards": 0, "attempts": 0, "sacks_suffered": 0, "carries": 0})
S["team"] = S.team.replace({"OAK": "LV", "SD": "LAC", "STL": "LA"})
S["t"] = S.season * 100 + S.week
tg = S.groupby(["team", "t"]).agg(pa=("attempts", "sum"), sk=("sacks_suffered", "sum"), ca=("carries", "sum"), tt=("targets", "sum")).reset_index().sort_values(["team", "t"])
tg["pr"] = (tg.pa + tg.sk) / (tg.pa + tg.sk + tg.ca)
tg["pr_pre"] = tg.groupby("team").pr.transform(lambda x: x.shift(1).rolling(10, min_periods=4).mean())
R = S[S.position.isin(["WR", "TE", "RB"])].merge(tg[["team", "t", "tt"]], on=["team", "t"])
R["sh"] = R.targets / R.tt.replace(0, np.nan)
R = R[R.sh.notna()].sort_values("t")
ew = lambda v, hl: float(np.sum(0.5 ** (np.arange(len(v))[::-1] / hl) * np.array(v)) / np.sum(0.5 ** (np.arange(len(v))[::-1] / hl)))

ev = []
for tm, g in R.groupby("team"):
    ts = sorted(g.t.unique())
    by_t = {t: x for t, x in g.groupby("t")}
    for i, t in enumerate(ts):
        season = t // 100
        if season < 2012: continue
        prev = [x for x in ts[:i] if x // 100 == season] + [x for x in ts[:i] if x // 100 == season - 1][-8:]
        if not prev: continue
        hist = pd.concat([by_t[x] for x in sorted(prev)])
        sh, yd = {}, {}
        for pid, h in hist.groupby("player_id"):
            if len(h) >= 3:
                sh[pid] = ew(list(h.sh), 3.0); yd[pid] = ew(list(h.receiving_yards), 3.0)
        if not sh: continue
        lead = max(sh, key=sh.get)
        cur = by_t[t]; present = set(cur.player_id)
        later = set(g[(g.t > t) & (g.t // 100 == season)].player_id)
        out = lead not in present and sh[lead] >= 0.2 and lead in later
        others = {p: s for p, s in sh.items() if p != lead and p in present}
        if not others: continue
        nxt = max(others, key=others.get)
        act = float(cur[cur.player_id == nxt].receiving_yards.iloc[0])
        ev.append(dict(season=season, t=t, team=tm, out=out, player=nxt, name=cur[cur.player_id == nxt].player_display_name.iloc[0], lvl=yd[nxt], act=act))
E = pd.DataFrame(ev).merge(tg[["team", "t", "pr_pre"]], on=["team", "t"], how="left")
E = E[E.lvl >= 15]
E["ratio"] = E.act / E.lvl
E["run"] = E.pr_pre < 0.57
print("next-man-up games (top target out):", E.out.sum(), "| comparison: the same #2 in games where the top target played:", (~E.out).sum())
print("\nHow the #2 target's receiving yards compare with his recent level (median of actual / level; share of games above 1.2x):")
print(f"{'season':>6} {'top out: n':>10} {'median':>7} {'>1.2x':>6} {'run-lean median':>16} {'pass-heavy median':>18} | {'top plays: median':>18}")
for s, g in E.groupby("season"):
    o = g[g.out]; n = g[~g.out]
    print(f"{s:>6} {len(o):>10} {o.ratio.median():>7.2f} {(o.ratio>1.2).mean()*100:>5.0f}% {o[o.run].ratio.median():>16.2f} {o[~o.run].ratio.median():>18.2f} | {n.ratio.median():>18.2f}")
o = E[E.out]
print(f"{'all':>6} {len(o):>10} {o.ratio.median():>7.2f} {(o.ratio>1.2).mean()*100:>5.0f}% {o[o.run].ratio.median():>16.2f} {o[~o.run].ratio.median():>18.2f} | {E[~E.out].ratio.median():>18.2f}")
E.to_csv("/tmp/claude-0/nmu_hist.csv", index=False)

# ---- the books' bump (2024-2026 opening lines vs the same recent level) and a simulated line for every season ----
import re
norm = lambda s: re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", str(s).lower()))
M = pd.read_csv("/tmp/claude-0/skill_props.csv")
M = M[M.market == "rec_yds"][["season", "week", "nk", "line"]]
E["week"] = E.t % 100; E["nk"] = E.name.map(norm)
L = E.merge(M, on=["season", "week", "nk"], how="inner")
L["lr"] = L.line / L.lvl
print(f"\nBooks' line / recent level, 2024-26: top target OUT {L[L.out].lr.median():.2f} (n={L.out.sum()}), top target playing {L[~L.out].lr.median():.2f} (n={(~L.out).sum()})")
print(f"Actual / level in those same games: OUT {L[L.out].ratio.median():.2f}, playing {L[~L.out].ratio.median():.2f}")
k_out, k_norm = L[L.out].lr.median(), L[~L.out].lr.median()
print(f"\nSimulated line = recent level x {k_out:.2f} (the books' 2024-26 out-game ratio); under rate by season (normal games at x {k_norm:.2f} for comparison):")
for s, g in E.groupby("season"):
    o = g[g.out]; n = g[~g.out]
    print(f"  {s}: out games under {(o.act < o.lvl*k_out).mean()*100:5.1f}% ({len(o)})  run-lean {(o[o.run].act < o[o.run].lvl*k_out).mean()*100:5.1f}% ({o.run.sum()})  pass-heavy {(o[~o.run].act < o[~o.run].lvl*k_out).mean()*100:5.1f}% ({(~o.run).sum()})  | normal games under {(n.act < n.lvl*k_norm).mean()*100:5.1f}%")
o = E[E.out & (E.season <= 2023)]
print(f"  2012-2023 total: under {(o.act < o.lvl*k_out).mean()*100:.1f}% ({len(o)}); run-lean {(o[o.run].act < o[o.run].lvl*k_out).mean()*100:.1f}% ({o.run.sum()}); pass-heavy {(o[~o.run].act < o[~o.run].lvl*k_out).mean()*100:.1f}% ({(~o.run).sum()})")
