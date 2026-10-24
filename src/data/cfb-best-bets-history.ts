/**
 * ★ best bets on past college seasons: [wins, losses, pushes] per rule, FBS vs FBS regular
 * season, graded at the consensus closing line (lines: sportsdataverse cfbfastR-data; scores:
 * CollegeFootballData). Made with python/build_cfb_history.py.
 */
import type { CfbRuleId } from "@/lib/cfb-model";

export const CFB_HISTORY: Record<number, Partial<Record<CfbRuleId, [number, number, number]>>> = {
  2009: { bounce: [37, 32, 0], travel: [3, 1, 0], early: [40, 35, 0], academy: [2, 1, 0] },
  2010: { bounce: [48, 41, 2], travel: [2, 1, 0], early: [39, 31, 0], academy: [2, 1, 0] },
  2011: { bounce: [42, 52, 0], travel: [3, 1, 0], early: [42, 36, 0], academy: [2, 1, 0] },
  2012: { bounce: [47, 36, 2], travel: [4, 3, 0], early: [41, 40, 1], academy: [3, 0, 0] },
  2013: { bounce: [45, 60, 0], travel: [6, 4, 0], early: [38, 40, 1], academy: [2, 1, 0] },
  2014: { bounce: [56, 40, 0], travel: [6, 5, 0], early: [36, 42, 1], academy: [3, 0, 0] },
  2015: { bounce: [51, 39, 3], travel: [4, 5, 0], early: [41, 45, 0], academy: [3, 0, 0] },
  2016: { bounce: [53, 39, 0], travel: [2, 1, 0], early: [46, 34, 2], academy: [3, 0, 0] },
  2017: { bounce: [52, 40, 4], travel: [2, 2, 0], early: [48, 36, 2], academy: [2, 1, 0] },
  2018: { bounce: [53, 45, 1], travel: [1, 1, 1], early: [48, 43, 0], academy: [3, 0, 0] },
  2019: { bounce: [48, 51, 3], travel: [1, 0, 0], early: [45, 41, 2], academy: [2, 1, 0] },
  2020: { bounce: [31, 32, 2], travel: [5, 2, 0], early: [13, 6, 0], academy: [2, 1, 0] },
  2021: { bounce: [46, 47, 0], travel: [8, 4, 1], early: [56, 36, 2], academy: [3, 0, 0] },
  2022: { bounce: [56, 45, 2], travel: [7, 7, 0], early: [56, 43, 1], academy: [2, 1, 0] },
  2023: { bounce: [53, 35, 2], travel: [10, 6, 0], early: [54, 45, 0], academy: [2, 0, 1] },
  2024: { bounce: [52, 45, 1], travel: [18, 11, 2], early: [53, 33, 2], academy: [1, 2, 0] },
  2025: { bounce: [56, 37, 1], travel: [20, 14, 0], early: [49, 48, 1], academy: [2, 1, 0] },
};
