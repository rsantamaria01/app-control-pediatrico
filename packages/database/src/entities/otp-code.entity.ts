import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationChannel } from '@app/shared';
import { TS_TYPE } from './_column-types';
import { User } from './user.entity';

export enum OtpPurpose {
  LOGIN = 'LOGIN',
  CONTACT_VERIFICATION = 'CONTACT_VERIFICATION',
}

@Entity({ name: 'otp_codes' })
@Index('idx_otp_user_purpose', ['userId', 'purpose'])
export class OtpCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, (u) => u.otpCodes, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User | null;

  /** When the OTP targets a parent contact (for verification). */
  @Column({ type: 'uuid', nullable: true })
  parentContactId!: string | null;

  /** Argon2 hash of the OTP code (never plaintext). */
  @Column({ type: 'varchar', length: 255 })
  codeHash!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: NotificationChannel;

  @Column({ type: 'varchar', length: 32, default: OtpPurpose.LOGIN })
  purpose!: OtpPurpose;

  @Column({ type: TS_TYPE })
  expiresAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
