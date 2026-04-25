import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpCode, ParentContact, RefreshToken, User } from '@app/database';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, OtpCode, RefreshToken, ParentContact]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, TokenService, OtpService, JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
