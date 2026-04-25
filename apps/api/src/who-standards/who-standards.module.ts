import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhoLmsStandard } from '@app/database';
import { WhoStandardsController } from './who-standards.controller';
import { WhoStandardsService } from './who-standards.service';

@Module({
  imports: [TypeOrmModule.forFeature([WhoLmsStandard], 'who')],
  controllers: [WhoStandardsController],
  providers: [WhoStandardsService],
  exports: [WhoStandardsService],
})
export class WhoStandardsModule {}
