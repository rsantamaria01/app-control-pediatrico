import { describe, expect, it } from 'vitest';
import {
  bmi,
  computeAllZScores,
  correctZ,
  rawZ,
  valueAtZ,
  zScoreBand,
} from './zscore';
import { Gender, WhoIndicator } from './enums';
import type { LmsRow } from './zscore';

describe('rawZ', () => {
  it('returns 0 when value equals the median', () => {
    expect(rawZ({ value: 10, l: 1, m: 10, s: 0.1 })).toBeCloseTo(0, 10);
  });

  it('uses logarithmic form when L = 0', () => {
    const z = rawZ({ value: 11, l: 0, m: 10, s: 0.1 });
    expect(z).toBeCloseTo(Math.log(1.1) / 0.1, 6);
  });

  it('uses Box-Cox form when L != 0', () => {
    const z = rawZ({ value: 11, l: 1, m: 10, s: 0.1 });
    expect(z).toBeCloseTo((11 / 10 - 1) / 0.1, 10);
  });
});

describe('valueAtZ', () => {
  it('round-trips with rawZ', () => {
    const lms = { l: -0.3521, m: 17.8, s: 0.085 };
    for (const z of [-3, -2, -1, 0, 1, 2, 3]) {
      const v = valueAtZ(z, lms.l, lms.m, lms.s);
      expect(rawZ({ value: v, ...lms })).toBeCloseTo(z, 8);
    }
  });
});

describe('correctZ disjoint cap', () => {
  it('matches rawZ when |z| <= 3', () => {
    const lms = { l: 1, m: 10, s: 0.05 };
    const value = valueAtZ(2.5, lms.l, lms.m, lms.s);
    expect(correctZ({ value, ...lms })).toBeCloseTo(rawZ({ value, ...lms }), 8);
  });

  it('linearises beyond +3 SD using SD23', () => {
    const lms = { l: -0.3, m: 18, s: 0.08 };
    const sd3 = valueAtZ(3, lms.l, lms.m, lms.s);
    const sd2 = valueAtZ(2, lms.l, lms.m, lms.s);
    const sd23 = sd3 - sd2;
    const valueWayAbove = sd3 + 2 * sd23;
    expect(correctZ({ value: valueWayAbove, ...lms })).toBeCloseTo(5, 6);
  });

  it('linearises below -3 SD', () => {
    const lms = { l: -0.3, m: 18, s: 0.08 };
    const sd3neg = valueAtZ(-3, lms.l, lms.m, lms.s);
    const sd2neg = valueAtZ(-2, lms.l, lms.m, lms.s);
    const sd23 = sd2neg - sd3neg;
    const valueWayBelow = sd3neg - 1.5 * sd23;
    expect(correctZ({ value: valueWayBelow, ...lms })).toBeCloseTo(-4.5, 6);
  });
});

describe('bmi', () => {
  it('computes weight (kg) / height (m)^2', () => {
    expect(bmi(15, 100)).toBeCloseTo(15.0, 6);
    expect(bmi(70, 175)).toBeCloseTo(22.857, 3);
  });

  it('returns NaN on invalid input', () => {
    expect(bmi(0, 100)).toBeNaN();
    expect(bmi(15, 0)).toBeNaN();
  });
});

describe('zScoreBand', () => {
  it('bands by absolute z', () => {
    expect(zScoreBand(0)).toBe('green');
    expect(zScoreBand(1)).toBe('green');
    expect(zScoreBand(-1.5)).toBe('yellow');
    expect(zScoreBand(2.5)).toBe('orange');
    expect(zScoreBand(-3.5)).toBe('red');
    expect(zScoreBand(null)).toBe('na');
  });
});

describe('computeAllZScores', () => {
  const lmsRows: LmsRow[] = [
    {
      indicator: WhoIndicator.HEIGHT_FOR_AGE,
      gender: Gender.MALE,
      xValue: 12,
      l: 1,
      m: 75.7,
      s: 0.04,
    },
    {
      indicator: WhoIndicator.WEIGHT_FOR_AGE,
      gender: Gender.MALE,
      xValue: 12,
      l: 0.2,
      m: 9.6,
      s: 0.13,
    },
    {
      indicator: WhoIndicator.WEIGHT_FOR_HEIGHT,
      gender: Gender.MALE,
      xValue: 76,
      l: -0.35,
      m: 9.8,
      s: 0.08,
    },
    {
      indicator: WhoIndicator.BMI_FOR_AGE,
      gender: Gender.MALE,
      xValue: 12,
      l: -0.3,
      m: 16.8,
      s: 0.085,
    },
  ];

  it('returns all four z-scores when LMS rows are present', () => {
    const z = computeAllZScores({
      weightKg: 9.6,
      heightCm: 75.7,
      ageMonths: 12,
      gender: Gender.MALE,
      lmsRows,
    });
    expect(z.haz).toBeCloseTo(0, 6);
    expect(z.waz).toBeCloseTo(0, 6);
    expect(z.bmi).toBeCloseTo(9.6 / 0.757 / 0.757, 3);
  });

  it('returns null for indicators outside their range', () => {
    const z = computeAllZScores({
      weightKg: 70,
      heightCm: 130,
      ageMonths: 240, // beyond WFA range and WFH x range
      gender: Gender.MALE,
      lmsRows,
    });
    expect(z.haz).toBeNull();
    expect(z.waz).toBeNull();
    // WHZ x = heightCm = 130, only point is xValue=76, so out of range
    expect(z.whz).toBeNull();
    expect(z.baz).toBeNull();
  });
});
