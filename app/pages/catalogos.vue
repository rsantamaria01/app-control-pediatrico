<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { catalogKinds, doctorMilestoneSchema, type CatalogKind, type CatalogView, type DoctorMilestoneInput } from '#shared/types/catalog'

const selected = ref<CatalogKind>('VACCINE')
const labels: Record<CatalogKind, string> = { MOTOR: 'Hitos motores', MILESTONE: 'Hitos del desarrollo', SCREENING: 'Tamizajes', CHECKUP: 'Controles por edad', VACCINE: 'Vacunas MSP' }
const { data, error, status, refresh } = await useFetch<CatalogView>(() => `/api/catalogos/${selected.value}`, { watch: [selected] })
if (error.value?.statusCode === 401 || error.value?.statusCode === 403) throw createError({ status: error.value.statusCode, statusText: 'Acceso denegado' })
const adding = ref(false)
const saveError = ref(false)
const state = reactive({ label: '', domain: '', minAgeMonths: 0, maxAgeMonths: 0, source: '' })
async function save(event: FormSubmitEvent<DoctorMilestoneInput>) {
  saveError.value = false
  try {
    await $fetch('/api/catalogos/hitos', { method: 'POST', body: event.data })
    adding.value = false
    Object.assign(state, { label: '', domain: '', minAgeMonths: 0, maxAgeMonths: 0, source: '' })
    await refresh()
  } catch {
    saveError.value = true
  }
}
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-6 pb-24">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">
        Catálogos preventivos
      </h1>
      <p class="text-sm text-muted">
        Consulta clínica de borradores. No son recomendaciones ni generan recordatorios.
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
        @click="selected = kind; adding = false"
      >
        {{ labels[kind] }}
      </UButton>
    </nav>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudo cargar el catálogo"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending'"
      aria-label="Cargando catálogo"
    >
      <USkeleton class="h-32 w-full" />
    </div>
    <template v-else>
      <UCard v-if="selected === 'MILESTONE' && !data?.versions.length && !data?.doctorEntries?.length">
        <h2 class="font-medium">
          Aún no hay hitos del desarrollo registrados
        </h2>
        <p class="mt-2 text-sm text-muted">
          No se han importado hitos. Puede agregar una entrada propia para revisión.
        </p>
      </UCard>
      <UCard v-else-if="!data?.versions.length && selected !== 'MILESTONE'">
        <p class="font-medium">
          Sin entradas para {{ labels[selected] }}
        </p>
      </UCard>
      <template v-if="selected === 'MILESTONE'">
        <UButton
          class="min-h-11"
          @click="adding = !adding"
        >
          Agregar hito
        </UButton>
        <UCard v-if="adding">
          <UForm
            :schema="doctorMilestoneSchema"
            :state="state"
            class="space-y-4"
            @submit="save"
          >
            <UFormField
              label="Descripción"
              name="label"
            >
              <UInput
                v-model="state.label"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Área"
              name="domain"
            >
              <UInput
                v-model="state.domain"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Edad mínima (meses)"
              name="minAgeMonths"
            >
              <UInputNumber
                v-model="state.minAgeMonths"
                :min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Edad máxima (meses)"
              name="maxAgeMonths"
            >
              <UInputNumber
                v-model="state.maxAgeMonths"
                :min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Fuente indicada por la doctora"
              name="source"
            >
              <UInput
                v-model="state.source"
                class="w-full"
              />
            </UFormField>
            <UAlert
              v-if="saveError"
              color="error"
              title="No se pudo guardar. Inténtelo de nuevo."
            />
            <UButton
              type="submit"
              class="min-h-11"
            >
              Guardar borrador
            </UButton>
          </UForm>
        </UCard>
        <ul class="grid gap-3 lg:grid-cols-2">
          <li
            v-for="row in data?.doctorEntries"
            :key="row.id"
          >
            <UCard>
              <h2 class="font-medium">
                {{ row.label }}
              </h2>
              <UBadge
                color="warning"
                variant="soft"
                class="mt-2 whitespace-normal"
              >
                {{ row.badge }}
              </UBadge>
              <p class="mt-2 text-sm text-muted">
                {{ row.domain }} · {{ row.minAgeMonths }}–{{ row.maxAgeMonths }} meses · Fuente: {{ row.source }}
              </p>
            </UCard>
          </li>
        </ul>
      </template>
      <section
        v-for="version in data?.versions"
        :key="version.id"
        class="space-y-4"
        :aria-label="`${version.title} · ${version.version}`"
      >
        <UCard>
          <h2 class="text-lg font-semibold">
            {{ version.title }} · {{ version.version }}
          </h2>
          <p class="mt-2 text-sm text-muted">
            {{ version.publisher }} · Publicado: {{ version.publicationDate || 'Fecha exacta no indicada' }} · Consultado: {{ version.retrievedAt }}
          </p>
          <a
            :href="version.url"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 inline-block break-all text-sm text-primary underline"
          >Ver fuente oficial</a>
        </UCard>
        <ul class="grid gap-3 lg:grid-cols-2">
          <li
            v-for="row in version.entries"
            :key="row.key"
          >
            <UCard class="h-full min-w-0">
              <h3 class="font-medium">
                {{ row.doseLabel || (row.doseNumber ? `${row.label} · dosis ${row.doseNumber} del producto` : row.label) }}
              </h3>
              <UBadge
                color="warning"
                variant="soft"
                class="mt-2 max-w-full whitespace-normal"
              >
                {{ row.badge }}
              </UBadge>
              <p class="mt-2 text-sm text-muted">
                {{ row.recommendedAge || row.label }}{{ row.minimumInterval ? ` · intervalo mínimo: ${row.minimumInterval}` : '' }}
              </p>
              <p
                v-if="row.provenance"
                class="mt-2 text-xs text-muted"
              >
                {{ row.provenance }}
              </p>
              <p class="mt-2 break-words text-xs text-muted">
                Fuente: {{ row.sourcePage }}
              </p>
            </UCard>
          </li>
        </ul>
      </section>
    </template>
  </UContainer>
</template>
