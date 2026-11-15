<script setup lang="ts">
import type { FamilyChildView } from '../../../../server/services/invitations'

const id = useRoute().params.id as string
const { data: child, error, refresh } = await useFetch<FamilyChildView>(`/api/hijos/${encodeURIComponent(id)}`)
const dates = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const dateTime = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Guayaquil' })
const weight = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const size = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
</script>

<template>
  <UContainer class="max-w-4xl space-y-6 py-8 pb-24">
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
        Indicaciones de {{ child.name }}
      </h1>
      <UButton
        :to="`/hijos/${id}/crecimiento`"
        variant="outline"
        class="min-h-11"
      >
        Crecimiento
      </UButton>
      <UEmpty
        v-if="!child.visits.length"
        title="Aún no hay controles compartidos"
        description="Consulte con el equipo de la clínica."
      />
      <UCard
        v-for="(visit, index) in child.visits"
        :key="visit.measuredAt + index"
      >
        <h2 class="text-lg font-semibold">
          Control · {{ dates.format(new Date(visit.measuredAt)) }}
        </h2>
        <div class="mt-3 grid gap-2 text-sm sm:grid-cols-3 tabular-nums">
          <p>Peso: {{ weight.format(visit.weightKg) }} kg</p>
          <p>{{ visit.position === 'RECUMBENT' ? 'Longitud' : 'Talla' }}: {{ size.format(visit.lengthHeightCm) }} cm</p>
          <p>Perímetro cefálico: {{ size.format(visit.headCircumferenceCm) }} cm</p>
        </div>
        <div
          v-if="visit.parentAdvice"
          class="mt-4"
        >
          <h3 class="font-medium">
            Indicaciones de tu pediatra
          </h3>
          <p class="whitespace-pre-wrap text-sm">
            {{ visit.parentAdvice }}
          </p>
        </div>
        <p
          v-if="visit.nextControlAt"
          class="mt-3 text-sm"
        >
          Próximo control · {{ dateTime.format(new Date(visit.nextControlAt)) }}
        </p>
      </UCard>
    </template>
  </UContainer>
</template>
