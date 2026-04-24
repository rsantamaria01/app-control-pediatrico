import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ContactType } from '@app/shared';
import { Parent } from './parent.entity';

@Entity({ name: 'parent_contacts' })
@Index('idx_parent_contacts_parent', ['parentId'])
export class ParentContact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  parentId!: string;

  @ManyToOne(() => Parent, (p) => p.contacts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parentId' })
  parent?: Parent;

  @Column({ type: 'varchar', length: 8 })
  type!: ContactType;

  @Column({ type: 'varchar', length: 320 })
  value!: string;

  @Column({ type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({ type: 'boolean', default: false })
  isPrimary!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
