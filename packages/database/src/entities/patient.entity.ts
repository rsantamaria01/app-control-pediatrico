import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Gender } from '@app/shared';
import { Parent } from './parent.entity';
import { Measurement } from './measurement.entity';
import { User } from './user.entity';

@Entity({ name: 'patients' })
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  firstName1!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  firstName2!: string | null;

  @Column({ type: 'varchar', length: 64 })
  lastName1!: string;

  @Column({ type: 'varchar', length: 64 })
  lastName2!: string;

  @Column({ type: 'date' })
  dateOfBirth!: string;

  @Index('uq_patients_national_id', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  nationalId!: string;

  @Column({ type: 'varchar', length: 8 })
  gender!: Gender;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @OneToOne(() => User, (u) => u.patient, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User | null;

  @ManyToMany(() => Parent, (parent) => parent.patients)
  @JoinTable({
    name: 'patient_parents',
    joinColumn: { name: 'patientId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'parentId', referencedColumnName: 'id' },
  })
  parents?: Parent[];

  @OneToMany(() => Measurement, (m) => m.patient)
  measurements?: Measurement[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
