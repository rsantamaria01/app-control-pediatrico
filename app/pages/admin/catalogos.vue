<script setup lang="ts">
import { catalogKinds, type CatalogKind, type CatalogView } from '#shared/types/catalog'

const selected = ref<CatalogKind>('MOTOR')
const labels: Record<CatalogKind, string> = { MOTOR: 'Hitos motores OMS', MILESTONE: 'Hitos CDC', SCREENING: 'Tamizajes', CHECKUP: 'Controles AAP', VACCINE: 'Vacunas MSP' }
const { data, error, status, refresh } = await useFetch<CatalogView>(() => `/api/admin/catalogos/${selected.value}`, { watch: [selected] })
if (error.value?.statusCode === 401 || error.value?.statusCode === 403) {
  throw createError({ status: error.value.statusCode, statusText: 'Access denied' })
}
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-6 pb-24">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">
        Catálogos preventivos
      </h1>
      <p class="text-sm text-muted">
        Consulta administrativa de versiones. Ningún catálogo está aprobado para orientación clínica definitiva.
      </p>
    </div>
    <nav
      aria-label="Tipos de catálogo"
      class="flex flex-wrap gap-2"
    >
      <UButton
        v-for="kind in catalogKinds"
        :key="kind"
        :variant="selected === kind ? 'solid' : 'outline'"
        :aria-pressed="selected === kind"
        class="min-h-11"
        @click="selected = kind"
      >
        {{ labels[kind] }}
      </UButton>
    </nav>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudieron cargar los catálogos"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending'"
      class="space-y-3"
      aria-label="Cargando catálogos"
    >
      <USkeleton class="h-32 w-full" /><USkeleton class="h-32 w-full" />
    </div>
    <UCard v-else-if="!data?.versions.length">
      <p class="font-medium">
        Sin entradas verificadas para {{ labels[selected] }}
      </p>
      <p class="mt-2 text-sm text-muted">
        No hay entradas importadas. Los borradores no generan recordatorios.
      </p>
    </UCard>
    <section
      v-for="version in data?.versions"
      :key="version.id"
      class="min-w-0 space-y-4"
      :aria-label="`${version.title} · ${version.version}`"
    >
      <UCard class="min-w-0">
        <h2 class="text-lg font-semibold">
          {{ version.title }} · {{ version.version }}
        </h2>
        <UBadge
          v-if="version.superseded"
          color="neutral"
          variant="soft"
        >
          Versión anterior · solo historial
        </UBadge>
        <p class="mt-2 text-sm text-muted">
          {{ version.publisher }} · Publicado: {{ version.publicationDate || 'Fecha exacta no indicada' }} · Consultado: {{ version.retrievedAt }}
        </p>
        <p class="mt-1 break-all text-xs text-muted">
          SHA-256: {{ version.sha256 }}
        </p>
        <a
          :href="version.url"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-2 inline-block break-all text-sm text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
        >Ver fuente oficial</a>
      </UCard>
      <ul class="grid min-w-0 gap-3 lg:grid-cols-2">
        <li
          v-for="row in version.entries"
          :key="row.key"
          class="min-w-0"
        >
          <UCard class="h-full min-w-0">
            <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <h3 class="min-w-0 font-medium">
                {{ row.doseLabel || (row.doseNumber ? `${row.label} · dosis ${row.doseNumber} del producto` : row.label) }}
              </h3>
              <UBadge
                color="warning"
                variant="soft"
                class="max-w-full whitespace-normal"
              >
                {{ row.badge }}
              </UBadge>
            </div>
            <p class="mt-2 text-sm text-muted">
              {{ row.domain }} · {{ row.recommendedAge || `${row.minAgeMonths}–${row.maxAgeMonths} meses` }}{{ row.minimumInterval ? ` · Intervalo mínimo: ${row.minimumInterval}` : '' }} · Fuente: {{ row.sourcePage }}
            </p>
            <p
              v-if="row.provenance"
              class="mt-1 text-xs text-muted"
            >
              {{ row.provenance }}
            </p>
          </UCard>
        </li>
      </ul>
    </section>
  </UContainer>
</template>
