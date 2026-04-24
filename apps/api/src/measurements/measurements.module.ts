import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Measurement, Patient, User } from '@app/database';
import { MeasurementsController } from './measurements.controller';
import { MeasurementsService } from './measurements.service';
import { WhoStandardsModule } from '../who-standards/who-standards.module';
import { PatientsModule } from '../patients/patients.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Measurement, Patient, User]),
    WhoStandardsModule,
    PatientsModule,
  ],
  controllers: [MeasurementsController],
  providers: [MeasurementsService],
  exports: [MeasurementsService],
})
export class MeasurementsModule {}
