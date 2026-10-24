/**
 * ★ best bets on past college seasons: [wins, losses, pushes] per rule, FBS vs FBS regular
 * season, graded at the consensus closing line (lines: sportsdataverse cfbfastR-data; scores:
 * CollegeFootballData). Made with python/build_cfb_history.py.
 */
import type { CfbRuleId } from "@/lib/cfb-model";

export const CFB_HISTORY: Record<number, Partial<Record<CfbRuleId, [number, number, number]>>> = {
  2009: { bounce: [37, 32, 0], early: [40, 35, 0], academy: [2, 1, 0] },
  2010: { bounce: [48, 41, 2], early: [39, 31, 0], academy: [2, 1, 0] },
  2011: { bounce: [43, 52, 0], early: [42, 36, 0], academy: [2, 1, 0] },
  2012: { bounce: [47, 36, 2], early: [41, 40, 1], academy: [3, 0, 0] },
  2013: { bounce: [45, 61, 0], early: [38, 40, 1], academy: [2, 1, 0] },
  2014: { bounce: [56, 40, 0], early: [36, 42, 1], academy: [3, 0, 0] },
  2015: { bounce: [51, 39, 3], early: [41, 45, 0], academy: [3, 0, 0] },
  2016: { bounce: [53, 40, 0], early: [46, 34, 2], academy: [3, 0, 0] },
  2017: { bounce: [53, 40, 4], early: [48, 36, 2], academy: [2, 1, 0] },
  2018: { bounce: [53, 46, 1], early: [48, 43, 0], academy: [3, 0, 0] },
  2019: { bounce: [48, 52, 3], early: [45, 41, 2], academy: [2, 1, 0] },
  2020: { bounce: [32, 32, 2], early: [13, 6, 0], academy: [2, 1, 0] },
  2021: { bounce: [47, 48, 0], early: [56, 36, 2], academy: [3, 0, 0] },
  2022: { bounce: [57, 46, 2], early: [56, 43, 1], academy: [2, 1, 0] },
  2023: { bounce: [55, 35, 2], early: [54, 45, 0], academy: [2, 0, 1] },
  2024: { bounce: [54, 47, 1], early: [53, 33, 2], academy: [1, 2, 0] },
  2025: { bounce: [58, 38, 1], early: [49, 48, 1], academy: [2, 1, 0] },
};
