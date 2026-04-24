import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@app/database';
import { UserRole } from '@app/shared';
import * as argon2 from 'argon2';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
})
export class SeedModule implements OnModuleInit {
  private readonly logger = new Logger(SeedModule.name);
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit(): Promise<void> {
    const seedEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
    const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? 'changeme1234';
    const existing = await this.userRepo.findOne({ where: { email: seedEmail } });
    if (existing) {
      return;
    }
    const passwordHash = await argon2.hash(seedPassword);
    await this.userRepo.save(
      this.userRepo.create({
        email: seedEmail,
        phone: null,
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
      }),
    );
    this.logger.log(`Seeded ADMIN user: ${seedEmail} (password: ${seedPassword})`);
  }
}
