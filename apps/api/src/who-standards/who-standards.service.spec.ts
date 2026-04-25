import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Gender, WhoIndicator } from '@app/shared';
import { WhoStandardsService } from './who-standards.service';

describe('WhoStandardsService', () => {
  let tmp: string;
  let service: WhoStandardsService;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'who-svc-'));
    writeFileSync(
      join(tmp, 'w_a_0_240.csv'),
      [
        'Sex,X,L,M,S',
        '1,0,0.20,3.30,0.13',
        '1,12,0.20,9.60,0.13',
        '1,24,0.20,12.20,0.13',
        '2,0,0.20,3.20,0.135',
        '2,12,0.20,8.90,0.135',
      ].join('\n'),
    );
    process.env.LMS_DATA_DIR = tmp;
    service = new WhoStandardsService();
    service.onModuleInit();
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the curve for the requested indicator + gender, sorted by x', () => {
    const curve = service.getCurve(WhoIndicator.WEIGHT_FOR_AGE, Gender.MALE);
    expect(curve.indicator).toBe(WhoIndicator.WEIGHT_FOR_AGE);
    expect(curve.gender).toBe(Gender.MALE);
    expect(curve.rows.map((r) => r.xValue)).toEqual([0, 12, 24]);
  });

  it('returns an empty curve when no rows match', () => {
    const curve = service.getCurve(WhoIndicator.BMI_FOR_AGE, Gender.MALE);
    expect(curve.rows).toEqual([]);
  });

  it('returns all rows for one gender for the z-score path', () => {
    const male = service.getAllForGender(Gender.MALE);
    const female = service.getAllForGender(Gender.FEMALE);
    expect(male.length).toBe(3);
    expect(female.length).toBe(2);
    expect(male.every((r) => r.gender === Gender.MALE)).toBe(true);
  });
});
