<script setup lang="ts">
import type { PendingControl } from '../../../server/services/controls-review'

const { data: controls, error, refresh } = await useFetch<PendingControl[]>('/api/clinical/controles-pendientes')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
</script>

<template>
  <UContainer class="max-w-4xl space-y-5 py-6 pb-24">
    <UButton
      to="/"
      variant="link"
      icon="i-lucide-arrow-left"
    >
      Inicio
    </UButton>
    <h1 class="text-2xl font-semibold">
      Controles pendientes
    </h1>
    <p class="text-sm text-muted">
      Controles vencidos sin cita; sujetos a revisión médica. Una reserva no registra un control completado.
    </p>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudieron cargar los controles"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <UEmpty
      v-else-if="!controls?.length"
      title="Sin controles pendientes"
    />
    <UCard v-else>
      <ul class="divide-y divide-default">
        <li
          v-for="person in controls"
          :key="person.id"
          class="py-3"
        >
          <NuxtLink
            :to="`/pacientes/${person.id}`"
            class="font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
          >{{ person.name }}</NuxtLink>
          <p class="text-sm">
            {{ person.reason }} · {{ person.date }}
          </p>
          <p class="text-xs text-muted">
            {{ person.badge }} · {{ person.source }}<template v-if="person.sourcePage">
              · {{ person.sourcePage }}
            </template>
          </p>
        </li>
      </ul>
    </UCard>
  </UContainer>
</template>
