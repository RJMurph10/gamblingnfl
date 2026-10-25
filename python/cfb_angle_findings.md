# GamblingCFB angle lab: findings

Run 2026-10-24 with `python/cfb_angle_lab.py`. 9,307 FBS vs FBS regular-season games with consensus closing lines (CollegeFootballData), 2013-2025. Angles were looked for on 2013-2018 and checked once on 2019-2025. Flat 1 unit at -110, break-even 52.4%. 24 angles tested. The bar for a candidate was set before the run: 53%+ and p < 0.10 on the found seasons, then profitable (above 52.4%, p < 0.10) on the confirm seasons.

## The data checks out

The four rules already on the site reproduce on 2019-2025 (the site's own window is 2018-2025):

| Rule | Site (2018-25) | This run (2019-25) |
|---|---|---|
| Road bounce-back (lost by 21+) | 395-337 | 357-298-10 (54.5%) |
| Cross-country trips (2,000+ mi) | 70-45 | 81-61-3 (57.0%) |
| Early-season unders (weeks 1-2) | 374-295 | 330-253-7 (56.6%) |
| Service academies | 17-6 | 14-6-1 (70.0%) |

Two notes on the controls. Cross-country trips were a coin flip on 2013-2018 here (55-56-3), so that rule rests mostly on the newer seasons. Early unders were flat on 2013-2018 (273-250-5, 52.2%), matching the site's note that they only took off after 2018.

## One candidate: road bounce-back, lost by 28+ (instead of 21+)

| Loss size | Found 2013-18 | Confirmed 2019-25 |
|---|---|---|
| 14+ | 466-459-16 (50.4%, -35.4u) | 520-481-14 (51.9%, -8.3u) |
| 21+ (site rule) | 322-289-11 (52.7%, +3.7u) | 357-298-10 (54.5%, +26.6u) |
| 28+ | 203-172-4 (54.1%, +12.6u) | 229-169-8 (57.5%, +39.2u) |

The edge grows with the size of the loss, which is what an overreaction to a blowout should look like. The games that lost by 21-27 are a coin flip (247-246 over 13 seasons, about -21.5u), so the 28+ version makes more units from fewer bets. 773 bets, 432-341-12 (55.9%), +51.8u, 11 of 13 seasons winning.

## Wind unders: not supported

| Wind | Found | Confirmed |
|---|---|---|
| 8+ mph | 775-698-19 (52.6%, +6.5u) | 840-756-29 (52.6%, +7.6u) |
| 10+ mph | 493-428-12 (53.5%, +20.2u) | 466-441-15 (51.4%, -17.4u) |
| 12+ mph | 297-234-9 (55.9%, +36.0u) | 259-231-10 (52.9%, +4.5u) |
| 15+ mph | 112-79-2 (58.6%, +22.8u) | 86-78-5 (52.4%, +0.2u) |

Each threshold looked good on 2013-2018 and faded on 2019-2025. The 8+ line is steady but only about 0.5% above break-even. The wind here is a weather-model estimate (10 m), not a stadium reading, which weakens any real effect. Not added.

## High-total unders: borderline, worth tracking

| Total | Found | Confirmed |
|---|---|---|
| 60+ | 728-661-23 (52.4%, +0.8u) | 601-498-18 (54.7%, +48.4u), 12 of 13 seasons winning |
| 65+ | 384-342-14 (52.9%, +7.1u) | 257-202-7 (56.0%, +31.6u), 11 of 13 seasons winning |

Both missed the pre-set bar on the found seasons (65+ by 0.1 point), so they are not promoted. They have a plausible reason (shootout totals attract over money) and positive seasons nearly every year. Next step is a forward test on 2026 games. Check overlap with the early-under rule first.

## Early unders: weeks 1-2 only

Week 1 alone: 167-121-4 (58.0%) confirmed. Week 3 (47.9%) and week 4 (47.6%) lose on the confirm seasons, so the edge stops after week 2. Limiting to non-conference games adds nothing (56.4% vs 56.6%). The rule stays as is.

## Time zones: weak but steady

Home vs a visitor 3+ time zones from home: 54.3% found, 53.7% confirmed (combined 165-141-8, +9.0u). Both periods agree, but each is under p = 0.10. Possibly a better definition of travel than miles. Watch only.

## Inconsistent between periods: do not use

| Angle | Found | Confirmed |
|---|---|---|
| Fade a 14+ pt favorite before a top-10 opponent | 47.8% | 59.7% |
| Fade a 21+ pt favorite before a top-10 opponent | 47.9% | 62.8% |
| Fade a first-year coach, weeks 1-4 | 48.8% | 56.7% |
| Under with a first-year coach, weeks 1-4 | 54.3% | 52.1% |
| Home vs visitor who traveled 2,500+ mi | 51.5% | 65.3% |
| Overs on low totals (45 or less) | 44.9% | 50.6% |
| Fade a favorite coming off a win over a top-10 team | 51.4% | 51.8% |

Results that flip direction between periods are what chance looks like.

## Applied to the site

- Bounce-back rule changed from 21+ to 28+. Net of the travel overlap (a game where both rules fire is bet by neither): 200-165-4 (54.8%, +16.8u) on 2013-18, 222-167-8 (57.1%, +34.8u) on 2019-25, 11 of 13 seasons winning.
- Season history for all four rules rebuilt from one source (CollegeFootballData closing lines), 2013-2025. 2009-2012 dropped. Early unders and academies reproduce the old numbers closely.
- Cross-country trips: on this data the rule was flat on 2013-18 (48-53-3, 47.5%) and strong since (79-54-3, 59.4%). From 2020 on, this run matches the old history game for game. Before 2020 the old history counted far fewer qualifying games (for example 1 game in 2019 against 14 here, though Hawaii hosts several visitors a year), so the old found record (32-23) was probably an undercount. Kept as a ★ rule on the strength of 2019-25, labelled as flat before 2020.
- Added to the watch list (tracked, not bet): unders at 60+ and 65+, and the 3+ time zone angle.
- Wind watch card updated with the 2013-25 result (faded from 53.5% to 51.4%).
