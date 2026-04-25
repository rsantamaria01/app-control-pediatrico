import 'reflect-metadata';
import { resolve } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Build a Nest application configured the same way `main.ts` does,
 * minus listening on a TCP port. supertest can drive the underlying
 * http server directly.
 */
export async function buildTestApp(): Promise<INestApplication> {
  // Make sure the LMS data directory points at the committed CSVs so
  // the WhoStandardsService has data even when tests run from a
  // different CWD.
  process.env.LMS_DATA_DIR = resolve(__dirname, '..', '..', '..', 'data', 'lms');
  process.env.JWT_SECRET ??= 'test-access';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}
