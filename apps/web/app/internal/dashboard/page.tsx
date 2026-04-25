'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function DashboardPage() {
  const { tokens } = useAuth();
  const token = tokens?.accessToken ?? '';
  const patientsQ = useQuery({
    queryKey: ['patients', token],
    queryFn: () => api.patients.list(token),
    enabled: !!token,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        <Stat
          label="Patients"
          value={patientsQ.data?.length ?? '—'}
          href="/internal/patients"
        />
      </div>
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-medium">Recent patients</h2>
          <Link className="text-sm underline" href="/internal/patients">
            All patients →
          </Link>
        </div>
        <ul className="bg-white rounded border border-slate-200 divide-y divide-slate-100">
          {(patientsQ.data ?? []).slice(0, 5).map((p) => (
            <li key={p.id}>
              <Link
                href={`/internal/patients/${p.id}`}
                className="block px-4 py-2 hover:bg-slate-50"
              >
                <div className="text-sm font-medium">{p.fullName}</div>
                <div className="text-xs text-slate-500">
                  {p.gender === 'MALE' ? 'Boy' : 'Girl'} · DOB {p.dateOfBirth}
                </div>
              </Link>
            </li>
          ))}
          {patientsQ.data && patientsQ.data.length === 0 && (
            <li className="px-4 py-3 text-sm text-slate-500">No patients yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: number | string;
  href?: string;
}) {
  const inner = (
    <div className="bg-white rounded border border-slate-200 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
