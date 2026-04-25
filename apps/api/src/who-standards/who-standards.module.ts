import { Module } from '@nestjs/common';
import { WhoStandardsController } from './who-standards.controller';
import { WhoStandardsService } from './who-standards.service';

@Module({
  controllers: [WhoStandardsController],
  providers: [WhoStandardsService],
  exports: [WhoStandardsService],
})
export class WhoStandardsModule {}
