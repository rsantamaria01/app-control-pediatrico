import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Gender, WhoIndicator } from '@app/shared';
import { loadLmsCsvDir } from './lms-csv-loader';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'lms-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadLmsCsvDir', () => {
  it('parses a well-formed CSV and maps the prefix to the right indicator + gender', () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, 'w_a_0_240.csv'),
        [
          'Sex,X,L,M,S,P50',
          '1,0,0.20,3.30,0.13,3.30',
          '1,12,0.20,9.60,0.13,9.60',
          '2,0,0.20,3.20,0.135,3.20',
        ].join('\n'),
      );
      const result = loadLmsCsvDir(dir);
      expect(result.filesLoaded).toEqual(['w_a_0_240.csv']);
      expect(result.filesSkipped).toEqual([]);
      expect(result.rows).toHaveLength(3);
      const male0 = result.rows.find((r) => r.gender === Gender.MALE && r.xValue === 0);
      expect(male0).toMatchObject({
        indicator: WhoIndicator.WEIGHT_FOR_AGE,
        gender: Gender.MALE,
        l: 0.2,
        m: 3.3,
        s: 0.13,
      });
    });
  });

  it('maps every supported prefix to the matching enum value', () => {
    withTempDir((dir) => {
      const cases: Array<[string, WhoIndicator]> = [
        ['h_a_0_240.csv', WhoIndicator.HEIGHT_FOR_AGE],
        ['l_a_0_36.csv', WhoIndicator.HEIGHT_FOR_AGE],
        ['w_a_0_240.csv', WhoIndicator.WEIGHT_FOR_AGE],
        ['w_h_45_121.csv', WhoIndicator.WEIGHT_FOR_HEIGHT],
        ['w_l_45_121.csv', WhoIndicator.WEIGHT_FOR_HEIGHT],
        ['b_a_0_240.csv', WhoIndicator.BMI_FOR_AGE],
        ['hc_a_0_240.csv', WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE],
      ];
      for (const [name] of cases) {
        writeFileSync(
          join(dir, name),
          'Sex,X,L,M,S\n1,0,0.0,10.0,0.1\n',
        );
      }
      const result = loadLmsCsvDir(dir);
      expect(result.filesSkipped).toEqual([]);
      expect(result.rows).toHaveLength(cases.length);
      const seen = new Map(result.rows.map((r) => [r.indicator, true]));
      for (const [, expected] of cases) {
        expect(seen.get(expected)).toBe(true);
      }
    });
  });

  it('skips files with unrecognised prefixes', () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, 'xyz_q_0_10.csv'),
        'Sex,X,L,M,S\n1,0,0.0,10.0,0.1\n',
      );
      const result = loadLmsCsvDir(dir);
      expect(result.rows).toHaveLength(0);
      expect(result.filesSkipped).toEqual(['xyz_q_0_10.csv']);
    });
  });

  it('skips files missing required L/M/S columns', () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, 'w_a_0_240.csv'),
        'Sex,Agemos,L,M\n1,0,0.0,10.0\n',
      );
      const result = loadLmsCsvDir(dir);
      expect(result.rows).toHaveLength(0);
      expect(result.filesSkipped).toEqual(['w_a_0_240.csv']);
    });
  });

  it('drops rows with non-numeric values rather than throwing', () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, 'w_a_0_240.csv'),
        ['Sex,X,L,M,S', '1,0,0.20,3.30,0.13', '1,bad,0.20,3.30,0.13', '1,12,0.20,nan,0.13'].join('\n'),
      );
      const result = loadLmsCsvDir(dir);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].xValue).toBe(0);
    });
  });

  it('accepts CDC-style headers (Sex, Agemos, …)', () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, 'w_a_0_240.csv'),
        'Sex,Agemos,L,M,S\n1,12,0.20,9.60,0.13\n',
      );
      const result = loadLmsCsvDir(dir);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].xValue).toBe(12);
    });
  });

  it('parses quoted fields with embedded commas', () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, 'w_a_0_240.csv'),
        'Sex,X,L,M,S\n"1","12","0.20","9.60","0.13"\n',
      );
      const result = loadLmsCsvDir(dir);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ gender: Gender.MALE, xValue: 12, m: 9.6 });
    });
  });

  it('ignores files whose name does not match the convention', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'README.csv'), 'just a file\n');
      writeFileSync(join(dir, 'short.csv'), 'a,b\n');
      const result = loadLmsCsvDir(dir);
      expect(result.rows).toHaveLength(0);
      expect(result.filesSkipped.sort()).toEqual(['README.csv', 'short.csv']);
    });
  });
});
