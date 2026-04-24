import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { ContactType } from '../enums';

export class CreateParentDto {
  @IsString()
  firstName1!: string;

  @IsOptional() @IsString()
  firstName2?: string;

  @IsString()
  lastName1!: string;

  @IsString()
  lastName2!: string;

  @IsString()
  nationalId!: string;
}

export class UpdateParentDto {
  @IsOptional() @IsString() firstName1?: string;
  @IsOptional() @IsString() firstName2?: string | null;
  @IsOptional() @IsString() lastName1?: string;
  @IsOptional() @IsString() lastName2?: string;
  @IsOptional() @IsString() nationalId?: string;
}

export class CreateParentContactDto {
  @IsEnum(ContactType)
  type!: ContactType;

  @IsString()
  value!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export interface ParentDto {
  id: string;
  firstName1: string;
  firstName2: string | null;
  lastName1: string;
  lastName2: string;
  fullName: string;
  nationalId: string;
  userId: string | null;
  contacts: ParentContactDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ParentContactDto {
  id: string;
  type: ContactType;
  value: string;
  isVerified: boolean;
  isPrimary: boolean;
}
