/**
 * Each WNBA season's starting ratings: the previous season's final offense / defense / tempo (points per
 * 100 possessions above / below average, possessions above / below average), before shrinking. Generated
 * by research/wnba/model.py's chain (2018 on), so the site starts every season exactly as the backtest did.
 * Add next season's entry after the Finals (see research/wnba/README.md).
 */
export interface WnbaPrior {
  eff: number;
  tempo: number;
  teams: Record<string, [number, number, number]>;
}

export const WNBA_PRIORS: Record<number, WnbaPrior> = {
  2026: {
    eff: 100.51,
    tempo: 81.19,
    teams: {
      "17": [3.64, -0.06, -0.2], // Aces
      "20": [2.89, -3.45, -1.3], // Dream
      "5": [1.69, -1.03, 0.95], // Fever
      "9": [1.9, -1.48, 0.2], // Liberty
      "8": [4.75, -3.97, -0.86], // Lynx
      "11": [0.13, -2.34, 0.77], // Mercury
      "16": [-4.95, 0.8, -0.51], // Mystics
      "19": [-5.72, 5.73, -0.85], // Sky
      "6": [2.19, 5.8, 1.87], // Sparks
      "14": [-0.7, -2.03, 0.53], // Storm
      "18": [-5.9, 4.97, -0.61], // Sun
      "129689": [-2.39, -2.11, -2.53], // Valkyries
      "3": [-1.14, 5.93, 1.54], // Wings
    },
  },
  2027: {
    eff: 103.63,
    tempo: 82.67,
    teams: {
      "17": [4.82, 0.84, -0.28], // Aces
      "20": [2.29, -4.39, 0.98], // Dream
      "5": [6.5, 2.51, 2.55], // Fever
      "132052": [-1.42, 6.0, 0.5], // Fire
      "9": [3.03, 0.32, -0.09], // Liberty
      "8": [4.69, -1.02, -0.65], // Lynx
      "11": [-2.31, 2.54, -0.53], // Mercury
      "16": [-3.37, -1.74, -0.79], // Mystics
      "19": [-3.02, 3.22, 2.11], // Sky
      "6": [-1.59, 4.36, 1.78], // Sparks
      "14": [-6.86, 1.61, 1.32], // Storm
      "18": [-9.18, 2.54, -0.14], // Sun
      "131935": [-1.71, 9.72, 0.29], // Tempo
      "129689": [-1.75, -7.9, -4.43], // Valkyries
      "3": [3.71, 1.61, -0.23], // Wings
    },
  },
};
