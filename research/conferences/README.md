# Conference pace vs the totals (November 2026)

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
| CBB | OVC unders | 56.2% (789 games, p 0.0006) | 56.4% (397) | Yes, at close and open |
| CBB | Summit unders | 55.0% (694) | 56.9% (350) | Yes |
| CBB | A-10 unders | 53.6% (879) | 55.6% (437) | Yes |
| CBB | SEC overs | 55.2% (919) | 53.6% (457) | No, 48.4% at the open last 2 seasons |
| CFB | SEC unders | 53.7% (751) | 54.1% (678) | Yes, both eras at open (54.5 / 53.7) |

- Only OVC unders survive a strict check for testing 32 conferences (Bonferroni 0.0016).
- **Next step:** check these against the CBB model's ★ totals, which may already capture them. Then decide whether to add a conference adjustment.
