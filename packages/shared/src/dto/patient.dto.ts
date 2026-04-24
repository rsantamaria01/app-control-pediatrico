import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Gender } from '../enums';

export class CreatePatientDto {
  @IsString()
  firstName1!: string;

  @IsOptional()
  @IsString()
  firstName2?: string;

  @IsString()
  lastName1!: string;

  @IsString()
  lastName2!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsString()
  nationalId!: string;

  @IsEnum(Gender)
  gender!: Gender;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  parentIds?: string[];
}

export class UpdatePatientDto {
  @IsOptional() @IsString() firstName1?: string;
  @IsOptional() @IsString() firstName2?: string | null;
  @IsOptional() @IsString() lastName1?: string;
  @IsOptional() @IsString() lastName2?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() nationalId?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
}

export interface PatientDto {
  id: string;
  firstName1: string;
  firstName2: string | null;
  lastName1: string;
  lastName2: string;
  fullName: string;
  dateOfBirth: string;
  nationalId: string;
  gender: Gender;
  userId: string | null;
  parentIds: string[];
  createdAt: string;
  updatedAt: string;
}
