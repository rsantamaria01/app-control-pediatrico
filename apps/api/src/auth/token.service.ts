import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RefreshToken, User } from '@app/database';
import { UserRole } from '@app/shared';
import * as argon2 from 'argon2';

const REFRESH_TTL_DAYS = 7;

interface AccessPayload {
  sub: string;
  role: UserRole;
  email: string | null;
  phone: string | null;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  private accessSecret(): string {
    return process.env.JWT_SECRET ?? 'change-me-access-secret';
  }

  private refreshSecret(): string {
    return process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh-secret';
  }

  private accessExpiry(): string {
    return process.env.JWT_EXPIRY ?? '15m';
  }

  private refreshExpiry(): string {
    return process.env.JWT_REFRESH_EXPIRY ?? `${REFRESH_TTL_DAYS}d`;
  }

  signAccess(user: Pick<User, 'id' | 'role' | 'email' | 'phone'>): { token: string; expiresInSec: number } {
    const payload: AccessPayload = {
      sub: user.id,
      role: user.role,
      email: user.email,
      phone: user.phone,
    };
    const token = this.jwt.sign(payload, {
      secret: this.accessSecret(),
      expiresIn: this.accessExpiry(),
    });
    const decoded = this.jwt.decode(token) as { exp: number; iat: number } | null;
    const expiresInSec = decoded ? decoded.exp - decoded.iat : 15 * 60;
    return { token, expiresInSec };
  }

  async issueRefresh(userId: string, replacedById: string | null = null): Promise<string> {
    const jti = `${userId}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const token = this.jwt.sign(
      { sub: userId, jti },
      { secret: this.refreshSecret(), expiresIn: this.refreshExpiry() },
    );
    const tokenHash = await argon2.hash(token);
    const decoded = this.jwt.decode(token) as { exp: number } | null;
    const expiresAt = decoded ? new Date(decoded.exp * 1000) : new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);
    await this.refreshRepo.save(
      this.refreshRepo.create({
        userId,
        tokenHash,
        expiresAt,
        revokedAt: null,
        replacedById,
      }),
    );
    return token;
  }

  async rotateRefresh(refreshToken: string): Promise<{ userId: string; newToken: string }> {
    let payload: { sub: string; jti: string } | null = null;
    try {
      payload = this.jwt.verify(refreshToken, { secret: this.refreshSecret() }) as {
        sub: string;
        jti: string;
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const userId = payload.sub;
    const tokens = await this.refreshRepo.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    let matched: RefreshToken | null = null;
    for (const t of tokens) {
      if (await argon2.verify(t.tokenHash, refreshToken)) {
        matched = t;
        break;
      }
    }
    if (!matched) {
      throw new UnauthorizedException('Refresh token not recognised');
    }
    if (matched.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    matched.revokedAt = new Date();
    await this.refreshRepo.save(matched);
    const newToken = await this.issueRefresh(userId, matched.id);
    return { userId, newToken };
  }

  async revoke(refreshToken: string): Promise<void> {
    let payload: { sub: string } | null = null;
    try {
      payload = this.jwt.decode(refreshToken) as { sub: string } | null;
    } catch {
      return;
    }
    if (!payload?.sub) return;
    const tokens = await this.refreshRepo.find({
      where: { userId: payload.sub, revokedAt: IsNull() },
    });
    for (const t of tokens) {
      if (await argon2.verify(t.tokenHash, refreshToken)) {
        t.revokedAt = new Date();
        await this.refreshRepo.save(t);
        break;
      }
    }
  }
}
