<script setup lang="ts">
import type { FamilyChartView } from '#shared/utils/chart-data'
import { INDICATOR_LABEL, WhoIndicator } from '#shared/utils/enums'

const id = useRoute().params.id as string
const { data, error, refresh } = await useFetch<{ name: string, charts: Partial<Record<WhoIndicator, FamilyChartView>> }>(`/api/hijos/${encodeURIComponent(id)}/crecimiento`)
if (import.meta.server && error.value) throw createError({ statusCode: error.value.statusCode === 404 ? 404 : 503, statusMessage: 'No disponible' })
const indicators = [WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE]
const selectedIndicator = ref(WhoIndicator.WEIGHT_FOR_AGE)
const tableSection = ref<HTMLElement | null>(null)
function goToTable() {
  tableSection.value?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <UContainer class="max-w-6xl space-y-5 py-5 pb-24 sm:py-7 lg:pb-8">
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo consultar esta información"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="data">
      <nav
        aria-label="Ruta"
        class="hidden items-center gap-2 text-sm text-muted lg:flex"
      >
        <NuxtLink
          to="/"
          class="hover:text-primary hover:underline"
        >Inicio</NuxtLink>
        <UIcon
          name="i-lucide-chevron-right"
          aria-hidden="true"
          class="size-4"
        />
        <NuxtLink
          :to="`/hijos/${id}`"
          class="hover:text-primary hover:underline"
        >{{ data.name }}</NuxtLink>
        <UIcon
          name="i-lucide-chevron-right"
          aria-hidden="true"
          class="size-4"
        />
        <span
          aria-current="page"
          class="font-semibold text-default"
        >Crecimiento</span>
      </nav>
      <div class="flex items-center gap-2 lg:hidden">
        <UButton
          :to="`/hijos/${id}`"
          icon="i-lucide-chevron-left"
          variant="ghost"
          color="neutral"
          aria-label="Volver a la ficha de mi hijo"
          class="min-h-11 min-w-11"
        />
        <h1 class="text-xl font-bold tracking-tight">
          Crecimiento de {{ data.name }}
        </h1>
      </div>
      <h1 class="hidden text-2xl font-bold tracking-tight lg:block">
        Crecimiento de {{ data.name }}
      </h1>
      <p class="max-w-3xl text-sm text-muted">
        Mediciones compartidas por la clínica y referencias OMS. Consulte las curvas con su pediatra; la fecha y el tipo de edad usado figuran en la tabla.
      </p>
      <div class="flex justify-end">
        <UButton
          variant="outline"
          color="neutral"
          class="min-h-11"
          @click="goToTable"
        >
          Ver tabla
        </UButton>
      </div>
      <div
        class="grid grid-cols-3 gap-1 rounded-lg bg-elevated p-1"
        role="group"
        aria-label="Medida de crecimiento"
      >
        <UButton
          v-for="indicator in indicators"
          :key="indicator"
          :color="selectedIndicator === indicator ? 'neutral' : 'primary'"
          :variant="selectedIndicator === indicator ? 'solid' : 'ghost'"
          :aria-pressed="selectedIndicator === indicator"
          class="min-h-11 justify-center text-sm"
          @click="selectedIndicator = indicator"
        >
          {{ indicator === WhoIndicator.HEIGHT_FOR_AGE ? 'Estatura' : indicator === WhoIndicator.WEIGHT_FOR_AGE ? 'Peso' : 'Cabeza' }}
        </UButton>
      </div>
      <UCard :ui="{ body: 'space-y-3 p-4 sm:p-5' }">
        <h2 class="text-base font-semibold">
          {{ INDICATOR_LABEL[selectedIndicator] }}
        </h2>
        <template v-if="data.charts[selectedIndicator]">
          <GrowthChart
            :view="data.charts[selectedIndicator]!"
            family
          />
          <p class="flex items-center gap-2 text-xs text-muted">
            <span class="h-1 w-4 rounded bg-(--color-patient)" />{{ data.name }}<span class="ml-2 h-1 w-4 rounded border-t border-dashed border-muted" />Referencia OMS
          </p>
          <div
            ref="tableSection"
            class="min-w-0"
            aria-label="Mediciones compartidas"
          >
            <GrowthTable
              :view="data.charts[selectedIndicator]!"
              family
            />
          </div>
        </template>
        <p
          v-else
          class="text-muted"
        >
          Referencia OMS no disponible.
        </p>
      </UCard>
    </template>
  </UContainer>
</template>
