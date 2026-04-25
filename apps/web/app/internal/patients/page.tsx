'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gender, GENDER_LABEL, type CreatePatientDto } from '@app/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function PatientsListPage() {
  const { tokens } = useAuth();
  const token = tokens?.accessToken ?? '';
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);

  const patientsQ = useQuery({
    queryKey: ['patients', token],
    queryFn: () => api.patients.list(token),
    enabled: !!token,
  });

  const createMut = useMutation({
    mutationFn: (dto: CreatePatientDto) => api.patients.create(token, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      setOpen(false);
    },
  });

  const filtered = (patientsQ.data ?? []).filter((p) =>
    [p.fullName, p.nationalId].some((s) => s.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          New patient
        </button>
      </div>
      <input
        placeholder="Search by name or national ID…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded border border-slate-200 px-3 py-2 bg-white text-sm"
      />
      <ul className="bg-white rounded border border-slate-200 divide-y divide-slate-100">
        {filtered.map((p) => (
          <li key={p.id}>
            <Link
              href={`/internal/patients/${p.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
            >
              <div>
                <div className="font-medium">{p.fullName}</div>
                <div className="text-xs text-slate-500">
                  {GENDER_LABEL[p.gender]} · DOB {p.dateOfBirth} · {p.nationalId}
                </div>
              </div>
              <span className="text-slate-400">→</span>
            </Link>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-500">No patients match.</li>
        )}
      </ul>

      {open && (
        <NewPatientModal
          onClose={() => setOpen(false)}
          onSubmit={(dto) => createMut.mutate(dto)}
          busy={createMut.isPending}
          error={createMut.error?.message ?? null}
        />
      )}
    </div>
  );
}

function NewPatientModal({
  onClose,
  onSubmit,
  busy,
  error,
}: {
  onClose: () => void;
  onSubmit: (dto: CreatePatientDto) => void;
  busy: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<CreatePatientDto>({
    firstName1: '',
    lastName1: '',
    lastName2: '',
    dateOfBirth: '',
    nationalId: '',
    gender: Gender.MALE,
  });

  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center px-4 z-50">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
        className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md space-y-4"
      >
        <h2 className="text-lg font-semibold">New patient</h2>
        {error && <div className="bg-red-50 text-red-800 text-sm rounded px-3 py-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" value={form.firstName1} onChange={(v) => setForm({ ...form, firstName1: v })} required />
          <Input label="Middle name" value={form.firstName2 ?? ''} onChange={(v) => setForm({ ...form, firstName2: v || undefined })} />
          <Input label="Last name 1" value={form.lastName1} onChange={(v) => setForm({ ...form, lastName1: v })} required />
          <Input label="Last name 2" value={form.lastName2} onChange={(v) => setForm({ ...form, lastName2: v })} required />
          <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} required />
          <Input label="National ID" value={form.nationalId} onChange={(v) => setForm({ ...form, nationalId: v })} required />
          <label className="text-sm col-span-2">
            <span className="text-slate-700">Gender</span>
            <select
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value as Gender })}
              className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border bg-white"
            >
              <option value={Gender.MALE}>Boy</option>
              <option value={Gender.FEMALE}>Girl</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="text-slate-700">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
      />
    </label>
  );
}
