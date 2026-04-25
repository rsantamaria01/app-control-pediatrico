'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRole, type CreateUserDto } from '@app/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function UsersPage() {
  const { tokens } = useAuth();
  const token = tokens?.accessToken ?? '';
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const usersQ = useQuery({
    queryKey: ['users', token],
    queryFn: () => api.users.list(token),
    enabled: !!token,
  });

  const createMut = useMutation({
    mutationFn: (dto: CreateUserDto) => api.users.create(token, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setOpen(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm"
        >
          New user
        </button>
      </div>
      <table className="w-full text-sm bg-white rounded border border-slate-200">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-left">Phone</th>
            <th className="px-3 py-2 text-left">Role</th>
            <th className="px-3 py-2 text-left">Active</th>
          </tr>
        </thead>
        <tbody>
          {(usersQ.data ?? []).map((u) => (
            <tr key={u.id} className="border-t border-slate-100">
              <td className="px-3 py-2">{u.email}</td>
              <td className="px-3 py-2">{u.phone ?? '—'}</td>
              <td className="px-3 py-2">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase">
                  {u.role}
                </span>
              </td>
              <td className="px-3 py-2">{u.isActive ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {open && (
        <NewUserModal
          onClose={() => setOpen(false)}
          onSubmit={(dto) => createMut.mutate(dto)}
          busy={createMut.isPending}
          error={createMut.error?.message ?? null}
        />
      )}
    </div>
  );
}

function NewUserModal({
  onClose,
  onSubmit,
  busy,
  error,
}: {
  onClose: () => void;
  onSubmit: (dto: CreateUserDto) => void;
  busy: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<CreateUserDto>({
    email: '',
    role: UserRole.DOCTOR,
  });
  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center px-4 z-50">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
        className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md space-y-3"
      >
        <h2 className="text-lg font-semibold">New user</h2>
        {error && <div className="bg-red-50 text-red-800 text-sm rounded px-3 py-2">{error}</div>}
        <label className="text-sm block">
          <span className="text-slate-700">Email</span>
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
          />
        </label>
        <label className="text-sm block">
          <span className="text-slate-700">Phone</span>
          <input
            value={form.phone ?? ''}
            onChange={(e) => setForm({ ...form, phone: e.target.value || undefined })}
            className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
          />
        </label>
        <label className="text-sm block">
          <span className="text-slate-700">Initial password</span>
          <input
            type="password"
            value={form.password ?? ''}
            onChange={(e) => setForm({ ...form, password: e.target.value || undefined })}
            className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
          />
        </label>
        <label className="text-sm block">
          <span className="text-slate-700">Role</span>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border bg-white"
          >
            <option value={UserRole.ADMIN}>Admin</option>
            <option value={UserRole.DOCTOR}>Doctor</option>
            <option value={UserRole.PATIENT}>Patient / Parent</option>
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
