'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ContactType,
  type CreateParentDto,
  type CreateParentContactDto,
  type ParentDto,
} from '@app/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function ParentsPage() {
  const { tokens } = useAuth();
  const token = tokens?.accessToken ?? '';
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const parentsQ = useQuery({
    queryKey: ['parents', token],
    queryFn: () => api.parents.list(token),
    enabled: !!token,
  });

  const createMut = useMutation({
    mutationFn: (dto: CreateParentDto) => api.parents.create(token, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parents'] });
      setOpen(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Parents</h1>
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm"
        >
          New parent
        </button>
      </div>
      <ul className="bg-white rounded border border-slate-200 divide-y divide-slate-100">
        {(parentsQ.data ?? []).map((p) => (
          <ParentRow key={p.id} parent={p} token={token} />
        ))}
        {parentsQ.data && parentsQ.data.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-500">No parents yet.</li>
        )}
      </ul>

      {open && (
        <NewParentModal
          onClose={() => setOpen(false)}
          onSubmit={(dto) => createMut.mutate(dto)}
          busy={createMut.isPending}
          error={createMut.error?.message ?? null}
        />
      )}
    </div>
  );
}

function ParentRow({ parent, token }: { parent: ParentDto; token: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ContactType>(ContactType.EMAIL);
  const [value, setValue] = useState('');
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const addMut = useMutation({
    mutationFn: (dto: CreateParentContactDto) => api.parents.addContact(token, parent.id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parents'] });
      setValue('');
      setAdding(false);
    },
  });

  const reqVerifyMut = useMutation({
    mutationFn: (contactId: string) => api.auth.requestContactVerify(token, contactId),
    onSuccess: (_, contactId) => setVerifyId(contactId),
  });

  const confirmVerifyMut = useMutation({
    mutationFn: ({ contactId, code }: { contactId: string; code: string }) =>
      api.auth.confirmContactVerify(token, contactId, code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parents'] });
      setVerifyId(null);
      setCode('');
    },
  });

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{parent.fullName}</div>
          <div className="text-xs text-slate-500">{parent.nationalId}</div>
        </div>
        <button
          onClick={() => setAdding((a) => !a)}
          className="text-sm rounded border border-slate-200 px-2 py-1 hover:bg-slate-50"
        >
          {adding ? 'Cancel' : 'Add contact'}
        </button>
      </div>

      <ul className="mt-2 space-y-1">
        {parent.contacts.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-sm">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase">{c.type}</span>
            <span className="font-mono">{c.value}</span>
            {c.isVerified ? (
              <span className="text-emerald-700 text-xs">verified</span>
            ) : verifyId === c.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  confirmVerifyMut.mutate({ contactId: c.id, code });
                }}
                className="flex items-center gap-1"
              >
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Code"
                  className="rounded border-slate-200 border px-2 py-0.5 text-xs w-24"
                />
                <button className="text-xs rounded bg-slate-900 text-white px-2 py-0.5">
                  Verify
                </button>
              </form>
            ) : (
              <button
                onClick={() => reqVerifyMut.mutate(c.id)}
                className="text-xs rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50"
              >
                {reqVerifyMut.isPending ? 'Sending…' : 'Send code'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addMut.mutate({ type, value, isPrimary: parent.contacts.length === 0 });
          }}
          className="mt-2 flex items-end gap-2"
        >
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ContactType)}
            className="rounded border-slate-200 border px-2 py-1 text-sm bg-white"
          >
            <option value={ContactType.EMAIL}>Email</option>
            <option value={ContactType.PHONE}>Phone</option>
          </select>
          <input
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={type === ContactType.EMAIL ? 'parent@example.com' : '+15555550100'}
            className="rounded border-slate-200 border px-2 py-1 text-sm flex-1"
          />
          <button
            disabled={addMut.isPending}
            className="rounded bg-slate-900 text-white px-3 py-1 text-sm"
          >
            {addMut.isPending ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}
    </li>
  );
}

function NewParentModal({
  onClose,
  onSubmit,
  busy,
  error,
}: {
  onClose: () => void;
  onSubmit: (dto: CreateParentDto) => void;
  busy: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<CreateParentDto>({
    firstName1: '',
    lastName1: '',
    lastName2: '',
    nationalId: '',
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
        <h2 className="text-lg font-semibold">New parent</h2>
        {error && <div className="bg-red-50 text-red-800 text-sm rounded px-3 py-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={form.firstName1} onChange={(v) => setForm({ ...form, firstName1: v })} required />
          <Field label="Middle name" value={form.firstName2 ?? ''} onChange={(v) => setForm({ ...form, firstName2: v || undefined })} />
          <Field label="Last name 1" value={form.lastName1} onChange={(v) => setForm({ ...form, lastName1: v })} required />
          <Field label="Last name 2" value={form.lastName2} onChange={(v) => setForm({ ...form, lastName2: v })} required />
          <Field label="National ID" value={form.nationalId} onChange={(v) => setForm({ ...form, nationalId: v })} required />
        </div>
        <div className="flex justify-end gap-2">
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

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="text-slate-700">{label}</span>
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
      />
    </label>
  );
}
