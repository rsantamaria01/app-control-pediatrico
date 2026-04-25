/**
 * WHO Child Growth Standards z-score utilities.
 *
 * Implements the LMS formula:
 *   if L != 0: Z = ((Y / M)^L - 1) / (L * S)
 *   if L == 0: Z = ln(Y / M) / S
 *
 * For |Z| > 3, the WHO disjoint regression rule is applied: above SD3 the
 * value is mapped using SD23 = SD3 - SD2, and analogously below SD-3.
 * Reference: "WHO Child Growth Standards: Methods and development",
 * Annex C "Computation of z-scores for restricted applications".
 */

import { Gender, WhoIndicator } from './enums';

export interface LmsRow {
  indicator: WhoIndicator;
  gender: Gender;
  xValue: number;
  l: number;
  m: number;
  s: number;
}

export interface ZScoreInput {
  value: number;
  l: number;
  m: number;
  s: number;
}

/** Raw LMS z-score with no tail correction. */
export function rawZ({ value, l, m, s }: ZScoreInput): number {
  if (value <= 0 || m <= 0 || s <= 0) {
    return Number.NaN;
  }
  if (l === 0) {
    return Math.log(value / m) / s;
  }
  return (Math.pow(value / m, l) - 1) / (l * s);
}

/** Inverse: given z, return the measurement value implied by L, M, S. */
export function valueAtZ(z: number, l: number, m: number, s: number): number {
  if (l === 0) {
    return m * Math.exp(s * z);
  }
  return m * Math.pow(1 + l * s * z, 1 / l);
}

/**
 * Apply the WHO disjoint regression cap. Values landing in |Z| > 3 are
 * remapped from a linear extrapolation outside ±3 SD using SD23 / SD-23,
 * which prevents extreme outliers from blowing up the z-score under the
 * Box-Cox transform.
 */
export function correctZ(input: ZScoreInput): number {
  const z = rawZ(input);
  if (Number.isNaN(z)) {
    return Number.NaN;
  }
  if (Math.abs(z) <= 3) {
    return z;
  }
  const { value, l, m, s } = input;
  if (z > 3) {
    const sd3pos = valueAtZ(3, l, m, s);
    const sd2pos = valueAtZ(2, l, m, s);
    const sd23 = sd3pos - sd2pos;
    if (sd23 <= 0) {
      return z;
    }
    return 3 + (value - sd3pos) / sd23;
  }
  // z < -3
  const sd3neg = valueAtZ(-3, l, m, s);
  const sd2neg = valueAtZ(-2, l, m, s);
  const sd23 = sd2neg - sd3neg;
  if (sd23 <= 0) {
    return z;
  }
  return -3 + (value - sd3neg) / sd23;
}

/**
 * Look up an LMS row by indicator + gender + x_value, performing linear
 * interpolation between the two adjacent rows on x. Returns null if x is
 * outside the available range for the indicator.
 */
export function lookupLms(
  rows: readonly LmsRow[],
  indicator: WhoIndicator,
  gender: Gender,
  x: number,
): { l: number; m: number; s: number } | null {
  const subset = rows
    .filter((r) => r.indicator === indicator && r.gender === gender)
    .sort((a, b) => a.xValue - b.xValue);
  if (subset.length === 0) {
    return null;
  }
  const first = subset[0];
  const last = subset[subset.length - 1];
  if (x < first.xValue || x > last.xValue) {
    return null;
  }
  for (let i = 0; i < subset.length - 1; i++) {
    const a = subset[i];
    const b = subset[i + 1];
    if (x === a.xValue) {
      return { l: a.l, m: a.m, s: a.s };
    }
    if (x === b.xValue) {
      return { l: b.l, m: b.m, s: b.s };
    }
    if (x > a.xValue && x < b.xValue) {
      const t = (x - a.xValue) / (b.xValue - a.xValue);
      return {
        l: a.l + t * (b.l - a.l),
        m: a.m + t * (b.m - a.m),
        s: a.s + t * (b.s - a.s),
      };
    }
  }
  return { l: last.l, m: last.m, s: last.s };
}

/** kg / (m^2). */
export function bmi(weightKg: number, heightCm: number): number {
  if (weightKg <= 0 || heightCm <= 0) {
    return Number.NaN;
  }
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/** Months between two dates (rounded to 4 decimal places). */
export function ageInMonths(dateOfBirth: Date, recordedAt: Date): number {
  const ms = recordedAt.getTime() - dateOfBirth.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  return Math.round((days / 30.4375) * 10000) / 10000;
}

export interface AllZScoresInput {
  weightKg: number;
  heightCm: number;
  ageMonths: number;
  gender: Gender;
  lmsRows: readonly LmsRow[];
}

export interface AllZScores {
  haz: number | null;
  waz: number | null;
  whz: number | null;
  baz: number | null;
  bmi: number;
}

/**
 * Compute HAZ, WAZ, WHZ, BAZ for a single measurement. Each value is null
 * when the measurement falls outside the available WHO age/height range
 * for that indicator.
 */
export function computeAllZScores(input: AllZScoresInput): AllZScores {
  const { weightKg, heightCm, ageMonths, gender, lmsRows } = input;
  const bmiValue = bmi(weightKg, heightCm);

  const lookup = (indicator: WhoIndicator, x: number, value: number): number | null => {
    const lms = lookupLms(lmsRows, indicator, gender, x);
    if (!lms) {
      return null;
    }
    return correctZ({ value, ...lms });
  };

  return {
    haz: lookup(WhoIndicator.HEIGHT_FOR_AGE, ageMonths, heightCm),
    waz: lookup(WhoIndicator.WEIGHT_FOR_AGE, ageMonths, weightKg),
    whz: lookup(WhoIndicator.WEIGHT_FOR_HEIGHT, heightCm, weightKg),
    baz: lookup(WhoIndicator.BMI_FOR_AGE, ageMonths, bmiValue),
    bmi: bmiValue,
  };
}

/** Z-score band helper for the table view's color coding. */
export function zScoreBand(z: number | null): 'na' | 'green' | 'yellow' | 'orange' | 'red' {
  if (z === null || Number.isNaN(z)) {
    return 'na';
  }
  const abs = Math.abs(z);
  if (abs <= 1) return 'green';
  if (abs <= 2) return 'yellow';
  if (abs <= 3) return 'orange';
  return 'red';
}
