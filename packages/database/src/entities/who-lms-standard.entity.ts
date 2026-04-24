import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Gender, WhoIndicator } from '@app/shared';

/**
 * Lives in `who.db` (read-only). Schema mirrors the table written by
 * scripts/who-db.py. The `id` is INTEGER AUTOINCREMENT in the SQLite
 * file; TypeORM exposes it as a number.
 */
@Entity({ name: 'who_lms_standards' })
@Index('idx_who_lms_lookup', ['indicator', 'gender', 'xValue'])
export class WhoLmsStandard {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'indicator', type: 'varchar' })
  indicator!: WhoIndicator;

  @Column({ name: 'gender', type: 'varchar' })
  gender!: Gender;

  @Column({ name: 'x_value', type: 'real' })
  xValue!: number;

  @Column({ name: 'l', type: 'real' })
  l!: number;

  @Column({ name: 'm', type: 'real' })
  m!: number;

  @Column({ name: 's', type: 'real' })
  s!: number;
}
