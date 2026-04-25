import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Parent, ParentContact } from '@app/database';
import {
  ContactType,
  CreateParentContactDto,
  CreateParentDto,
  NotificationChannel,
  ParentContactDto,
  ParentDto,
  UpdateParentDto,
} from '@app/shared';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ParentsService {
  constructor(
    @InjectRepository(Parent) private readonly parentRepo: Repository<Parent>,
    @InjectRepository(ParentContact)
    private readonly contactRepo: Repository<ParentContact>,
    private readonly notifications: NotificationService,
  ) {}

  async create(dto: CreateParentDto): Promise<ParentDto> {
    const existing = await this.parentRepo.findOne({ where: { nationalId: dto.nationalId } });
    if (existing) {
      throw new ConflictException('A parent with that national ID already exists');
    }
    const parent = this.parentRepo.create({
      firstName1: dto.firstName1,
      firstName2: dto.firstName2 ?? null,
      lastName1: dto.lastName1,
      lastName2: dto.lastName2,
      nationalId: dto.nationalId,
    });
    await this.parentRepo.save(parent);
    return this.toDto(await this.findEntityOrFail(parent.id));
  }

  async list(): Promise<ParentDto[]> {
    const all = await this.parentRepo.find({
      relations: { contacts: true },
      order: { createdAt: 'DESC' },
    });
    return all.map((p) => this.toDto(p));
  }

  async findById(id: string): Promise<ParentDto> {
    return this.toDto(await this.findEntityOrFail(id));
  }

  async update(id: string, dto: UpdateParentDto): Promise<ParentDto> {
    const parent = await this.findEntityOrFail(id);
    if (dto.firstName1 !== undefined) parent.firstName1 = dto.firstName1;
    if (dto.firstName2 !== undefined) parent.firstName2 = dto.firstName2;
    if (dto.lastName1 !== undefined) parent.lastName1 = dto.lastName1;
    if (dto.lastName2 !== undefined) parent.lastName2 = dto.lastName2;
    if (dto.nationalId !== undefined) parent.nationalId = dto.nationalId;
    await this.parentRepo.save(parent);
    return this.toDto(await this.findEntityOrFail(id));
  }

  async addContact(parentId: string, dto: CreateParentContactDto): Promise<ParentContactDto> {
    await this.findEntityOrFail(parentId);
    if (dto.isPrimary) {
      await this.contactRepo.update({ parentId }, { isPrimary: false });
    }
    // When the matching notification channel is not configured (no
    // SMTP / SMS provider) the doctor or admin is asserting contact
    // ownership at registration time — there is no way to send a code,
    // so mark the contact verified up front.
    const channel =
      dto.type === ContactType.EMAIL ? NotificationChannel.EMAIL : NotificationChannel.SMS;
    const isVerified = !this.notifications.hasChannel(channel);
    const contact = this.contactRepo.create({
      parentId,
      type: dto.type,
      value: dto.value,
      isPrimary: dto.isPrimary ?? false,
      isVerified,
    });
    await this.contactRepo.save(contact);
    return this.toContactDto(contact);
  }

  async listContacts(parentId: string): Promise<ParentContactDto[]> {
    const all = await this.contactRepo.find({ where: { parentId } });
    return all.map((c) => this.toContactDto(c));
  }

  private async findEntityOrFail(id: string): Promise<Parent> {
    const parent = await this.parentRepo.findOne({
      where: { id },
      relations: { contacts: true, patients: true },
    });
    if (!parent) throw new NotFoundException('Parent not found');
    return parent;
  }

  private toDto(p: Parent): ParentDto {
    return {
      id: p.id,
      firstName1: p.firstName1,
      firstName2: p.firstName2,
      lastName1: p.lastName1,
      lastName2: p.lastName2,
      fullName: [p.firstName1, p.firstName2, p.lastName1, p.lastName2]
        .filter(Boolean)
        .join(' '),
      nationalId: p.nationalId,
      userId: p.userId,
      contacts: (p.contacts ?? []).map((c) => this.toContactDto(c)),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private toContactDto(c: ParentContact): ParentContactDto {
    return {
      id: c.id,
      type: c.type as ContactType,
      value: c.value,
      isVerified: c.isVerified,
      isPrimary: c.isPrimary,
    };
  }
}
