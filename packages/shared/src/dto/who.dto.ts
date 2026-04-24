import { Gender, WhoIndicator } from '../enums';

export interface WhoLmsRowDto {
  indicator: WhoIndicator;
  gender: Gender;
  xValue: number;
  l: number;
  m: number;
  s: number;
}

export interface WhoStandardsResponseDto {
  indicator: WhoIndicator;
  gender: Gender;
  rows: WhoLmsRowDto[];
}
