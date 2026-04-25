import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TS_TYPE } from './_column-types';
import { User } from './user.entity';

@Entity({ name: 'refresh_tokens' })
@Index('idx_refresh_user', ['userId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, (u) => u.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Index('uq_refresh_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  tokenHash!: string;

  @Column({ type: TS_TYPE })
  expiresAt!: Date;

  @Column({ type: TS_TYPE, nullable: true })
  revokedAt!: Date | null;

  /** When this token was rotated, the new token's id is stored here. */
  @Column({ type: 'uuid', nullable: true })
  replacedById!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
