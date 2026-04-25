import type {
  ApiResponse,
  AuthTokensDto,
  CreateMeasurementDto,
  CreateParentContactDto,
  CreateParentDto,
  CreatePatientDto,
  CreateUserDto,
  Gender,
  MeasurementDto,
  ParentContactDto,
  ParentDto,
  PatientDto,
  UserDto,
  WhoIndicator,
  WhoStandardsResponseDto,
  NotificationChannel,
} from '@app/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface FetchOpts extends RequestInit {
  token?: string | null;
}

async function request<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set('content-type', 'application/json');
  if (opts.token) {
    headers.set('authorization', `Bearer ${opts.token}`);
  }
  const res = await fetch(`${API_URL}/api/v1${path}`, { ...opts, headers });
  const text = await res.text();
  const json: ApiResponse<T> | undefined = text ? (JSON.parse(text) as ApiResponse<T>) : undefined;
  if (!res.ok) {
    const msg = json?.error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (json?.data as T) ?? (undefined as unknown as T);
}

export const api = {
  auth: {
    requestOtp: (identifier: string, channel: NotificationChannel) =>
      request<void>('/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ identifier, channel }),
      }),
    verifyOtp: (identifier: string, code: string) =>
      request<AuthTokensDto>('/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ identifier, code }),
      }),
    password: (email: string, password: string) =>
      request<AuthTokensDto>('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    refresh: (refreshToken: string) =>
      request<AuthTokensDto>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }),
    logout: (refreshToken: string) =>
      request<void>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }),
    requestContactVerify: (token: string, contactId: string) =>
      request<void>('/auth/contact/verify/request', {
        method: 'POST',
        body: JSON.stringify({ contactId }),
        token,
      }),
    confirmContactVerify: (token: string, contactId: string, code: string) =>
      request<void>('/auth/contact/verify/confirm', {
        method: 'POST',
        body: JSON.stringify({ contactId, code }),
        token,
      }),
  },
  users: {
    list: (token: string) => request<UserDto[]>('/users', { token }),
    create: (token: string, dto: CreateUserDto) =>
      request<UserDto>('/users', { method: 'POST', body: JSON.stringify(dto), token }),
  },
  parents: {
    list: (token: string) => request<ParentDto[]>('/parents', { token }),
    create: (token: string, dto: CreateParentDto) =>
      request<ParentDto>('/parents', { method: 'POST', body: JSON.stringify(dto), token }),
    addContact: (token: string, parentId: string, dto: CreateParentContactDto) =>
      request<ParentContactDto>(`/parents/${parentId}/contacts`, {
        method: 'POST',
        body: JSON.stringify(dto),
        token,
      }),
  },
  patients: {
    list: (token: string) => request<PatientDto[]>('/patients', { token }),
    byId: (token: string, id: string) => request<PatientDto>(`/patients/${id}`, { token }),
    create: (token: string, dto: CreatePatientDto) =>
      request<PatientDto>('/patients', { method: 'POST', body: JSON.stringify(dto), token }),
    assignParents: (token: string, id: string, parentIds: string[]) =>
      request<PatientDto>(`/patients/${id}/parents`, {
        method: 'POST',
        body: JSON.stringify({ parentIds }),
        token,
      }),
  },
  measurements: {
    list: (token: string, patientId: string) =>
      request<MeasurementDto[]>(`/patients/${patientId}/measurements`, { token }),
    create: (token: string, patientId: string, dto: CreateMeasurementDto) =>
      request<MeasurementDto>(`/patients/${patientId}/measurements`, {
        method: 'POST',
        body: JSON.stringify(dto),
        token,
      }),
  },
  who: {
    curve: (token: string, indicator: WhoIndicator, gender: Gender) =>
      request<WhoStandardsResponseDto>(
        `/who-standards?indicator=${indicator}&gender=${gender}`,
        { token },
      ),
  },
};
