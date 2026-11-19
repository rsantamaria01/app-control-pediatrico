<script setup lang="ts">
import type { ChartView, FamilyChartView } from '#shared/utils/chart-data'
import { formatGrowthValues } from '#shared/utils/growth-result'

const props = defineProps<{ view: ChartView | FamilyChartView, family?: boolean }>()
const date = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const number = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 })
const pointLabel = (x: number) => props.view.xUnit === 'DAY' ? `${number.format(x / 30.4375)} meses` : `${number.format(x)} cm`
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table
      class="w-full min-w-[360px] text-left text-sm tabular-nums"
      aria-label="Mediciones y referencias de crecimiento"
    >
      <caption class="p-3 text-left font-medium">
        Mediciones y curvas de referencia OMS
      </caption>
      <thead>
        <tr class="border-b border-default text-muted">
          <th
            scope="col"
            class="p-3"
          >
            Fecha
          </th>
          <th
            scope="col"
            class="p-3"
          >
            {{ view.xUnit === 'DAY' ? 'Edad' : 'Longitud/talla' }}
          </th>
          <th
            scope="col"
            class="p-3"
          >
            Medición
          </th>
          <th
            v-if="!family"
            scope="col"
            class="p-3"
          >
            Resultado
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(point, index) in view.points"
          :key="`${point.measuredAt}-${index}`"
          class="border-b border-default last:border-0 focus-visible:outline-2 focus-visible:outline-primary"
          tabindex="0"
        >
          <td class="p-3">
            {{ date.format(new Date(point.measuredAt)) }}
          </td>
          <td class="p-3">
            {{ pointLabel(point.x) }}<span v-if="view.xUnit === 'DAY'"> · edad {{ point.ageBasis === 'CORRECTED' ? 'corregida' : 'cronológica' }}</span>
          </td>
          <td class="p-3">
            {{ number.format(point.y) }}
          </td>
          <td
            v-if="!family"
            class="p-3"
          >
            {{ 'z' in point ? formatGrowthValues(point.z, point.percentile) : '' }}
          </td>
        </tr>
        <tr v-if="!view.points.length">
          <td
            :colspan="family ? 3 : 4"
            class="p-3 text-muted"
          >
            Aún no hay mediciones compartidas.
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
