export enum UserRole {
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR',
  PATIENT = 'PATIENT'
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE'
}

export enum WhoIndicator {
  HEIGHT_FOR_AGE = 'HEIGHT_FOR_AGE',
  WEIGHT_FOR_AGE = 'WEIGHT_FOR_AGE',
  WEIGHT_FOR_HEIGHT = 'WEIGHT_FOR_HEIGHT',
  WEIGHT_FOR_LENGTH = 'WEIGHT_FOR_LENGTH',
  HEAD_CIRCUMFERENCE_FOR_AGE = 'HEAD_CIRCUMFERENCE_FOR_AGE',
  BMI_FOR_AGE = 'BMI_FOR_AGE'
}

export const GENDER_LABEL: Record<Gender, string> = {
  [Gender.MALE]: 'Niño',
  [Gender.FEMALE]: 'Niña'
}

export const INDICATOR_LABEL: Record<WhoIndicator, string> = {
  [WhoIndicator.HEIGHT_FOR_AGE]: 'Talla para la edad',
  [WhoIndicator.WEIGHT_FOR_AGE]: 'Peso para la edad',
  [WhoIndicator.WEIGHT_FOR_HEIGHT]: 'Peso para la talla',
  [WhoIndicator.WEIGHT_FOR_LENGTH]: 'Peso para la longitud',
  [WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]: 'Perímetro cefálico para la edad',
  [WhoIndicator.BMI_FOR_AGE]: 'IMC para la edad'
}
