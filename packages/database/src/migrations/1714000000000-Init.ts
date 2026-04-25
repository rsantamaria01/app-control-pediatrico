import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class Init1714000000000 implements MigrationInterface {
  name = 'Init1714000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPg = queryRunner.connection.options.type === 'postgres';
    const uuid = isPg ? 'uuid' : 'varchar';
    const ts = isPg ? 'timestamp with time zone' : 'datetime';
    const date = isPg ? 'date' : 'date';
    const num = (precision: number, scale: number) =>
      isPg ? `numeric(${precision},${scale})` : `numeric`;

    if (isPg) {
      await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    }

    const uuidDefault = isPg ? "gen_random_uuid()" : undefined;

    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: uuid,
            isPrimary: true,
            generationStrategy: 'uuid',
            default: uuidDefault,
            isGenerated: !isPg,
          },
          { name: 'email', type: 'varchar', length: '320', isNullable: true },
          { name: 'phone', type: 'varchar', length: '32', isNullable: true },
          { name: 'passwordHash', type: 'varchar', length: '255', isNullable: true },
          { name: 'role', type: 'varchar', length: '16' },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'users',
      new TableIndex({ name: 'uq_users_email', columnNames: ['email'], isUnique: true }),
    );
    await queryRunner.createIndex(
      'users',
      new TableIndex({ name: 'uq_users_phone', columnNames: ['phone'], isUnique: true }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'otp_codes',
        columns: [
          {
            name: 'id',
            type: uuid,
            isPrimary: true,
            generationStrategy: 'uuid',
            default: uuidDefault,
            isGenerated: !isPg,
          },
          { name: 'userId', type: uuid, isNullable: true },
          { name: 'parentContactId', type: uuid, isNullable: true },
          { name: 'codeHash', type: 'varchar', length: '255' },
          { name: 'channel', type: 'varchar', length: '16' },
          { name: 'purpose', type: 'varchar', length: '32', default: "'LOGIN'" },
          { name: 'expiresAt', type: ts },
          { name: 'usedAt', type: ts, isNullable: true },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['userId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'otp_codes',
      new TableIndex({ name: 'idx_otp_user_purpose', columnNames: ['userId', 'purpose'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'refresh_tokens',
        columns: [
          {
            name: 'id',
            type: uuid,
            isPrimary: true,
            generationStrategy: 'uuid',
            default: uuidDefault,
            isGenerated: !isPg,
          },
          { name: 'userId', type: uuid },
          { name: 'tokenHash', type: 'varchar', length: '255' },
          { name: 'expiresAt', type: ts },
          { name: 'revokedAt', type: ts, isNullable: true },
          { name: 'replacedById', type: uuid, isNullable: true },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['userId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'refresh_tokens',
      new TableIndex({ name: 'idx_refresh_user', columnNames: ['userId'] }),
    );
    await queryRunner.createIndex(
      'refresh_tokens',
      new TableIndex({ name: 'uq_refresh_token_hash', columnNames: ['tokenHash'], isUnique: true }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'patients',
        columns: [
          {
            name: 'id',
            type: uuid,
            isPrimary: true,
            generationStrategy: 'uuid',
            default: uuidDefault,
            isGenerated: !isPg,
          },
          { name: 'firstName1', type: 'varchar', length: '64' },
          { name: 'firstName2', type: 'varchar', length: '64', isNullable: true },
          { name: 'lastName1', type: 'varchar', length: '64' },
          { name: 'lastName2', type: 'varchar', length: '64' },
          { name: 'dateOfBirth', type: date },
          { name: 'nationalId', type: 'varchar', length: '32' },
          { name: 'gender', type: 'varchar', length: '8' },
          { name: 'userId', type: uuid, isNullable: true },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['userId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'patients',
      new TableIndex({ name: 'uq_patients_national_id', columnNames: ['nationalId'], isUnique: true }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'parents',
        columns: [
          {
            name: 'id',
            type: uuid,
            isPrimary: true,
            generationStrategy: 'uuid',
            default: uuidDefault,
            isGenerated: !isPg,
          },
          { name: 'firstName1', type: 'varchar', length: '64' },
          { name: 'firstName2', type: 'varchar', length: '64', isNullable: true },
          { name: 'lastName1', type: 'varchar', length: '64' },
          { name: 'lastName2', type: 'varchar', length: '64' },
          { name: 'nationalId', type: 'varchar', length: '32' },
          { name: 'userId', type: uuid, isNullable: true },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['userId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'parents',
      new TableIndex({ name: 'uq_parents_national_id', columnNames: ['nationalId'], isUnique: true }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'patient_parents',
        columns: [
          { name: 'patientId', type: uuid, isPrimary: true },
          { name: 'parentId', type: uuid, isPrimary: true },
        ],
        foreignKeys: [
          {
            columnNames: ['patientId'],
            referencedTableName: 'patients',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['parentId'],
            referencedTableName: 'parents',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'parent_contacts',
        columns: [
          {
            name: 'id',
            type: uuid,
            isPrimary: true,
            generationStrategy: 'uuid',
            default: uuidDefault,
            isGenerated: !isPg,
          },
          { name: 'parentId', type: uuid },
          { name: 'type', type: 'varchar', length: '8' },
          { name: 'value', type: 'varchar', length: '320' },
          { name: 'isVerified', type: 'boolean', default: false },
          { name: 'isPrimary', type: 'boolean', default: false },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['parentId'],
            referencedTableName: 'parents',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'parent_contacts',
      new TableIndex({ name: 'idx_parent_contacts_parent', columnNames: ['parentId'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'measurements',
        columns: [
          {
            name: 'id',
            type: uuid,
            isPrimary: true,
            generationStrategy: 'uuid',
            default: uuidDefault,
            isGenerated: !isPg,
          },
          { name: 'patientId', type: uuid },
          { name: 'recordedById', type: uuid },
          { name: 'recordedAt', type: date },
          { name: 'ageMonths', type: num(7, 4) },
          { name: 'weightKg', type: num(6, 3) },
          { name: 'heightCm', type: num(5, 2) },
          { name: 'notes', type: 'text', isNullable: true },
          { name: 'createdAt', type: ts, default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: ts, default: 'CURRENT_TIMESTAMP' },
        ],
        foreignKeys: [
          {
            columnNames: ['patientId'],
            referencedTableName: 'patients',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['recordedById'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'measurements',
      new TableIndex({
        name: 'idx_measurements_patient_date',
        columnNames: ['patientId', 'recordedAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('measurements');
    await queryRunner.dropTable('parent_contacts');
    await queryRunner.dropTable('patient_parents');
    await queryRunner.dropTable('parents');
    await queryRunner.dropTable('patients');
    await queryRunner.dropTable('refresh_tokens');
    await queryRunner.dropTable('otp_codes');
    await queryRunner.dropTable('users');
  }
}
