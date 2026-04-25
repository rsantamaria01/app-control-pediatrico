import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateMeasurementDto {
  @IsDateString()
  recordedAt!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.5)
  @Max(200)
  weightKg!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(220)
  heightCm!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export interface MeasurementDto {
  id: string;
  patientId: string;
  recordedById: string;
  recordedAt: string;
  ageMonths: number;
  weightKg: number;
  heightCm: number;
  bmi: number;
  notes: string | null;
  zScores: ZScoresDto;
  createdAt: string;
  updatedAt: string;
}

export interface ZScoresDto {
  haz: number | null;
  waz: number | null;
  whz: number | null;
  baz: number | null;
}
