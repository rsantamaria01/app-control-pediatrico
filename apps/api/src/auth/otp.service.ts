import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { OtpCode, OtpPurpose } from '@app/database';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';

@Injectable()
export class OtpService {
  private readonly otpLength: number;
  private readonly ttlMinutes: number;

  constructor(
    @InjectRepository(OtpCode)
    private readonly otpRepo: Repository<OtpCode>,
  ) {
    this.otpLength = Math.max(4, Math.min(10, Number(process.env.OTP_LENGTH ?? 6)));
    this.ttlMinutes = Math.max(1, Number(process.env.OTP_TTL_MINUTES ?? 10));
  }

  generateCode(): string {
    const min = Math.pow(10, this.otpLength - 1);
    const max = Math.pow(10, this.otpLength);
    return String(randomInt(min, max));
  }

  async issue(args: {
    userId: string | null;
    parentContactId: string | null;
    channel: string;
    purpose: OtpPurpose;
  }): Promise<{ code: string; otp: OtpCode }> {
    const code = this.generateCode();
    const codeHash = await argon2.hash(code);
    const now = new Date();
    const otp = this.otpRepo.create({
      userId: args.userId,
      parentContactId: args.parentContactId,
      channel: args.channel as OtpCode['channel'],
      purpose: args.purpose,
      codeHash,
      expiresAt: new Date(now.getTime() + this.ttlMinutes * 60 * 1000),
      usedAt: null,
    });
    await this.otpRepo.save(otp);
    return { code, otp };
  }

  async verify(args: {
    userId?: string;
    parentContactId?: string;
    code: string;
    purpose: OtpPurpose;
  }): Promise<OtpCode> {
    const candidates = await this.otpRepo.find({
      where: {
        ...(args.userId ? { userId: args.userId } : {}),
        ...(args.parentContactId ? { parentContactId: args.parentContactId } : {}),
        purpose: args.purpose,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
      take: 5,
    });
    for (const c of candidates) {
      if (c.usedAt) continue;
      const ok = await argon2.verify(c.codeHash, args.code);
      if (ok) {
        c.usedAt = new Date();
        await this.otpRepo.save(c);
        return c;
      }
    }
    throw new BadRequestException('Invalid or expired code');
  }

  async cleanupExpired(): Promise<void> {
    await this.otpRepo.delete({ expiresAt: LessThan(new Date()) });
  }
}
