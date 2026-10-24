/**
 * Watch-list angles on past college seasons: [wins, losses, pushes] per season, FBS vs FBS
 * regular season at the consensus closing line. Tracked on the model page; not bet.
 * Made with python/build_cfb_history.py --watch.
 */
import type { CfbWatchId } from "@/lib/cfb-model";

export const CFB_WATCH_HISTORY: Partial<
  Record<CfbWatchId, Record<number, [number, number, number]>>
> = {
  late: {
    2009: [12, 10, 0],
    2010: [16, 15, 0],
    2011: [12, 15, 0],
    2012: [16, 23, 1],
    2013: [22, 21, 0],
    2014: [30, 21, 0],
    2015: [31, 18, 0],
    2016: [22, 30, 0],
    2017: [30, 22, 0],
    2018: [30, 18, 1],
    2019: [28, 17, 0],
    2020: [16, 8, 0],
    2021: [25, 26, 0],
    2022: [30, 20, 1],
    2023: [26, 18, 0],
    2024: [23, 18, 2],
    2025: [21, 24, 0],
  },
  eastlate: {
    2009: [4, 2, 0],
    2010: [6, 0, 0],
    2011: [0, 4, 0],
    2012: [6, 2, 0],
    2013: [1, 4, 0],
    2014: [0, 3, 0],
    2015: [3, 2, 0],
    2016: [3, 2, 0],
    2017: [1, 3, 0],
    2018: [4, 1, 0],
    2019: [2, 5, 1],
    2020: [1, 1, 0],
    2021: [4, 3, 0],
    2022: [4, 4, 0],
    2023: [7, 3, 0],
    2024: [9, 3, 1],
    2025: [13, 6, 0],
  },
};
