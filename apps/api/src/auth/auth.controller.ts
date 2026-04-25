import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthConfigDto,
  AuthTokensDto,
  ContactVerifyConfirmDto,
  ContactVerifyRequestDto,
  OtpRequestDto,
  OtpVerifyDto,
  PasswordLoginDto,
  RefreshTokenDto,
} from '@app/shared';
import { AuthService } from './auth.service';
import { NotificationService } from '../notification/notification.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly notifications: NotificationService,
  ) {}

  @Public()
  @Get('config')
  config(): AuthConfigDto {
    return { channels: this.notifications.channels() };
  }

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestOtp(@Body() dto: OtpRequestDto): Promise<void> {
    await this.auth.requestLoginOtp(dto.identifier, dto.channel);
  }

  @Public()
  @Post('otp/verify')
  async verifyOtp(@Body() dto: OtpVerifyDto): Promise<AuthTokensDto> {
    return this.auth.verifyLoginOtp(dto.identifier, dto.code);
  }

  @Public()
  @Post('password')
  async password(@Body() dto: PasswordLoginDto): Promise<AuthTokensDto> {
    return this.auth.passwordLogin(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('contact/verify/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestContactVerify(@Body() dto: ContactVerifyRequestDto): Promise<void> {
    await this.auth.requestContactVerification(dto.contactId);
  }

  @Post('contact/verify/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmContactVerify(@Body() dto: ContactVerifyConfirmDto): Promise<void> {
    await this.auth.confirmContactVerification(dto.contactId, dto.code);
  }
}
