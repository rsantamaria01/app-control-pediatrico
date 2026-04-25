import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildTestApp } from './app-builder';

/**
 * Walks the doctor flow end-to-end:
 *   admin login → create doctor → doctor login → create patient →
 *   record measurement → assert that the API computes Z-scores and
 *   returns them inline.
 */
describe('Measurements flow (e2e)', () => {
  let app: INestApplication;
  const adminEmail = `admin+${Date.now()}@example.com`;
  const adminPassword = 'changeme1234';
  const doctorEmail = `doctor+${Date.now()}@example.com`;
  const doctorPassword = 'doctor-pass-1';

  let adminToken: string;
  let doctorToken: string;
  let patientId: string;

  beforeAll(async () => {
    process.env.SEED_ADMIN_EMAIL = adminEmail;
    process.env.SEED_ADMIN_PASSWORD = adminPassword;
    app = await buildTestApp();

    const loginAdmin = await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = loginAdmin.body.data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('admin creates a doctor user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: doctorEmail,
        password: doctorPassword,
        role: 'DOCTOR',
      })
      .expect(201);
    expect(res.body.data).toMatchObject({ email: doctorEmail, role: 'DOCTOR' });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .send({ email: doctorEmail, password: doctorPassword })
      .expect(201);
    doctorToken = login.body.data.accessToken;
    expect(doctorToken).toBeTruthy();
  });

  it('doctor creates a patient', async () => {
    const dob = new Date();
    dob.setMonth(dob.getMonth() - 9); // 9 months old
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        firstName1: 'Test',
        lastName1: 'Patient',
        lastName2: 'Demo',
        dateOfBirth: dob.toISOString().slice(0, 10),
        nationalId: `TST-${Date.now()}`,
        gender: 'MALE',
      })
      .expect(201);
    expect(res.body.data.id).toBeTruthy();
    patientId = res.body.data.id;
  });

  it('records a measurement and returns Z-scores inline', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/measurements`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        recordedAt: new Date().toISOString().slice(0, 10),
        weightKg: 9.7,
        heightCm: 71,
      })
      .expect(201);
    expect(res.body.data).toMatchObject({
      patientId,
      weightKg: 9.7,
      heightCm: 71,
    });
    expect(res.body.data.zScores).toBeDefined();
    // For a 9-month, 9.7 kg, 71 cm boy the WHO bands all sit within
    // ±3 SD; assert finite numbers rather than exact values so this
    // does not couple to the synthetic mock medians.
    expect(Number.isFinite(res.body.data.zScores.haz)).toBe(true);
    expect(Number.isFinite(res.body.data.zScores.waz)).toBe(true);
    expect(Number.isFinite(res.body.data.zScores.whz)).toBe(true);
  });

  it('lists the measurement back', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/patients/${patientId}/measurements`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects unauthenticated measurement creation', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/patients/${patientId}/measurements`)
      .send({ recordedAt: '2024-01-01', weightKg: 10, heightCm: 70 })
      .expect(401);
  });
});
