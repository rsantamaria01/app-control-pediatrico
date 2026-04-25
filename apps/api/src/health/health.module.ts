import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { WhoStandardsModule } from '../who-standards/who-standards.module';

@Module({
  imports: [WhoStandardsModule],
  controllers: [HealthController],
})
export class HealthModule {}
