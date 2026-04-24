import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreatePatientDto,
  PatientDto,
  UpdatePatientDto,
  UserRole,
} from '@app/shared';
import { PatientsService } from './patients.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.PATIENT)
  list(@CurrentUser() user: AuthPrincipal): Promise<PatientDto[]> {
    if (user.role === UserRole.PATIENT) {
      return this.patients.list({ parentUserId: user.id });
    }
    return this.patients.list();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  create(@Body() dto: CreatePatientDto): Promise<PatientDto> {
    return this.patients.create(dto);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.PATIENT)
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: AuthPrincipal,
  ): Promise<PatientDto> {
    if (user.role === UserRole.PATIENT) {
      const ok = await this.patients.parentUserCanAccess(id, user.id);
      if (!ok) {
        throw new ForbiddenException('Patient not linked to this account');
      }
    }
    return this.patients.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto): Promise<PatientDto> {
    return this.patients.update(id, dto);
  }

  @Post(':id/parents')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  assignParents(
    @Param('id') id: string,
    @Body() body: { parentIds: string[] },
  ): Promise<PatientDto> {
    return this.patients.assignParents(id, body.parentIds);
  }
}
