'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import {
  Gender,
  GENDER_LABEL,
  INDICATOR_AGE_RANGE,
  INDICATOR_LABEL,
  WhoIndicator,
  type MeasurementDto,
  valueAtZ,
} from '@app/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const Z_LINES: { z: number; color: string; label: string }[] = [
  { z: -3, color: '#dc2626', label: '−3 SD' },
  { z: -2, color: '#f97316', label: '−2 SD' },
  { z: -1, color: '#eab308', label: '−1 SD' },
  { z: 0, color: '#16a34a', label: 'Median' },
  { z: 1, color: '#eab308', label: '+1 SD' },
  { z: 2, color: '#f97316', label: '+2 SD' },
  { z: 3, color: '#dc2626', label: '+3 SD' },
];

export function GrowthChart({
  gender,
  measurements,
}: {
  gender: Gender;
  measurements: MeasurementDto[];
}) {
  const { tokens } = useAuth();
  const token = tokens?.accessToken ?? '';
  const [indicator, setIndicator] = useState<WhoIndicator>(WhoIndicator.HEIGHT_FOR_AGE);

  const curveQ = useQuery({
    queryKey: ['who-curve', indicator, gender],
    queryFn: () => api.who.curve(token, indicator, gender),
    enabled: !!token,
  });

  const range = INDICATOR_AGE_RANGE[indicator];
  const xLabel =
    indicator === WhoIndicator.WEIGHT_FOR_HEIGHT ? 'Height (cm)' : 'Age (months)';
  const yLabel = useMemo(() => {
    switch (indicator) {
      case WhoIndicator.HEIGHT_FOR_AGE:
        return 'Height (cm)';
      case WhoIndicator.WEIGHT_FOR_AGE:
        return 'Weight (kg)';
      case WhoIndicator.WEIGHT_FOR_HEIGHT:
        return 'Weight (kg)';
      case WhoIndicator.BMI_FOR_AGE:
        return 'BMI (kg/m²)';
    }
  }, [indicator]);

  const option = useMemo(() => {
    const rows = curveQ.data?.rows ?? [];
    const zSeries = Z_LINES.map(({ z, color, label }) => ({
      name: label,
      type: 'line' as const,
      showSymbol: false,
      smooth: true,
      lineStyle: { color, width: z === 0 ? 2 : 1 },
      itemStyle: { color },
      data: rows.map((r) => [r.xValue, valueAtZ(z, r.l, r.m, r.s)]),
    }));

    const patientPoints = measurements
      .map((m) => {
        const xVal =
          indicator === WhoIndicator.WEIGHT_FOR_HEIGHT ? m.heightCm : m.ageMonths;
        const yVal = (() => {
          switch (indicator) {
            case WhoIndicator.HEIGHT_FOR_AGE:
              return m.heightCm;
            case WhoIndicator.WEIGHT_FOR_AGE:
              return m.weightKg;
            case WhoIndicator.WEIGHT_FOR_HEIGHT:
              return m.weightKg;
            case WhoIndicator.BMI_FOR_AGE:
              return m.bmi;
          }
        })();
        const zKey =
          indicator === WhoIndicator.HEIGHT_FOR_AGE
            ? 'haz'
            : indicator === WhoIndicator.WEIGHT_FOR_AGE
              ? 'waz'
              : indicator === WhoIndicator.WEIGHT_FOR_HEIGHT
                ? 'whz'
                : 'baz';
        return {
          x: xVal,
          y: yVal,
          z: m.zScores[zKey],
          recordedAt: m.recordedAt,
        };
      })
      .filter((p) => p.x >= range.min && p.x <= range.max);

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: { seriesName: string; data: unknown }) => {
          const p = params.data as
            | [number, number]
            | { x: number; y: number; z: number | null; recordedAt: string };
          if (Array.isArray(p)) {
            return `${params.seriesName}<br/>${xLabel.replace(' (months)', '').replace(' (cm)', '')} ${p[0]}<br/>${yLabel.split(' (')[0]} ${p[1].toFixed(2)}`;
          }
          return `<b>${p.recordedAt}</b><br/>${xLabel}: ${p.x}<br/>${yLabel}: ${p.y}<br/>z = ${
            p.z === null ? '—' : p.z.toFixed(2)
          }`;
        },
      },
      legend: { type: 'scroll', top: 0 },
      grid: { left: 50, right: 30, top: 40, bottom: 50 },
      xAxis: {
        type: 'value',
        name: xLabel,
        min: range.min,
        max: range.max,
      },
      yAxis: {
        type: 'value',
        name: yLabel,
        scale: true,
      },
      dataZoom: [
        { type: 'slider', xAxisIndex: 0, height: 16, bottom: 8 },
        { type: 'inside', xAxisIndex: 0 },
      ],
      series: [
        ...zSeries,
        {
          name: 'Patient',
          type: 'scatter',
          symbolSize: 10,
          itemStyle: { color: '#0ea5e9', borderColor: '#0c4a6e', borderWidth: 1 },
          encode: { x: 'x', y: 'y' },
          data: patientPoints.map((p) => ({ value: [p.x, p.y], ...p })),
          z: 5,
        },
      ],
    };
  }, [curveQ.data, measurements, indicator, range, xLabel, yLabel]);

  return (
    <div className="bg-white rounded border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Growth chart · {GENDER_LABEL[gender]}</h3>
        <div className="ml-auto flex items-center gap-1">
          {Object.values(WhoIndicator).map((ind) => (
            <button
              key={ind}
              onClick={() => setIndicator(ind)}
              className={`text-xs rounded px-2 py-1 ${
                indicator === ind
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {INDICATOR_LABEL[ind]}
            </button>
          ))}
        </div>
      </div>
      {curveQ.isLoading ? (
        <div className="h-96 grid place-items-center text-slate-400">Loading curves…</div>
      ) : curveQ.error ? (
        <div className="h-96 grid place-items-center text-red-600">
          Failed to load curves: {(curveQ.error as Error).message}
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 480, width: '100%' }} />
      )}
    </div>
  );
}
