import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildAppDataSourceOptions, readAppDataSourceEnv } from '@app/database';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { UsersModule } from './users/users.module';
import { PatientsModule } from './patients/patients.module';
import { ParentsModule } from './parents/parents.module';
import { MeasurementsModule } from './measurements/measurements.module';
import { WhoStandardsModule } from './who-standards/who-standards.module';
import { NotificationModule } from './notification/notification.module';
import { SeedModule } from './seed/seed.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({ global: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildAppDataSourceOptions(readAppDataSourceEnv()),
        autoLoadEntities: false,
      }),
    }),
    NotificationModule,
    AuthModule,
    UsersModule,
    PatientsModule,
    ParentsModule,
    MeasurementsModule,
    WhoStandardsModule,
    SeedModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
