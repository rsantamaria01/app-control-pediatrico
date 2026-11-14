<script setup lang="ts">
import type { FamilyResult } from '../../../server/services/invitations'
import { familyGrowthCopy } from '#shared/utils/family-growth-copy'
import type { GrowthResult } from '#shared/types/clinical'

const props = defineProps<{ results: FamilyResult[], doctorTitle?: string }>()
const names: Record<string, string> = {
  HEIGHT_FOR_AGE: 'Talla', WEIGHT_FOR_AGE: 'Peso', WEIGHT_FOR_LENGTH: 'Peso para longitud', WEIGHT_FOR_HEIGHT: 'Peso para talla', BMI_FOR_AGE: 'IMC', HEAD_CIRCUMFERENCE_FOR_AGE: 'Perímetro cefálico'
}
const shown = computed(() => props.results.map(result => ({
  indicator: result.indicator,
  text: result.status === 'available' ? familyGrowthCopy(result as GrowthResult, props.doctorTitle || 'La doctora') : `${names[result.indicator] || 'Medida'}: No disponible`
})))
</script>

<template>
  <ul
    class="divide-y divide-default"
    aria-label="Resultados de crecimiento"
  >
    <li
      v-for="result in shown"
      :key="result.indicator"
      class="py-3 text-sm tabular-nums"
    >
      {{ result.text }}
    </li>
  </ul>
</template>
