import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Patient } from './patient.entity';
import { User } from './user.entity';

@Entity({ name: 'measurements' })
@Index('idx_measurements_patient_date', ['patientId', 'recordedAt'])
export class Measurement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @ManyToOne(() => Patient, (p) => p.measurements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patientId' })
  patient?: Patient;

  @Column({ type: 'uuid' })
  recordedById!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recordedById' })
  recordedBy?: User;

  @Column({ type: 'date' })
  recordedAt!: string;

  @Column({ type: 'numeric', precision: 7, scale: 4 })
  ageMonths!: string;

  @Column({ type: 'numeric', precision: 6, scale: 3 })
  weightKg!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2 })
  heightCm!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
