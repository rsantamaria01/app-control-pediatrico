'use client';

import { useMemo, useState } from 'react';
import type { MeasurementDto } from '@app/shared';
import { zScoreBand } from '@app/shared';

type SortKey = 'recordedAt' | 'ageMonths' | 'weightKg' | 'heightCm' | 'bmi';

const BAND_CLASS: Record<ReturnType<typeof zScoreBand>, string> = {
  na: 'text-slate-400',
  green: 'text-emerald-700 bg-emerald-50',
  yellow: 'text-yellow-800 bg-yellow-50',
  orange: 'text-orange-800 bg-orange-50',
  red: 'text-red-800 bg-red-50',
};

function ZCell({ z }: { z: number | null }) {
  const band = zScoreBand(z);
  return (
    <td className={`px-2 py-1 text-right ${BAND_CLASS[band]} font-mono`}>
      {z === null ? '—' : z.toFixed(2)}
    </td>
  );
}

export function MeasurementTable({ rows }: { rows: MeasurementDto[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('recordedAt');
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = (a[sortKey] as unknown as number | string) ?? 0;
      const bv = (b[sortKey] as unknown as number | string) ?? 0;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return asc ? cmp : -cmp;
    });
  }, [rows, sortKey, asc]);

  const Header = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      onClick={() => {
        if (sortKey === k) setAsc((a) => !a);
        else {
          setSortKey(k);
          setAsc(true);
        }
      }}
      className="px-2 py-1 text-left cursor-pointer select-none hover:bg-slate-100"
    >
      {label}
      {sortKey === k && <span className="ml-1 text-slate-400">{asc ? '↑' : '↓'}</span>}
    </th>
  );

  return (
    <div className="overflow-auto bg-white rounded border border-slate-200">
      <table className="text-sm w-full">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
          <tr>
            <Header k="recordedAt" label="Date" />
            <Header k="ageMonths" label="Age (mo)" />
            <Header k="heightCm" label="Height (cm)" />
            <Header k="weightKg" label="Weight (kg)" />
            <Header k="bmi" label="BMI" />
            <th className="px-2 py-1 text-right">HAZ</th>
            <th className="px-2 py-1 text-right">WAZ</th>
            <th className="px-2 py-1 text-right">WHZ</th>
            <th className="px-2 py-1 text-right">BAZ</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.id} className="border-t border-slate-100">
              <td className="px-2 py-1">{m.recordedAt}</td>
              <td className="px-2 py-1 text-right font-mono">{m.ageMonths.toFixed(2)}</td>
              <td className="px-2 py-1 text-right font-mono">{m.heightCm.toFixed(1)}</td>
              <td className="px-2 py-1 text-right font-mono">{m.weightKg.toFixed(2)}</td>
              <td className="px-2 py-1 text-right font-mono">{m.bmi.toFixed(2)}</td>
              <ZCell z={m.zScores.haz} />
              <ZCell z={m.zScores.waz} />
              <ZCell z={m.zScores.whz} />
              <ZCell z={m.zScores.baz} />
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={9} className="px-2 py-3 text-center text-slate-500">
                No measurements yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
