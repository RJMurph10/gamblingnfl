# Conference pace vs the totals (November 2026)

> Label fix: an earlier version mislabeled ESPN ids. "OVC" was really the MAAC (id 13) and "Summit" was the SWAC (id 26). The real OVC (20) and Summit (49) show no under lean. The numbers below are unchanged; only the names are corrected.

`conference_pace.py` checks conference games only (both teams in the same conference).
- **CBB:** 2019-20 to 2025-26 at ESPN closing totals, and 2023-24 to 2025-26 at openers.
- **CFB:** FBS 2013-2025 at the consensus close and open.

## Pace is real, and the lines already know it
- **CBB average closing total:** Big Ten 143.4, SEC 147.8.
- **CFB average closing total:** Big Ten 49.8, SEC 53.7, Big 12 58.2, Pac-12 58.7.
- **Big Ten games vs the line:** overs 51.5% in CBB and 50.5% in CFB. No edge either way.

## Leans (32 CBB conferences and 10 CFB conferences tested, so expect a few false positives)
| League | Conference | Close | Open | Both halves of the sample? |
|---|---|---|---|---|
| CBB | MAAC unders | 56.2% (789 games, p 0.0006) | 56.4% (397) | Yes, at close and open |
| CBB | SWAC unders | 55.0% (694) | 56.9% (350) | Yes |
| CBB | A-10 unders | 53.6% (879) | 55.6% (437) | Yes |
| CBB | SEC overs | 55.2% (919) | 53.6% (457) | No, 48.4% at the open last 2 seasons |
| CFB | SEC unders | 53.7% (751) | 54.1% (678) | Yes, both eras at open (54.5 / 53.7) |

- Only MAAC unders survive a strict check for testing 32 conferences (Bonferroni 0.0016).
- **Next step:** check these against the CBB model's ★ totals, which may already capture them. Then decide whether to add a conference adjustment.

## By season (`by_season.py`, unders at the close)
- **MAAC:** 68-47, 53-46, 66-54, 29-29, 64-55, 72-67, 91-48. Ahead in 6 of 7 seasons. Without 2025-26: 54.2%.
- **SWAC:** 55-39, 41-36, 53-60, 31-28, 66-49, 69-48, 67-52. Ahead in 6 of 7.
- **A-10:** about even until 2025-26 (86-53); one season does most of the work.
- **CFB SEC:** strong 2015-19, mixed since (2023 22-34, 2024 37-27, 2025 33-31).
- **Verdict:** MAAC and SWAC unders look real. A-10 and SEC football don't hold up yet.

## Walk-forward (`walk_forward.py`): the honest test
- **Rule, fixed in advance:** each season, bet the side in any conference whose earlier seasons (2 or more) hit it at least 53% with p < 0.10.
- **At the close, 2021-22 to 2025-26:** 2231-1966 (53.2%), +62.2u on 4,197 bets, ROI about +1.5%.
  - By season: 55.1, 52.5, 54.0, 51.4, 53.0%, so 4 of 5 seasons are above break-even.
- **MAAC unders (id 13) were picked every season from 2021-22 on.** Out of sample they went 322-253 (56.0%).
- **At the opener (one test season, 2025-26):** 361-350 (50.8%). Not confirmed.
- **Verdict:** MAAC unders hold up. The broad conference rule is a thin edge at the close, about 1.5% ROI.

## On the site
- ★ MAAC unders, graded at the closing total (PR "CBB: ★ MAAC conference unders").
