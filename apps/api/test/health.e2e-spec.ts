import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildTestApp } from './app-builder';

describe('GET /api/v1/health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns ok with database + lmsData checks when both are healthy', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.data).toMatchObject({
      status: 'ok',
      checks: {
        database: { ok: true },
        lmsData: { ok: true },
      },
    });
    expect(res.body.data.checks.lmsData.rowsLoaded).toBeGreaterThan(0);
    expect(typeof res.body.data.uptimeSec).toBe('number');
  });
});
