import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Parent, Patient } from '@app/database';
import {
  CreatePatientDto,
  Gender,
  PatientDto,
  UpdatePatientDto,
} from '@app/shared';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient) private readonly patientRepo: Repository<Patient>,
    @InjectRepository(Parent) private readonly parentRepo: Repository<Parent>,
  ) {}

  async create(dto: CreatePatientDto): Promise<PatientDto> {
    const existing = await this.patientRepo.findOne({ where: { nationalId: dto.nationalId } });
    if (existing) {
      throw new ConflictException('A patient with that national ID already exists');
    }
    const parents = dto.parentIds?.length
      ? await this.parentRepo.find({ where: { id: In(dto.parentIds) } })
      : [];
    if ((dto.parentIds?.length ?? 0) !== parents.length) {
      throw new NotFoundException('One or more parents not found');
    }
    const patient = this.patientRepo.create({
      firstName1: dto.firstName1,
      firstName2: dto.firstName2 ?? null,
      lastName1: dto.lastName1,
      lastName2: dto.lastName2,
      dateOfBirth: dto.dateOfBirth,
      nationalId: dto.nationalId,
      gender: dto.gender,
      parents,
    });
    await this.patientRepo.save(patient);
    return this.toDto(await this.findEntityOrFail(patient.id));
  }

  async list(filter: { parentUserId?: string } = {}): Promise<PatientDto[]> {
    const qb = this.patientRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.parents', 'parent')
      .leftJoinAndSelect('parent.user', 'parentUser')
      .orderBy('p.createdAt', 'DESC');
    if (filter.parentUserId) {
      qb.where('parentUser.id = :parentUserId', { parentUserId: filter.parentUserId });
    }
    const all = await qb.getMany();
    return all.map((p) => this.toDto(p));
  }

  async findById(id: string): Promise<PatientDto> {
    return this.toDto(await this.findEntityOrFail(id));
  }

  async update(id: string, dto: UpdatePatientDto): Promise<PatientDto> {
    const patient = await this.findEntityOrFail(id);
    Object.assign(patient, dto);
    await this.patientRepo.save(patient);
    return this.toDto(await this.findEntityOrFail(id));
  }

  async assignParents(id: string, parentIds: string[]): Promise<PatientDto> {
    const patient = await this.findEntityOrFail(id);
    const parents = parentIds.length
      ? await this.parentRepo.find({ where: { id: In(parentIds) } })
      : [];
    if (parents.length !== parentIds.length) {
      throw new NotFoundException('One or more parents not found');
    }
    patient.parents = parents;
    await this.patientRepo.save(patient);
    return this.toDto(await this.findEntityOrFail(id));
  }

  /** Returns true if the user (PARENT role) is linked to the patient. */
  async parentUserCanAccess(patientId: string, userId: string): Promise<boolean> {
    const count = await this.patientRepo
      .createQueryBuilder('p')
      .leftJoin('p.parents', 'parent')
      .leftJoin('parent.user', 'parentUser')
      .where('p.id = :patientId', { patientId })
      .andWhere('parentUser.id = :userId', { userId })
      .getCount();
    return count > 0;
  }

  private async findEntityOrFail(id: string): Promise<Patient> {
    const patient = await this.patientRepo.findOne({
      where: { id },
      relations: { parents: true },
    });
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  toDto(p: Patient): PatientDto {
    return {
      id: p.id,
      firstName1: p.firstName1,
      firstName2: p.firstName2,
      lastName1: p.lastName1,
      lastName2: p.lastName2,
      fullName: [p.firstName1, p.firstName2, p.lastName1, p.lastName2]
        .filter(Boolean)
        .join(' '),
      dateOfBirth: p.dateOfBirth,
      nationalId: p.nationalId,
      gender: p.gender as Gender,
      userId: p.userId,
      parentIds: (p.parents ?? []).map((parent) => parent.id),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
