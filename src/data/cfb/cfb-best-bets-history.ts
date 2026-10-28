/**
 * ★ best bets on past college seasons: [wins, losses, pushes] per rule, FBS vs FBS regular
 * season, graded at the consensus closing line (lines: sportsdataverse cfbfastR-data; scores:
 * CollegeFootballData). Rebuilt on 2013–2025 with python/cfb_angle_lab.py --emit-site, one source
 * for every rule (2009–2012 dropped: those lines came from a different source). Bounce-back counts
 * a 28+ point loss; a game where bounce-back and cross-country both fire is bet by neither.
 */
import type { CfbRuleId } from "@/lib/cfb/cfb-model";

export const CFB_HISTORY: Record<number, Partial<Record<CfbRuleId, [number, number, number]>>> = {
  2013: { bounce: [37, 35, 0], travel: [12, 9, 0], early: [42, 41, 1], academy: [2, 1, 0] },
  2014: { bounce: [27, 31, 0], travel: [11, 10, 1], early: [39, 43, 1], academy: [3, 0, 0] },
  2015: { bounce: [33, 24, 1], travel: [7, 12, 0], early: [45, 45, 0], academy: [3, 0, 0] },
  2016: { bounce: [35, 22, 0], travel: [6, 7, 0], early: [49, 37, 1], academy: [3, 0, 0] },
  2017: { bounce: [33, 30, 2], travel: [5, 9, 0], early: [50, 38, 2], academy: [2, 1, 0] },
  2018: { bounce: [35, 23, 1], travel: [7, 6, 2], early: [48, 46, 0], academy: [3, 0, 0] },
  2019: { bounce: [33, 24, 2], travel: [8, 7, 0], early: [48, 42, 1], academy: [2, 1, 0] },
  2020: { bounce: [23, 19, 2], travel: [5, 2, 0], early: [13, 6, 0], academy: [2, 1, 0] },
  2021: { bounce: [29, 30, 0], travel: [9, 5, 1], early: [57, 36, 2], academy: [3, 0, 0] },
  2022: { bounce: [31, 30, 1], travel: [7, 7, 0], early: [56, 43, 1], academy: [2, 1, 0] },
  2023: { bounce: [37, 24, 1], travel: [10, 6, 0], early: [54, 45, 0], academy: [2, 0, 1] },
  2024: { bounce: [28, 24, 1], travel: [20, 13, 2], early: [53, 33, 2], academy: [1, 2, 0] },
  2025: { bounce: [41, 16, 1], travel: [20, 14, 0], early: [49, 48, 1], academy: [2, 1, 0] },
};
