import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildTestApp } from './app-builder';

describe('GET /api/v1/who-standards (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns the height-for-age curve for males', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/who-standards?indicator=HEIGHT_FOR_AGE&gender=MALE')
      .expect(200);
    expect(res.body.data.indicator).toBe('HEIGHT_FOR_AGE');
    expect(res.body.data.gender).toBe('MALE');
    expect(res.body.data.rows.length).toBeGreaterThan(0);
    for (const row of res.body.data.rows) {
      expect(row).toMatchObject({
        indicator: 'HEIGHT_FOR_AGE',
        gender: 'MALE',
        xValue: expect.any(Number),
        l: expect.any(Number),
        m: expect.any(Number),
        s: expect.any(Number),
      });
    }
  });

  it('returns an empty rows array for an unknown gender combination', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/who-standards?indicator=HEIGHT_FOR_AGE&gender=UNKNOWN')
      .expect(200);
    expect(res.body.data.rows).toEqual([]);
  });
});
