<script setup lang="ts">
import type { FamilyChildSummary, FamilyChildView } from '../../../../server/services/invitations'

const id = useRoute().params.id as string
const { data: child, error, refresh } = await useFetch<FamilyChildView>(`/api/hijos/${encodeURIComponent(id)}`)
if (import.meta.server && error.value) throw createError({ statusCode: error.value.statusCode === 404 ? 404 : 503, statusMessage: 'No disponible' })
const { data: children } = await useFetch<FamilyChildSummary[]>('/api/hijos', { default: () => [] })
const { data: doses, error: dosesError, refresh: refreshDoses } = await useFetch<{ label: string, doseLabel: string | null, appliedAt: string }[]>(`/api/hijos/${encodeURIComponent(id)}/vacunas`, { default: () => [] })
const dates = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const dateTime = new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Guayaquil' })
const weight = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const size = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const latest = computed(() => child.value?.visits[0])
const nextControl = computed(() => latest.value?.nextControlAt)
const advice = computed(() => child.value?.visits.filter(visit => visit.parentAdvice) ?? [])
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
    <template v-else-if="child">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <UButton
            to="/"
            icon="i-lucide-chevron-left"
            variant="ghost"
            color="neutral"
            aria-label="Volver al inicio"
            class="min-h-11 lg:hidden"
          />
          <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
            {{ child.name }}
          </h1>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            :to="`/hijos/${id}/informe`"
            icon="i-lucide-file-text"
            variant="outline"
            color="neutral"
            class="min-h-11"
          >
            Ver informe PDF
          </UButton>
          <UButton
            to="/citas"
            icon="i-lucide-calendar-days"
            class="min-h-11"
          >
            Agendar cita
          </UButton>
        </div>
      </div>
      <nav
        v-if="children && children.length > 1"
        aria-label="Hijos"
        class="flex flex-wrap gap-1 rounded-xl bg-elevated p-1 sm:w-fit"
      >
        <NuxtLink
          v-for="sibling in children"
          :key="sibling.id"
          :to="`/hijos/${sibling.id}`"
          :aria-current="sibling.id === id ? 'page' : undefined"
          class="flex min-h-11 items-center rounded-lg px-4 text-sm font-medium text-muted focus-visible:outline-2 focus-visible:outline-primary"
          :class="sibling.id === id ? 'bg-default text-default shadow-sm' : 'hover:text-default'"
        >{{ sibling.name }}</NuxtLink>
      </nav>
      <nav
        aria-label="Secciones"
        class="flex flex-wrap gap-1 rounded-xl bg-elevated p-1 lg:hidden"
      >
        <NuxtLink
          :to="`/hijos/${id}/crecimiento`"
          class="flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-sm font-medium text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >Crecimiento</NuxtLink>
        <a
          href="#vacunas"
          class="flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-sm font-medium text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >Vacunas</a>
        <a
          href="#indicaciones"
          class="flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-sm font-medium text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >Consejos</a>
      </nav>
      <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div class="space-y-5">
          <UCard :ui="{ body: 'p-4 sm:p-5' }">
            <h2 class="text-lg font-semibold">
              Último control
            </h2>
            <template v-if="latest">
              <p class="mt-1 text-sm text-muted">
                {{ dates.format(new Date(latest.measuredAt)) }}
              </p>
              <dl class="mt-4 grid grid-cols-3 gap-2 tabular-nums">
                <div class="min-w-0 rounded-xl bg-elevated p-3">
                  <dt class="text-xs text-muted">
                    Peso
                  </dt><dd class="mt-1 text-base font-semibold sm:text-lg">
                    {{ weight.format(latest.weightKg) }} <span class="text-xs font-normal">kg</span>
                  </dd>
                </div>
                <div class="min-w-0 rounded-xl bg-elevated p-3">
                  <dt class="text-xs text-muted">
                    {{ latest.position === 'RECUMBENT' ? 'Longitud' : 'Talla' }}
                  </dt><dd class="mt-1 text-base font-semibold sm:text-lg">
                    {{ size.format(latest.lengthHeightCm) }} <span class="text-xs font-normal">cm</span>
                  </dd>
                </div>
                <div class="min-w-0 rounded-xl bg-elevated p-3">
                  <dt class="text-xs text-muted">
                    Cabeza
                  </dt><dd class="mt-1 text-base font-semibold sm:text-lg">
                    {{ size.format(latest.headCircumferenceCm) }} <span class="text-xs font-normal">cm</span>
                  </dd>
                </div>
              </dl>
            </template>
            <p
              v-else
              class="mt-3 text-sm text-muted"
            >
              Aún no hay controles compartidos.
            </p>
          </UCard>
          <UCard :ui="{ body: 'p-4 sm:p-5' }">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-lg font-semibold">
                Cómo ha crecido
              </h2>
              <UButton
                :to="`/hijos/${id}/crecimiento`"
                variant="link"
                trailing-icon="i-lucide-chevron-right"
                class="min-h-11"
              >
                Ver gráficos
              </UButton>
            </div>
            <p class="mt-2 text-sm text-muted">
              Consulte las mediciones compartidas por la clínica y sus gráficos de crecimiento con su pediatra.
            </p>
          </UCard>

        </div>
        <div class="space-y-5">
          <UCard
            v-if="nextControl"
            :ui="{ body: 'p-4 sm:p-5' }"
          >
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted">
              Próximo control
            </h2>
            <p class="mt-2 text-lg font-semibold capitalize tabular-nums">
              {{ dateTime.format(new Date(nextControl)) }}
            </p>
            <UButton
              to="/citas"
              variant="outline"
              color="neutral"
              class="mt-3 min-h-11"
            >
              Ver mis citas
            </UButton>
          </UCard>
          <UCard
            id="indicaciones"
            :ui="{ body: 'p-4 sm:p-5' }"
          >
            <h2 class="text-base font-semibold">
              Indicaciones de tu pediatra
            </h2>
            <template v-if="advice.length">
              <div
                v-for="(visit, index) in advice"
                :key="visit.measuredAt + index"
                class="mt-3 border-l-3 pl-3"
                :class="index === 0 ? 'border-primary' : 'border-default'"
              >
                <p class="text-xs text-muted">
                  {{ dates.format(new Date(visit.measuredAt)) }}
                </p>
                <p class="mt-1 whitespace-pre-wrap text-sm">
                  {{ visit.parentAdvice }}
                </p>
              </div>
            </template>
            <p
              v-else
              class="mt-2 text-sm text-muted"
            >
              Aún no hay indicaciones compartidas.
            </p>
          </UCard>
          <UCard
            id="vacunas"
            :ui="{ body: 'p-4 sm:p-5' }"
          >
            <h2 class="text-base font-semibold">
              Vacunas aplicadas
            </h2>
            <UAlert
              v-if="dosesError"
              color="error"
              variant="soft"
              title="No se pudieron consultar las vacunas"
              :actions="[{ label: 'Reintentar', onClick: () => refreshDoses() }]"
              class="mt-3"
            />
            <p
              v-else-if="!doses?.length"
              class="mt-2 text-sm text-muted"
            >
              Aún no hay dosis aplicadas registradas.
            </p>
            <ul
              v-else
              class="mt-2 divide-y divide-default"
            >
              <li
                v-for="dose in doses"
                :key="`${dose.label}:${dose.doseLabel}:${dose.appliedAt}`"
                class="py-2 text-sm"
              >
                <span class="font-medium">{{ dose.label }}<template v-if="dose.doseLabel"> · {{ dose.doseLabel }}</template></span>
                <span class="text-muted"> · {{ dates.format(new Date(`${dose.appliedAt}T12:00:00Z`)) }}</span>
              </li>
            </ul>
          </UCard>
        </div>
      </div>
    </template>
  </UContainer>
</template>
