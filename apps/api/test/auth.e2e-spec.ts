import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildTestApp } from './app-builder';

describe('Auth endpoints (e2e)', () => {
  let app: INestApplication;
  const adminEmail = `admin+${Date.now()}@example.com`;
  const adminPassword = 'changeme1234';

  beforeAll(async () => {
    process.env.SEED_ADMIN_EMAIL = adminEmail;
    process.env.SEED_ADMIN_PASSWORD = adminPassword;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/auth/config returns the active channel list (empty by default)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/config').expect(200);
    expect(res.body.data).toEqual({ channels: [] });
  });

  it('POST /api/v1/auth/password issues tokens for the seeded admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: { email: adminEmail, role: 'ADMIN' },
    });
  });

  it('POST /api/v1/auth/password rejects bad credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .send({ email: adminEmail, password: 'wrong-password' })
      .expect(401);
  });

  it('POST /api/v1/auth/otp/request fails fast when the channel is not configured', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .send({ identifier: adminEmail, channel: 'EMAIL' })
      .expect(400);
  });
});
