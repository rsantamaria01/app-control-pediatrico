'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { GENDER_LABEL } from '@app/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { GrowthChart } from '@/components/GrowthChart';
import { MeasurementTable } from '@/components/MeasurementTable';

export default function ChildPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { tokens } = useAuth();
  const token = tokens?.accessToken ?? '';
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const patientQ = useQuery({
    queryKey: ['patient', id, token],
    queryFn: () => api.patients.byId(token, id),
    enabled: !!token && !!id,
  });
  const measurementsQ = useQuery({
    queryKey: ['measurements', id, token],
    queryFn: () => api.measurements.list(token, id),
    enabled: !!token && !!id,
  });

  if (!patientQ.data) {
    return <div className="text-slate-500">Loading…</div>;
  }
  const p = patientQ.data;
  const measurements = measurementsQ.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{p.fullName}</h1>
        <div className="text-sm text-slate-500">
          {GENDER_LABEL[p.gender]} · DOB {p.dateOfBirth}
        </div>
      </header>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setView('chart')}
          className={`text-sm px-3 py-1.5 rounded ${
            view === 'chart' ? 'bg-slate-900 text-white' : 'border border-slate-200'
          }`}
        >
          Chart
        </button>
        <button
          onClick={() => setView('table')}
          className={`text-sm px-3 py-1.5 rounded ${
            view === 'table' ? 'bg-slate-900 text-white' : 'border border-slate-200'
          }`}
        >
          Table
        </button>
      </div>

      {view === 'chart' ? (
        <GrowthChart gender={p.gender} measurements={measurements} />
      ) : (
        <MeasurementTable rows={measurements} />
      )}
    </div>
  );
}
