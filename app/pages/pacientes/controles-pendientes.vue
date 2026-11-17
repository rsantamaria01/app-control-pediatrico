<script setup lang="ts">
import type { PendingControl } from '../../../server/services/controls-review'

const { data: controls, status, error, refresh } = await useFetch<PendingControl[]>('/api/clinical/controles-pendientes')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
</script>

<template>
  <UContainer class="max-w-4xl space-y-4 px-4 py-4 pb-24 sm:px-6 sm:py-6">
    <div class="flex items-center gap-2">
      <UButton
        to="/"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
        aria-label="Volver a inicio"
        class="min-h-11 min-w-11 shrink-0"
      />
      <h1 class="text-lg font-semibold sm:text-2xl">
        Controles pendientes
      </h1>
    </div>
    <p class="text-sm text-muted">
      Controles vencidos sin control completado; sujetos a revisión médica. Una reserva no registra un control completado.
    </p>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudieron cargar los controles"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending'"
      class="space-y-2"
      aria-label="Cargando controles pendientes"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-20 w-full"
      />
    </div>
    <UEmpty
      v-else-if="!controls?.length"
      icon="i-lucide-calendar-clock"
      title="Sin controles pendientes"
    />
    <section
      v-else
      aria-label="Pacientes con controles pendientes"
    >
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Pacientes · {{ controls?.length }}
      </p>
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <ul class="divide-y divide-default">
          <li
            v-for="person in controls"
            :key="person.id"
          >
            <NuxtLink
              :to="`/pacientes/${person.id}`"
              class="flex min-h-20 items-center gap-3 px-3 py-2 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-4"
            >
              <UAvatar
                :text="person.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()"
                size="md"
                class="shrink-0"
              />
              <span class="min-w-0 flex-1">
                <span class="block font-semibold leading-snug">{{ person.name }}</span>
                <span class="block text-sm">{{ person.reason }} · {{ person.date }}</span>
                <span class="block text-xs text-muted">{{ person.badge }} · {{ person.source }}<template v-if="person.sourcePage"> · {{ person.sourcePage }}</template></span>
              </span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-muted"
                aria-hidden="true"
              />
            </NuxtLink>
          </li>
        </ul>
      </UCard>
    </section>
  </UContainer>
</template>
