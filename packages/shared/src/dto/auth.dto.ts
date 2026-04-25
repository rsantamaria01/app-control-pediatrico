import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';
import { NotificationChannel, UserRole } from '../enums';

export class OtpRequestDto {
  /** Email address or phone number used to identify the user. */
  @IsString()
  identifier!: string;

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;
}

export class OtpVerifyDto {
  @IsString()
  identifier!: string;

  @IsString()
  @Length(4, 10)
  code!: string;
}

export class PasswordLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user: AuthUserDto;
}

export interface AuthUserDto {
  id: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
}

export class ContactVerifyRequestDto {
  @IsString()
  contactId!: string;
}

export class ContactVerifyConfirmDto {
  @IsString()
  contactId!: string;

  @IsString()
  @Length(4, 10)
  code!: string;
}

export interface AuthConfigDto {
  /** Notification channels currently configured on the server. Empty
   * array means OTP login is unavailable and only password login works. */
  channels: NotificationChannel[];
}

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
