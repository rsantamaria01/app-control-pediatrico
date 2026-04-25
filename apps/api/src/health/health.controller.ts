import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Gender } from '@app/shared';
import { Public } from '../common/decorators/public.decorator';
import { WhoStandardsService } from '../who-standards/who-standards.service';

interface HealthDto {
  status: 'ok' | 'degraded';
  uptimeSec: number;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    lmsData: { ok: boolean; rowsLoaded: number };
  };
}

/**
 * Liveness/readiness endpoint. Designed to be polled by Uptime Kuma,
 * docker-compose healthchecks, and load-balancer probes:
 *
 *   - 200 OK with status="ok" when both Postgres and the LMS data are
 *     reachable.
 *   - 503 with status="degraded" when any check fails.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly who: WhoStandardsService,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async health(): Promise<HealthDto> {
    const dbCheck = await this.checkDatabase();
    const lmsCount =
      this.who.getAllForGender(Gender.MALE).length +
      this.who.getAllForGender(Gender.FEMALE).length;
    const lmsCheck = { ok: lmsCount > 0, rowsLoaded: lmsCount };

    const status: HealthDto['status'] = dbCheck.ok && lmsCheck.ok ? 'ok' : 'degraded';
    const body: HealthDto = {
      status,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { database: dbCheck, lmsData: lmsCheck },
    };
    if (status !== 'ok') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async checkDatabase(): Promise<HealthDto['checks']['database']> {
    const start = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
