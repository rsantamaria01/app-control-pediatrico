<script setup lang="ts">
import type { FamilyChildView } from '../../../../server/services/invitations'

const id = useRoute().params.id as string
const { data: child, error, refresh } = await useFetch<FamilyChildView>(`/api/hijos/${encodeURIComponent(id)}`)
const dates = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const weight = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const size = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-8 pb-24">
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo consultar esta información"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="child">
      <nav aria-label="Ruta">
        <NuxtLink
          to="/"
          class="text-primary hover:underline"
        >Inicio</NuxtLink> / {{ child.name }}
      </nav>
      <h1 class="text-2xl font-semibold">
        Crecimiento de {{ child.name }}
      </h1>
      <p class="text-sm text-muted">
        La puntuación Z compara con {{ child.sex === 'FEMALE' ? 'niñas' : 'niños' }} de la misma edad: 0 es el promedio; entre −2 y +2 es el rango esperado.
      </p>
      <UEmpty
        v-if="!child.visits.length"
        title="Aún no hay mediciones"
        description="Consulte con el equipo de la clínica."
      />
      <div
        v-else
        class="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
      >
        <div class="space-y-5">
          <UCard
            v-for="(visit, index) in child.visits"
            :key="visit.measuredAt + index"
          >
            <h2 class="text-lg font-semibold">
              {{ index === 0 ? 'Últimas medidas' : 'Medidas anteriores' }} · {{ dates.format(new Date(visit.measuredAt)) }}
            </h2>
            <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2 tabular-nums">
              <p>Peso: {{ weight.format(visit.weightKg) }} kg</p>
              <p>{{ visit.position === 'RECUMBENT' ? 'Longitud' : 'Talla' }}: {{ size.format(visit.lengthHeightCm) }} cm</p>
              <p>Perímetro cefálico: {{ size.format(visit.headCircumferenceCm) }} cm</p>
              <p v-if="visit.bmi !== null">
                IMC: {{ size.format(visit.bmi) }} kg/m²
              </p>
            </div>
            <GrowthFamilyGrowthStatus
              :results="visit.results"
              class="mt-4"
            />
          </UCard>
        </div>
        <section
          class="space-y-3"
          aria-label="Recomendaciones"
        >
          <UCard>
            <h2 class="text-lg font-semibold">
              Recomendaciones
            </h2>
            <ul
              v-if="child.visits.some(visit => visit.parentAdvice)"
              class="mt-3 space-y-3"
            >
              <li
                v-for="(visit, index) in child.visits.filter(visit => visit.parentAdvice)"
                :key="index"
                class="border-l-2 border-primary pl-3"
              >
                <p class="text-xs text-muted">
                  {{ dates.format(new Date(visit.measuredAt)) }}
                </p>
                <p class="whitespace-pre-wrap text-sm">
                  {{ visit.parentAdvice }}
                </p>
              </li>
            </ul>
            <p
              v-else
              class="mt-3 text-sm text-muted"
            >
              Aún no hay recomendaciones compartidas.
            </p>
          </UCard>
        </section>
      </div>
    </template>
  </UContainer>
</template>
