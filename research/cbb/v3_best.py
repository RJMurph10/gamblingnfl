"""★ best bets with the v3 blend (50% market view), by season: record, units, at the close too."""
import sys; sys.path.insert(0, "research/cbb")
import numpy as np
import model_v2 as m
from v3_market import market_preds, out  # noqa: E402  (runs the v2 model once)

for s in ["2023-24", "2024-25", "2025-26"]:
    mk = market_preds(m.DATA[s])
    sel = [(x, y) for x, y in zip(out[s], mk) if not x[4] and x[0].get("open") and x[0]["open"][1] is not None and y[2]]
    tot = np.array([r["h"][1] + r["a"][1] for (r, *_), _ in sel], float)
    ot = np.array([r["open"][1] for (r, *_), _ in sel])
    b = 0.5 * np.array([y[1] for _, y in sel]) + 0.5 * np.array([x[2] for x, _ in sel])
    e = b - ot; k = np.abs(e) >= 6
    v = (tot - ot)[k] * np.sign(e[k]); w = int((v > 0).sum()); l = int((v < 0).sum())
    print(s, w, l, round(w / (w + l) * 100, 1), round(w * 100 / 110 - l, 1))
