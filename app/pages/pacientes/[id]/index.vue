<script setup lang="ts">
import type { PatientView, VisitSnapshot } from '#shared/types/measurement'
import { formatGrowthValues } from '#shared/utils/growth-result'
import type { WhoIndicator } from '#shared/utils/enums'

const route = useRoute()
const id = route.params.id as string
const { data, error, refresh } = await useFetch<{ patient: PatientView, visits: VisitSnapshot[] }>(`/api/pacientes/${encodeURIComponent(id)}`)
const latest = computed(() => data.value?.visits[0])
const labels: Record<WhoIndicator, string> = {
  HEIGHT_FOR_AGE: 'Longitud/talla para la edad', WEIGHT_FOR_AGE: 'Peso para la edad',
  WEIGHT_FOR_LENGTH: 'Peso para la longitud', WEIGHT_FOR_HEIGHT: 'Peso para la talla',
  BMI_FOR_AGE: 'IMC para la edad', HEAD_CIRCUMFERENCE_FOR_AGE: 'Perímetro cefálico para la edad'
}
const weightFormat = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const lengthFormat = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-8 pb-24">
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo abrir la ficha"
      description="Compruebe su conexión e inténtelo otra vez."
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="data">
      <nav
        aria-label="Ruta"
        class="flex items-center gap-2 text-sm"
      >
        <NuxtLink
          to="/pacientes"
          class="text-primary hover:underline"
        >Pacientes</NuxtLink>
        <span class="text-muted">/</span>
        <span>{{ data.patient.name }}</span>
      </nav>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">
            {{ data.patient.name }}
          </h1>
          <p class="text-sm text-muted">
            {{ data.patient.sex === 'FEMALE' ? 'Niña' : 'Niño' }} · Nacimiento {{ data.patient.birthDate }}
          </p>
        </div>
        <UButton
          :to="`/pacientes/${id}/visitas/nueva`"
          icon="i-lucide-plus"
          size="lg"
        >
          Nueva visita
        </UButton>
      </div>
      <UEmpty
        v-if="!latest"
        icon="i-lucide-clipboard-list"
        title="Aún no hay mediciones"
        description="Registre la primera visita para ver los resultados."
        :actions="[{ label: 'Registrar primera visita', to: `/pacientes/${id}/visitas/nueva` }]"
      />
      <template v-else>
        <section
          aria-label="Última visita"
          class="space-y-3"
        >
          <h2 class="text-lg font-semibold">
            Última visita · {{ dateFormat.format(new Date(latest.measuredAt)) }}
          </h2>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UCard>
              <p class="text-sm text-muted">
                Peso
              </p><p class="text-xl font-semibold tabular-nums">
                {{ weightFormat.format(latest.weightKg) }} kg
              </p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">
                {{ latest.position === 'RECUMBENT' ? 'Longitud acostada' : 'Talla de pie' }}
              </p><p class="text-xl font-semibold tabular-nums">
                {{ lengthFormat.format(latest.lengthHeightCm) }} cm
              </p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">
                Perímetro cefálico
              </p><p class="text-xl font-semibold tabular-nums">
                {{ lengthFormat.format(latest.headCircumferenceCm) }} cm
              </p>
            </UCard>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UCard
              v-for="result in latest.results"
              :key="result.id"
            >
              <h3 class="text-sm font-medium">
                {{ labels[result.indicator as WhoIndicator] }}
              </h3>
              <p
                v-if="result.status === 'available'"
                class="mt-2 tabular-nums"
              >
                {{ formatGrowthValues(result.z, result.percentile) }}
              </p><p
                v-else
                class="mt-2 text-muted"
              >
                No disponible
              </p>
              <p
                v-if="result.status === 'available' && result.classification.name"
                class="text-sm"
              >
                {{ result.classification.name }}
              </p>
            </UCard>
          </div>
        </section>
        <section class="space-y-3">
          <h2 class="text-lg font-semibold">
            Mediciones
          </h2><UCard>
            <div class="overflow-x-auto">
              <table
                aria-label="Mediciones"
                class="w-full min-w-[680px] text-left text-sm"
              >
                <thead>
                  <tr class="border-b border-default text-muted">
                    <th
                      scope="col"
                      class="p-3"
                    >
                      Fecha
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      Peso
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      Longitud/talla
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      P. cefálico
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      Z peso/edad · percentil
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      Registró
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in data.visits"
                    :key="item.id"
                    class="border-b border-default last:border-0"
                  >
                    <td class="p-3">
                      {{ dateFormat.format(new Date(item.measuredAt)) }}
                    </td><td class="p-3 tabular-nums">
                      {{ weightFormat.format(item.weightKg) }} kg
                    </td><td class="p-3 tabular-nums">
                      {{ lengthFormat.format(item.lengthHeightCm) }} cm
                    </td><td class="p-3 tabular-nums">
                      {{ lengthFormat.format(item.headCircumferenceCm) }} cm
                    </td><td class="p-3 tabular-nums">
                      <template
                        v-for="result in item.results"
                        :key="result.id"
                      >
                        <span v-if="result.indicator === WhoIndicator.WEIGHT_FOR_AGE">{{ result.status === 'available' ? formatGrowthValues(result.z, result.percentile) : 'No disponible' }}</span>
                      </template>
                    </td><td class="p-3">
                      {{ item.authorId }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>
        </section>
        <UCard
          v-if="latest.clinicianTrend || latest.parentAdvice || latest.privateNote"
          class="space-y-2"
        >
          <h2 class="font-semibold">
            Notas de la visita
          </h2><p v-if="latest.clinicianTrend">
            Tendencia indicada por el profesional: {{ latest.clinicianTrend }}
          </p><p v-if="latest.parentAdvice">
            Recomendaciones para la familia: {{ latest.parentAdvice }}
          </p><p v-if="latest.privateNote">
            Nota clínica privada: {{ latest.privateNote }}
          </p>
        </UCard>
      </template>
    </template>
  </UContainer>
</template>
