export enum UserRole {
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR',
  PATIENT = 'PATIENT',
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
  TELEGRAM = 'TELEGRAM',
}

export enum ContactType {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
}

export enum WhoIndicator {
  HEIGHT_FOR_AGE = 'HEIGHT_FOR_AGE',
  WEIGHT_FOR_AGE = 'WEIGHT_FOR_AGE',
  WEIGHT_FOR_HEIGHT = 'WEIGHT_FOR_HEIGHT',
  BMI_FOR_AGE = 'BMI_FOR_AGE',
  HEAD_CIRCUMFERENCE_FOR_AGE = 'HEAD_CIRCUMFERENCE_FOR_AGE',
}

export const GENDER_LABEL: Record<Gender, string> = {
  [Gender.MALE]: 'Boy',
  [Gender.FEMALE]: 'Girl',
};

export const INDICATOR_AGE_RANGE: Record<
  WhoIndicator,
  { min: number; max: number; unit: 'months' | 'cm' }
> = {
  [WhoIndicator.HEIGHT_FOR_AGE]: { min: 0, max: 240, unit: 'months' },
  [WhoIndicator.WEIGHT_FOR_AGE]: { min: 0, max: 240, unit: 'months' },
  [WhoIndicator.WEIGHT_FOR_HEIGHT]: { min: 45, max: 121, unit: 'cm' },
  [WhoIndicator.BMI_FOR_AGE]: { min: 24, max: 240, unit: 'months' },
  [WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]: { min: 0, max: 36, unit: 'months' },
};

export const INDICATOR_LABEL: Record<WhoIndicator, string> = {
  [WhoIndicator.HEIGHT_FOR_AGE]: 'Height-for-Age',
  [WhoIndicator.WEIGHT_FOR_AGE]: 'Weight-for-Age',
  [WhoIndicator.WEIGHT_FOR_HEIGHT]: 'Weight-for-Height',
  [WhoIndicator.BMI_FOR_AGE]: 'BMI-for-Age',
  [WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]: 'Head-Circumference-for-Age',
};
