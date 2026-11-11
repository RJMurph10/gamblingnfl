/**
 * ★ best bets on past college seasons: [wins, losses, pushes] per rule, FBS vs FBS regular
 * season, graded at the consensus closing line (lines: sportsdataverse cfbfastR-data; scores:
 * CollegeFootballData). Rebuilt on 2013–2025 with python/cfb_angle_lab.py --emit-site, one source
 * for every rule (2009–2012 dropped: those lines came from a different source). Bounce-back counts
 * a 28+ point loss; a game where bounce-back and cross-country both fire is bet by neither.
 * "rivalry": road team in a traditional rivalry (src/data/cfb/cfb-rivalries.ts), true home/road, trip < 800 mi
 * (research: claude/cfb-rivalries.md); takes precedence over bounce-back.
 * "open-total" is graded at the consensus OPENING total (research/football/scripts/cfb_totals_open.py, week 3 on;
 * no 2020 openers).
 */
import type { CfbRuleId } from "@/lib/cfb/cfb-model";

export const CFB_HISTORY: Record<number, Partial<Record<CfbRuleId, [number, number, number]>>> = {
  2013: { bounce: [37, 35, 0], travel: [12, 9, 0], early: [42, 41, 1], academy: [2, 1, 0], "open-total": [102, 103, 3], rivalry: [23, 21, 2] },
  2014: { bounce: [27, 31, 0], travel: [11, 10, 1], early: [39, 43, 1], academy: [3, 0, 0], "open-total": [93, 74, 0], rivalry: [21, 19, 2] },
  2015: { bounce: [33, 24, 1], travel: [7, 12, 0], early: [45, 45, 0], academy: [3, 0, 0], "open-total": [89, 93, 1], rivalry: [25, 15, 0] },
  2016: { bounce: [35, 22, 0], travel: [6, 7, 0], early: [49, 37, 1], academy: [3, 0, 0], "open-total": [99, 87, 2], rivalry: [28, 14, 0] },
  2017: { bounce: [33, 30, 2], travel: [5, 9, 0], early: [50, 38, 2], academy: [2, 1, 0], "open-total": [89, 93, 0], rivalry: [26, 18, 1] },
  2018: { bounce: [35, 23, 1], travel: [7, 6, 2], early: [48, 46, 0], academy: [3, 0, 0], "open-total": [74, 59, 1], rivalry: [27, 16, 0] },
  2019: { bounce: [33, 24, 2], travel: [8, 7, 0], early: [48, 42, 1], academy: [2, 1, 0], "open-total": [82, 67, 0], rivalry: [23, 17, 2] },
  2020: { bounce: [23, 19, 2], travel: [5, 2, 0], early: [13, 6, 0], academy: [2, 1, 0], rivalry: [20, 15, 0] },
  2021: { bounce: [29, 30, 0], travel: [9, 5, 1], early: [57, 36, 2], academy: [3, 0, 0], "open-total": [78, 63, 2], rivalry: [27, 25, 2] },
  2022: { bounce: [31, 30, 1], travel: [7, 7, 0], early: [56, 43, 1], academy: [2, 1, 0], "open-total": [84, 76, 1], rivalry: [31, 18, 1] },
  2023: { bounce: [37, 24, 1], travel: [10, 6, 0], early: [54, 45, 0], academy: [2, 0, 1], "open-total": [87, 74, 1], rivalry: [29, 22, 1] },
  2024: { bounce: [28, 24, 1], travel: [20, 13, 2], early: [53, 33, 2], academy: [1, 2, 0], "open-total": [93, 46, 1], rivalry: [27, 20, 1] },
  2025: { bounce: [41, 16, 1], travel: [20, 14, 0], early: [49, 48, 1], academy: [2, 1, 0], "open-total": [73, 52, 0], rivalry: [22, 23, 5] },
};
