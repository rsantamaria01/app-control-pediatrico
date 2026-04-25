import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@app/database';
import { CreateUserDto, UpdateUserDto, UserDto, UserRole } from '@app/shared';
import * as argon2 from 'argon2';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<UserDto> {
    const existing = await this.repo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('A user with that email already exists');
    }
    const passwordHash = dto.password ? await argon2.hash(dto.password) : null;
    const user = this.repo.create({
      email: dto.email,
      phone: dto.phone ?? null,
      passwordHash,
      role: dto.role,
      isActive: true,
    });
    await this.repo.save(user);
    return this.toDto(user);
  }

  async findById(id: string): Promise<UserDto> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.toDto(user);
  }

  async list(): Promise<UserDto[]> {
    const all = await this.repo.find({ order: { createdAt: 'DESC' } });
    return all.map((u) => this.toDto(u));
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDto> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    await this.repo.save(user);
    return this.toDto(user);
  }

  toDto(u: User): UserDto {
    return {
      id: u.id,
      email: u.email,
      phone: u.phone,
      role: u.role as UserRole,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }
}
