import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Measurement, Patient, User } from '@app/database';
import {
  CreateMeasurementDto,
  Gender,
  MeasurementDto,
  UserRole,
  ageInMonths,
  computeAllZScores,
} from '@app/shared';
import { WhoStandardsService } from '../who-standards/who-standards.service';

@Injectable()
export class MeasurementsService {
  constructor(
    @InjectRepository(Measurement) private readonly repo: Repository<Measurement>,
    @InjectRepository(Patient) private readonly patientRepo: Repository<Patient>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly who: WhoStandardsService,
  ) {}

  async create(
    patientId: string,
    recordedById: string,
    dto: CreateMeasurementDto,
  ): Promise<MeasurementDto> {
    const patient = await this.patientRepo.findOne({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');
    const recorder = await this.userRepo.findOne({ where: { id: recordedById } });
    if (!recorder) throw new NotFoundException('Recording user not found');
    if (recorder.role !== UserRole.DOCTOR && recorder.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only DOCTOR or ADMIN can record measurements');
    }
    const dob = new Date(patient.dateOfBirth);
    const recordedAt = new Date(dto.recordedAt);
    const ageMonths = ageInMonths(dob, recordedAt);

    const measurement = this.repo.create({
      patientId,
      recordedById,
      recordedAt: dto.recordedAt.slice(0, 10),
      ageMonths: String(ageMonths),
      weightKg: String(dto.weightKg),
      heightCm: String(dto.heightCm),
      notes: dto.notes ?? null,
    });
    await this.repo.save(measurement);
    return this.toDto(measurement, patient.gender as Gender);
  }

  async listForPatient(patientId: string): Promise<MeasurementDto[]> {
    const patient = await this.patientRepo.findOne({ where: { id: patientId } });
    if (!patient) throw new NotFoundException('Patient not found');
    const all = await this.repo.find({
      where: { patientId },
      order: { recordedAt: 'ASC' },
    });
    return all.map((m) => this.toDto(m, patient.gender as Gender));
  }

  private toDto(m: Measurement, gender: Gender): MeasurementDto {
    const ageMonths = Number(m.ageMonths);
    const weightKg = Number(m.weightKg);
    const heightCm = Number(m.heightCm);
    const lmsRows = this.who.getAllForGender(gender);
    const z = computeAllZScores({ weightKg, heightCm, ageMonths, gender, lmsRows });
    return {
      id: m.id,
      patientId: m.patientId,
      recordedById: m.recordedById,
      recordedAt: m.recordedAt,
      ageMonths,
      weightKg,
      heightCm,
      bmi: z.bmi,
      notes: m.notes,
      zScores: { haz: z.haz, waz: z.waz, whz: z.whz, baz: z.baz },
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
}
