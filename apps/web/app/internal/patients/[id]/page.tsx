'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  GENDER_LABEL,
  type CreateMeasurementDto,
  type MeasurementDto,
  zScoreBand,
} from '@app/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { GrowthChart } from '@/components/GrowthChart';
import { MeasurementTable } from '@/components/MeasurementTable';

const BAND_BG: Record<ReturnType<typeof zScoreBand>, string> = {
  na: 'bg-slate-100 text-slate-500',
  green: 'bg-emerald-50 text-emerald-700',
  yellow: 'bg-yellow-50 text-yellow-800',
  orange: 'bg-orange-50 text-orange-800',
  red: 'bg-red-50 text-red-800',
};

export default function PatientDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { tokens } = useAuth();
  const token = tokens?.accessToken ?? '';
  const qc = useQueryClient();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [showForm, setShowForm] = useState(false);
  const [lastResult, setLastResult] = useState<MeasurementDto | null>(null);

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

  const recordMut = useMutation({
    mutationFn: (dto: CreateMeasurementDto) => api.measurements.create(token, id, dto),
    onSuccess: (m) => {
      setLastResult(m);
      qc.invalidateQueries({ queryKey: ['measurements', id] });
    },
  });

  if (!patientQ.data) {
    return <div className="text-slate-500">Loading patient…</div>;
  }
  const p = patientQ.data;
  const measurements = measurementsQ.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{p.fullName}</h1>
          <div className="text-sm text-slate-500">
            {GENDER_LABEL[p.gender]} · DOB {p.dateOfBirth} · National ID {p.nationalId}
          </div>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setLastResult(null);
          }}
          className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm"
        >
          Record measurement
        </button>
      </header>

      {showForm && (
        <RecordMeasurementForm
          dob={p.dateOfBirth}
          onCancel={() => setShowForm(false)}
          onSubmit={(dto) => recordMut.mutate(dto)}
          busy={recordMut.isPending}
          error={recordMut.error?.message ?? null}
          result={lastResult}
        />
      )}

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

function RecordMeasurementForm({
  dob,
  onCancel,
  onSubmit,
  busy,
  error,
  result,
}: {
  dob: string;
  onCancel: () => void;
  onSubmit: (dto: CreateMeasurementDto) => void;
  busy: boolean;
  error: string | null;
  result: MeasurementDto | null;
}) {
  const [recordedAt, setRecordedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [weightKg, setWeightKg] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [notes, setNotes] = useState('');

  const ageMonths = (() => {
    if (!dob) return 0;
    const ms = new Date(recordedAt).getTime() - new Date(dob).getTime();
    return ms / (1000 * 60 * 60 * 24 * 30.4375);
  })();

  return (
    <div className="bg-white rounded border border-slate-200 p-4 space-y-3">
      <h2 className="font-medium">Record measurement</h2>
      {error && <div className="bg-red-50 text-red-800 text-sm rounded px-3 py-2">{error}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            recordedAt,
            weightKg: parseFloat(weightKg),
            heightCm: parseFloat(heightCm),
            notes: notes || undefined,
          });
        }}
        className="grid grid-cols-4 gap-3"
      >
        <label className="text-sm col-span-1">
          <span className="text-slate-700">Date</span>
          <input
            type="date"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
          />
        </label>
        <label className="text-sm col-span-1">
          <span className="text-slate-700">Weight (kg)</span>
          <input
            required
            type="number"
            step="0.001"
            min="0.5"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
          />
        </label>
        <label className="text-sm col-span-1">
          <span className="text-slate-700">Height (cm)</span>
          <input
            required
            type="number"
            step="0.01"
            min="20"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
          />
        </label>
        <div className="text-sm col-span-1">
          <span className="text-slate-700">Age</span>
          <div className="mt-1 px-3 py-2 rounded bg-slate-50 border border-slate-200 font-mono text-sm">
            {ageMonths.toFixed(2)} months
          </div>
        </div>
        <label className="text-sm col-span-4">
          <span className="text-slate-700">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 block w-full rounded border-slate-300 px-3 py-2 border"
            rows={2}
          />
        </label>
        <div className="col-span-4 flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm">
            Close
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save measurement'}
          </button>
        </div>
      </form>

      {result && (
        <div className="border-t border-slate-100 pt-3">
          <div className="text-sm font-medium mb-2">Z-scores</div>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { label: 'HAZ', value: result.zScores.haz },
                { label: 'WAZ', value: result.zScores.waz },
                { label: 'WHZ', value: result.zScores.whz },
                { label: 'BAZ', value: result.zScores.baz },
              ] as const
            ).map(({ label, value }) => (
              <div
                key={label}
                className={`rounded px-3 py-2 text-sm ${BAND_BG[zScoreBand(value)]}`}
              >
                <div className="text-xs uppercase tracking-wide opacity-75">{label}</div>
                <div className="font-mono text-base">
                  {value === null ? '—' : value.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
