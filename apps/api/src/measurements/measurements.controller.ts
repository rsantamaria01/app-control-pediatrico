import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateMeasurementDto, MeasurementDto, UserRole } from '@app/shared';
import { MeasurementsService } from './measurements.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { PatientsService } from '../patients/patients.service';

@ApiTags('measurements')
@Controller('patients/:patientId/measurements')
export class MeasurementsController {
  constructor(
    private readonly measurements: MeasurementsService,
    private readonly patients: PatientsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateMeasurementDto,
    @CurrentUser() user: AuthPrincipal,
  ): Promise<MeasurementDto> {
    return this.measurements.create(patientId, user.id, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.PATIENT)
  async list(
    @Param('patientId') patientId: string,
    @CurrentUser() user: AuthPrincipal,
  ): Promise<MeasurementDto[]> {
    if (user.role === UserRole.PATIENT) {
      const ok = await this.patients.parentUserCanAccess(patientId, user.id);
      if (!ok) {
        throw new ForbiddenException('Patient not linked to this account');
      }
    }
    return this.measurements.listForPatient(patientId);
  }
}
