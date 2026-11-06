"""Men's college basketball: every total pick (blended v3 model) graded at the opening vs the closing total,
by edge size, 2023-24 to 2025-26 (the seasons with openers). python3 research/cbb/totals_open.py"""
src = open("research/wcbb/model.py").read()
src = src.split('print("\\nAccuracy')[0]
src = src.replace('SEASONS = ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]', 'SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]')
src = src.replace('src = src.replace(\'research/cbb/data/\', \'research/wcbb/data/\')', '')
src = src.replace("src = src.replace('def empty_prior(S, eff=103.0, tpo=68.0):', 'def empty_prior(S, eff=98.0, tpo=70.0):')", "")
src = src.replace("for s in SEASONS:\n    rows = DATA[s] or []", "for s in []:\n    rows = []")
exec(src)
for which in ("close", "open"):
    for th in (2, 3, 4, 6):
        W = L = 0; per = []
        for s in ("2023-24", "2024-25", "2025-26"):
            mk = market_preds(DATA[s]); w = l = 0
            for x, y in zip(out[s], mk):
                r = x[0]
                if x[4]: continue
                ln = (r.get(which) or [None, None])[1]
                if ln is None: continue
                t = 0.5 * x[2] + 0.5 * y[1] if y[2] else x[2]   # the site blends once both teams have 3+ games
                tot = r["h"][1] + r["a"][1]
                if abs(t - ln) < th or tot == ln: continue
                if (tot > ln) == (t > ln): w += 1
                else: l += 1
            per.append(f"{s}:{w}-{l} ({w/max(1,w+l)*100:.1f}%)"); W += w; L += l
        print(f"vs {which:<5} {th}+: {W}-{L} ({W/(W+L)*100:.1f}%, {W*100/110-L:+.1f}u)  " + " ".join(per))
