<script setup lang="ts">
import type { FamilyChartView } from '#shared/utils/chart-data'
import { INDICATOR_LABEL, WhoIndicator } from '#shared/utils/enums'

const id = useRoute().params.id as string
const { data, error, refresh } = await useFetch<{ name: string, charts: Partial<Record<WhoIndicator, FamilyChartView>> }>(`/api/hijos/${encodeURIComponent(id)}/crecimiento`)
const indicators = [WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]
const showTable = ref(false)
</script>

<template>
  <UContainer class="max-w-5xl space-y-6 py-8 pb-24">
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo consultar esta información"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="data">
      <nav aria-label="Ruta" class="text-sm">
        <NuxtLink to="/" class="text-primary">Inicio</NuxtLink> / <NuxtLink :to="`/hijos/${id}`" class="text-primary">{{ data.name }}</NuxtLink> / Crecimiento
      </nav>
      <h1 class="text-2xl font-semibold">
        Crecimiento de {{ data.name }}
      </h1>
      <p class="text-sm text-muted">
        Mediciones de controles compartidos por la clínica y referencias OMS. El eje de edad muestra la edad corregida o cronológica usada en cada medición; consulte la fecha y el tipo de edad en la tabla. Consulte las curvas con su pediatra.
      </p>
      <UButton
        variant="outline"
        class="min-h-11"
        :aria-pressed="showTable"
        @click="showTable = !showTable"
      >
        {{ showTable ? 'Ver gráfico' : 'Ver tabla' }}
      </UButton>
      <UCard
        v-for="indicator in indicators"
        :key="indicator"
        class="space-y-3"
      >
        <h2 class="font-semibold">
          {{ INDICATOR_LABEL[indicator] }}
        </h2>
        <template v-if="data.charts[indicator]">
          <GrowthTable
            v-if="showTable"
            :view="data.charts[indicator]!"
            family
          />
          <GrowthChart
            v-else
            :view="data.charts[indicator]!"
            family
          />
        </template>
        <p v-else class="text-muted">
          Referencia OMS no disponible.
        </p>
      </UCard>
    </template>
  </UContainer>
</template>
