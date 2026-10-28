/**
 * FBS home stadiums: ESPN team id → [latitude, longitude, time zone, 1 if domed]. For travel
 * distance, the road team's body clock and kickoff weather. From CollegeFootballData's team
 * info (2025 season), via sportsdataverse cfbfastR-data.
 */
export type CfbStadium = [lat: number, lon: number, timeZone: string, dome?: 1];

export const CFB_STADIUMS: Record<number, CfbStadium> = {
  2: [32.6026, -85.4897, "America/Chicago"], // Auburn
  5: [33.5207, -86.8024, "America/Chicago"], // UAB
  6: [30.6969, -88.192, "America/Chicago"], // South Alabama
  8: [36.0681, -94.179, "America/Chicago"], // Arkansas
  9: [33.4264, -111.9325, "America/Phoenix"], // Arizona State
  12: [32.2288, -110.9489, "America/Phoenix"], // Arizona
  21: [32.7844, -117.1228, "America/Los_Angeles"], // San Diego State
  23: [37.3197, -121.8683, "America/Los_Angeles"], // San José State
  24: [37.4346, -122.1611, "America/Los_Angeles"], // Stanford
  25: [37.871, -122.2508, "America/Los_Angeles"], // California
  26: [34.1613, -118.1676, "America/Los_Angeles"], // UCLA
  30: [34.0142, -118.2878, "America/Los_Angeles"], // USC
  36: [40.57, -105.0884, "America/Denver"], // Colorado State
  38: [40.0095, -105.2669, "America/Denver"], // Colorado
  41: [41.7596, -72.6188, "America/New_York"], // UConn
  48: [39.6617, -75.7488, "America/New_York"], // Delaware
  52: [30.4382, -84.3044, "America/New_York"], // Florida State
  55: [33.8201, -85.7665, "America/Chicago"], // Jacksonville State
  57: [29.6499, -82.3486, "America/New_York"], // Florida
  58: [27.9759, -82.5033, "America/New_York"], // South Florida
  59: [33.7724, -84.3928, "America/New_York"], // Georgia Tech
  61: [33.9498, -83.3734, "America/New_York"], // Georgia
  62: [21.2943, -157.8193, "Pacific/Honolulu"], // Hawai'i
  66: [42.014, -93.6358, "America/Chicago"], // Iowa State
  68: [43.6029, -116.1959, "America/Boise"], // Boise State
  77: [42.0582, -87.6709, "America/Chicago"], // Northwestern
  84: [39.1809, -86.5256, "America/Indiana/Indianapolis"], // Indiana
  87: [41.6984, -86.2339, "America/Indiana/Indianapolis"], // Notre Dame
  96: [38.0221, -84.5053, "America/New_York"], // Kentucky
  97: [38.2058, -85.7588, "America/Kentucky/Louisville"], // Louisville
  98: [36.9848, -86.4594, "America/Chicago"], // Western Kentucky
  99: [30.412, -91.1838, "America/Chicago"], // LSU
  103: [42.3351, -71.1664, "America/New_York"], // Boston College
  113: [42.3773, -72.5361, "America/New_York"], // Massachusetts
  120: [38.9903, -76.9474, "America/New_York"], // Maryland
  127: [42.7281, -84.4849, "America/Detroit"], // Michigan State
  130: [42.2658, -83.7487, "America/Detroit"], // Michigan
  135: [44.9765, -93.2245, "America/Chicago"], // Minnesota
  142: [38.9358, -92.3332, "America/Chicago"], // Missouri
  145: [34.362, -89.5342, "America/Chicago"], // Ole Miss
  150: [35.9954, -78.9418, "America/New_York"], // Duke
  151: [35.5968, -77.3646, "America/New_York"], // East Carolina
  152: [35.8008, -78.7196, "America/New_York"], // NC State
  153: [35.9069, -79.0479, "America/New_York"], // North Carolina
  154: [36.1306, -80.2546, "America/New_York"], // Wake Forest
  158: [40.8207, -96.7056, "America/Chicago"], // Nebraska
  164: [40.5136, -74.4653, "America/New_York"], // Rutgers
  166: [32.2796, -106.7411, "America/Denver"], // New Mexico State
  167: [35.0669, -106.6283, "America/Denver"], // New Mexico
  183: [43.0362, -76.1363, "America/New_York", 1], // Syracuse
  189: [41.378, -83.6225, "America/New_York"], // Bowling Green
  193: [39.5197, -84.733, "America/New_York"], // Miami (OH)
  194: [40.0016, -83.0197, "America/New_York"], // Ohio State
  195: [39.3213, -82.1034, "America/New_York"], // Ohio
  197: [36.1257, -97.0665, "America/Chicago"], // Oklahoma State
  201: [35.2059, -97.4423, "America/Chicago"], // Oklahoma
  202: [36.1489, -95.9438, "America/Chicago"], // Tulsa
  204: [44.5595, -123.2814, "America/Los_Angeles"], // Oregon State
  213: [40.8122, -77.8561, "America/New_York"], // Penn State
  218: [39.9008, -75.1675, "America/New_York"], // Temple
  221: [40.4468, -80.0158, "America/New_York"], // Pittsburgh
  228: [34.6788, -82.8432, "America/New_York"], // Clemson
  235: [35.1209, -89.9771, "America/Chicago"], // Memphis
  238: [36.144, -86.8089, "America/Chicago"], // Vanderbilt
  239: [31.5582, -97.1157, "America/Chicago"], // Baylor
  242: [29.7163, -95.4093, "America/Chicago"], // Rice
  245: [30.6099, -96.3404, "America/Chicago"], // Texas A&M
  248: [29.722, -95.3492, "America/Chicago"], // Houston
  249: [33.2039, -97.1592, "America/Chicago"], // North Texas
  251: [30.2837, -97.7325, "America/Chicago"], // Texas
  252: [40.2575, -111.6545, "America/Denver"], // BYU
  254: [40.76, -111.8488, "America/Denver"], // Utah
  256: [38.4353, -78.8729, "America/New_York"], // James Madison
  258: [38.0312, -78.5138, "America/New_York"], // Virginia
  259: [37.22, -80.4181, "America/New_York"], // Virginia Tech
  264: [47.6503, -122.3016, "America/Los_Angeles"], // Washington
  265: [46.7318, -117.1605, "America/Los_Angeles"], // Washington State
  275: [43.0699, -89.4127, "America/Chicago"], // Wisconsin
  276: [38.4247, -82.4214, "America/New_York"], // Marshall
  277: [39.6503, -79.9552, "America/New_York"], // West Virginia
  278: [36.8144, -119.758, "America/Los_Angeles"], // Fresno State
  290: [32.4122, -81.7849, "America/New_York"], // Georgia Southern
  295: [36.889, -76.3049, "America/New_York"], // Old Dominion
  309: [30.2158, -92.0417, "America/Chicago"], // Louisiana
  324: [33.7929, -79.0167, "America/New_York"], // Coastal Carolina
  326: [29.891, -97.9256, "America/Chicago"], // Texas State
  328: [41.7517, -111.8116, "America/Denver"], // Utah State
  333: [33.2083, -87.5504, "America/Chicago"], // Alabama
  338: [34.0289, -84.5676, "America/New_York"], // Kennesaw State
  344: [33.4563, -88.7934, "America/Chicago"], // Mississippi State
  349: [41.3875, -73.9641, "America/New_York"], // Army
  356: [40.0993, -88.236, "America/Chicago"], // Illinois
  2005: [38.997, -104.8436, "America/Denver"], // Air Force
  2006: [41.0726, -81.5083, "America/New_York"], // Akron
  2026: [36.2114, -81.6854, "America/New_York"], // App State
  2032: [35.8489, -90.6677, "America/Chicago"], // Arkansas State
  2050: [40.2159, -85.4161, "America/Indiana/Indianapolis"], // Ball State
  2084: [42.9991, -78.7775, "America/New_York"], // Buffalo
  2116: [28.608, -81.1927, "America/New_York"], // UCF
  2117: [43.5777, -84.771, "America/Detroit"], // Central Michigan
  2132: [39.1312, -84.5162, "America/New_York"], // Cincinnati
  2199: [42.2561, -83.6473, "America/Detroit"], // Eastern Michigan
  2226: [26.3764, -80.1016, "America/New_York"], // Florida Atlantic
  2229: [25.7525, -80.3778, "America/New_York"], // Florida International
  2247: [33.7353, -84.3899, "America/New_York"], // Georgia State
  2294: [41.6586, -91.5511, "America/Chicago"], // Iowa
  2305: [38.9629, -95.2464, "America/Chicago"], // Kansas
  2306: [39.202, -96.5938, "America/Chicago"], // Kansas State
  2309: [41.1391, -81.3135, "America/New_York"], // Kent State
  2335: [37.3544, -79.175, "America/New_York"], // Liberty
  2348: [32.5321, -92.656, "America/Chicago"], // Louisiana Tech
  2390: [25.958, -80.2389, "America/New_York"], // Miami
  2393: [35.8511, -86.3682, "America/Chicago"], // Middle Tennessee
  2426: [38.9847, -76.5076, "America/New_York"], // Navy
  2429: [35.3105, -80.7401, "America/New_York"], // Charlotte
  2433: [32.5308, -92.0661, "America/Chicago"], // UL Monroe
  2439: [36.0907, -115.1837, "America/Los_Angeles", 1], // UNLV
  2440: [39.5469, -119.8175, "America/Los_Angeles"], // Nevada
  2459: [41.934, -88.7778, "America/Chicago"], // Northern Illinois
  2483: [44.0583, -123.0685, "America/Los_Angeles"], // Oregon
  2509: [40.4352, -86.9187, "America/Indiana/Indianapolis"], // Purdue
  2534: [30.7139, -95.542, "America/Chicago"], // Sam Houston
  2567: [32.8377, -96.7828, "America/Chicago"], // SMU
  2572: [31.3289, -89.3318, "America/Chicago"], // Southern Miss
  2579: [33.973, -81.0192, "America/New_York"], // South Carolina
  2623: [37.1976, -93.2798, "America/Chicago"], // Missouri State
  2628: [32.7097, -97.3681, "America/Chicago"], // TCU
  2633: [35.955, -83.925, "America/New_York"], // Tennessee
  2636: [29.417, -98.4788, "America/Chicago", 1], // UTSA
  2638: [31.7733, -106.508, "America/Denver"], // UTEP
  2641: [33.5911, -101.8729, "America/Chicago"], // Texas Tech
  2649: [41.6575, -83.6136, "America/New_York"], // Toledo
  2653: [31.7996, -85.9518, "America/Chicago"], // Troy
  2655: [29.9446, -90.1167, "America/Chicago"], // Tulane
  2711: [42.286, -85.6008, "America/Detroit"], // Western Michigan
  2751: [41.3116, -105.5681, "America/Denver"], // Wyoming
};
