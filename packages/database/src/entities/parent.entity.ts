import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToMany,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ParentContact } from './parent-contact.entity';
import { Patient } from './patient.entity';
import { User } from './user.entity';

@Entity({ name: 'parents' })
export class Parent {
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

  @Index('uq_parents_national_id', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  nationalId!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @OneToOne(() => User, (u) => u.parent, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User | null;

  @ManyToMany(() => Patient, (p) => p.parents)
  patients?: Patient[];

  @OneToMany(() => ParentContact, (c) => c.parent, { cascade: ['insert', 'update'] })
  contacts?: ParentContact[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
