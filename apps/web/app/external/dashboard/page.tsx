'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { GENDER_LABEL } from '@app/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function ExternalDashboardPage() {
  const { tokens } = useAuth();
  const token = tokens?.accessToken ?? '';
  const childrenQ = useQuery({
    queryKey: ['my-children', token],
    queryFn: () => api.patients.list(token),
    enabled: !!token,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">My children</h1>
      <ul className="bg-white rounded border border-slate-200 divide-y divide-slate-100">
        {(childrenQ.data ?? []).map((c) => (
          <li key={c.id}>
            <Link
              href={`/external/children/${c.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
            >
              <div>
                <div className="font-medium">{c.fullName}</div>
                <div className="text-xs text-slate-500">
                  {GENDER_LABEL[c.gender]} · DOB {c.dateOfBirth}
                </div>
              </div>
              <span className="text-slate-400">→</span>
            </Link>
          </li>
        ))}
        {childrenQ.data && childrenQ.data.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-500">
            No children are linked to this account yet. Ask the clinic to link a child.
          </li>
        )}
      </ul>
    </div>
  );
}
