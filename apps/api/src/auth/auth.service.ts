import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OtpPurpose, ParentContact, User } from '@app/database';
import {
  AuthTokensDto,
  AuthUserDto,
  ContactType,
  NotificationChannel,
  UserRole,
} from '@app/shared';
import * as argon2 from 'argon2';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ParentContact) private readonly contactRepo: Repository<ParentContact>,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationService,
  ) {}

  async requestLoginOtp(identifier: string, channel: NotificationChannel): Promise<void> {
    if (!this.notifications.hasChannel(channel)) {
      throw new BadRequestException(`Channel ${channel} is not enabled on this server`);
    }
    const user = await this.findUserByIdentifier(identifier);
    if (!user) {
      // Reveal nothing about existence; succeed silently.
      return;
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }
    const { code } = await this.otp.issue({
      userId: user.id,
      parentContactId: null,
      channel,
      purpose: OtpPurpose.LOGIN,
    });
    const dest = channel === NotificationChannel.EMAIL ? user.email : user.phone;
    if (!dest) {
      throw new BadRequestException(`User has no ${channel} contact on file`);
    }
    await this.notifications.dispatch(
      channel,
      dest,
      `Your login code is ${code}. It expires in 10 minutes.`,
      'Pediatric Growth login code',
    );
  }

  async verifyLoginOtp(identifier: string, code: string): Promise<AuthTokensDto> {
    const user = await this.findUserByIdentifier(identifier);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.otp.verify({ userId: user.id, code, purpose: OtpPurpose.LOGIN });
    return this.issueTokens(user);
  }

  async passwordLogin(email: string, password: string): Promise<AuthTokensDto> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokensDto> {
    const { userId, newToken } = await this.tokens.rotateRefresh(refreshToken);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User unavailable');
    }
    const access = this.tokens.signAccess(user);
    return {
      accessToken: access.token,
      refreshToken: newToken,
      expiresInSec: access.expiresInSec,
      user: this.toAuthUser(user),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }

  async requestContactVerification(contactId: string): Promise<void> {
    const contact = await this.contactRepo.findOne({ where: { id: contactId } });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    const channel =
      contact.type === ContactType.EMAIL
        ? NotificationChannel.EMAIL
        : NotificationChannel.SMS;
    if (!this.notifications.hasChannel(channel)) {
      throw new BadRequestException(`Channel ${channel} is not enabled on this server`);
    }
    const { code } = await this.otp.issue({
      userId: null,
      parentContactId: contact.id,
      channel,
      purpose: OtpPurpose.CONTACT_VERIFICATION,
    });
    await this.notifications.dispatch(
      channel,
      contact.value,
      `Your verification code is ${code}.`,
      'Verify your contact',
    );
  }

  async confirmContactVerification(contactId: string, code: string): Promise<void> {
    const contact = await this.contactRepo.findOne({ where: { id: contactId } });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    await this.otp.verify({
      parentContactId: contactId,
      code,
      purpose: OtpPurpose.CONTACT_VERIFICATION,
    });
    contact.isVerified = true;
    await this.contactRepo.save(contact);
  }

  private async findUserByIdentifier(identifier: string): Promise<User | null> {
    const isEmail = /@/.test(identifier);
    return this.userRepo.findOne({
      where: isEmail ? { email: identifier } : { phone: identifier },
    });
  }

  private async issueTokens(user: User): Promise<AuthTokensDto> {
    const access = this.tokens.signAccess(user);
    const refresh = await this.tokens.issueRefresh(user.id, null);
    return {
      accessToken: access.token,
      refreshToken: refresh,
      expiresInSec: access.expiresInSec,
      user: this.toAuthUser(user),
    };
  }

  private toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role as UserRole,
    };
  }
}
