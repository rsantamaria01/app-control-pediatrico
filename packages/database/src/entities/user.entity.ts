import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '@app/shared';
import { Parent } from './parent.entity';
import { Patient } from './patient.entity';
import { OtpCode } from './otp-code.entity';
import { RefreshToken } from './refresh-token.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_users_email', { unique: true })
  @Column({ type: 'varchar', length: 320, nullable: true })
  email!: string | null;

  @Index('uq_users_phone', { unique: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'varchar', length: 16 })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => OtpCode, (otp) => otp.user)
  otpCodes?: OtpCode[];

  @OneToMany(() => RefreshToken, (token) => token.user)
  refreshTokens?: RefreshToken[];

  @OneToOne(() => Patient, (p) => p.user)
  patient?: Patient | null;

  @OneToOne(() => Parent, (p) => p.user)
  parent?: Parent | null;
}
