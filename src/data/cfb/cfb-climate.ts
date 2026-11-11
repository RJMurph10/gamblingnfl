/**
 * College football home climate: each FBS school's median kickoff temperature (°F) for October and
 * November home games, 2013-2025 (Open-Meteo archive, research/football/scripts/fetch_cfb_weather.mjs).
 * Domed schools are missing (no outdoor home games). Used by the climate / altitude home adjustment.
 */
export const CFB_CLIMATE_F: Record<number, number> = {
  2: 65, // Auburn
  5: 72, // UAB
  6: 69, // South Alabama
  8: 59, // Arkansas
  9: 79, // Arizona State
  12: 75, // Arizona
  21: 66, // San Diego State
  23: 63, // San José State
  24: 63, // Stanford
  25: 63, // California
  26: 70, // UCLA
  30: 68, // USC
  36: 52, // Colorado State
  38: 53, // Colorado
  41: 53, // UConn
  48: 59, // Delaware
  52: 76, // Florida State
  55: 65, // Jacksonville State
  57: 74, // Florida
  58: 77, // South Florida
  59: 61, // Georgia Tech
  61: 64, // Georgia
  62: 78, // Hawai'i
  66: 52, // Iowa State
  68: 48, // Boise State
  77: 47, // Northwestern
  84: 54, // Indiana
  87: 50, // Notre Dame
  96: 56, // Kentucky
  97: 58, // Louisville
  98: 59, // Western Kentucky
  99: 72, // LSU
  103: 50, // Boston College
  113: 56, // Massachusetts
  120: 54, // Maryland
  127: 45, // Michigan State
  130: 46, // Michigan
  135: 42, // Minnesota
  142: 56, // Missouri
  145: 61, // Ole Miss
  150: 62, // Duke
  151: 64, // East Carolina
  152: 59, // NC State
  153: 65, // North Carolina
  154: 60, // Wake Forest
  158: 54, // Nebraska
  164: 55, // Rutgers
  166: 71, // New Mexico State
  167: 60, // New Mexico
  189: 50, // Bowling Green
  193: 53, // Miami (OH)
  194: 51, // Ohio State
  195: 53, // Ohio
  197: 63, // Oklahoma State
  201: 60, // Oklahoma
  202: 62, // Tulsa
  204: 54, // Oregon State
  213: 48, // Penn State
  218: 58, // Temple
  221: 53, // Pittsburgh
  228: 62, // Clemson
  235: 63, // Memphis
  238: 61, // Vanderbilt
  239: 64, // Baylor
  242: 73, // Rice
  245: 69, // Texas A&M
  248: 74, // Houston
  249: 68, // North Texas
  251: 69, // Texas
  252: 53, // BYU
  254: 47, // Utah
  256: 58, // James Madison
  258: 59, // Virginia
  259: 56, // Virginia Tech
  264: 52, // Washington
  265: 48, // Washington State
  275: 49, // Wisconsin
  276: 54, // Marshall
  277: 51, // West Virginia
  278: 67, // Fresno State
  290: 70, // Georgia Southern
  295: 62, // Old Dominion
  309: 73, // Louisiana
  324: 68, // Coastal Carolina
  326: 72, // Texas State
  328: 46, // Utah State
  333: 68, // Alabama
  338: 67, // Kennesaw State
  344: 64, // Mississippi State
  349: 54, // Army
  356: 52, // Illinois
  2005: 52, // Air Force
  2006: 49, // Akron
  2026: 53, // App State
  2032: 62, // Arkansas State
  2050: 54, // Ball State
  2084: 51, // Buffalo
  2116: 76, // UCF
  2117: 47, // Central Michigan
  2132: 56, // Cincinnati
  2199: 49, // Eastern Michigan
  2226: 79, // Florida Atlantic
  2229: 78, // Florida International
  2247: 66, // Georgia State
  2294: 52, // Iowa
  2305: 53, // Kansas
  2306: 59, // Kansas State
  2309: 52, // Kent State
  2335: 60, // Liberty
  2348: 69, // Louisiana Tech
  2390: 77, // Miami
  2393: 59, // Middle Tennessee
  2426: 59, // Navy
  2429: 63, // Charlotte
  2433: 71, // UL Monroe
  2440: 53, // Nevada
  2459: 50, // Northern Illinois
  2483: 55, // Oregon
  2509: 50, // Purdue
  2534: 73, // Sam Houston
  2567: 66, // SMU
  2572: 71, // Southern Miss
  2579: 64, // South Carolina
  2623: 48, // Missouri State
  2628: 71, // TCU
  2633: 60, // Tennessee
  2638: 69, // UTEP
  2641: 64, // Texas Tech
  2649: 50, // Toledo
  2653: 70, // Troy
  2655: 74, // Tulane
  2711: 48, // Western Michigan
  2751: 47, // Wyoming
};

/** FBS home stadiums at 4,000+ ft: Air Force, Wyoming, Colorado, Colorado State, New Mexico, Utah, BYU, Utah State, Nevada. */
export const CFB_HIGH_ALTITUDE = new Set([2005, 2751, 38, 36, 167, 254, 252, 328, 2440]);
