<script setup lang="ts">
import type { BookingRequestView } from '#shared/types/booking'

const { data: requests, error, refresh } = await useFetch<BookingRequestView[]>('/api/agenda/solicitudes', { default: () => [] })
const busy = ref('')
const message = ref('')
const dateFormat = new Intl.DateTimeFormat('es-EC', { dateStyle: 'long', timeZone: 'UTC' })
async function decide(id: string, decision: 'APPROVE' | 'DECLINE') {
  busy.value = id
  message.value = ''
  try {
    await $fetch(`/api/agenda/solicitudes/${id}`, { method: 'POST', body: { decision } })
    await refresh()
    message.value = decision === 'APPROVE' ? 'Cita aprobada.' : 'Solicitud rechazada.'
  } catch {
    message.value = 'No se pudo decidir la solicitud. Compruebe la disponibilidad y vuelva a intentarlo.'
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <UContainer class="max-w-3xl space-y-5 py-6 pb-24">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold">
        Solicitudes de citas
      </h1>
      <UButton
        to="/agenda"
        variant="outline"
      >
        Ver agenda
      </UButton>
    </div>
    <p class="text-sm text-muted">
      Las solicitudes requieren aprobación manual. Revise el horario antes de aprobar.
    </p>
    <p
      v-if="message"
      role="status"
      class="text-sm"
    >
      {{ message }}
    </p>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudieron cargar las solicitudes"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <UEmpty
      v-else-if="!requests?.length"
      title="Sin solicitudes pendientes"
    />
    <ul
      v-else
      class="space-y-3"
    >
      <li
        v-for="item in requests"
        :key="item.id"
      >
        <UCard class="min-w-0">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <h2 class="text-lg font-semibold">
              {{ item.childName }}
            </h2>
            <UBadge
              color="neutral"
              variant="soft"
            >
              Pendiente de aprobación
            </UBadge>
          </div>
          <p class="mt-2 text-sm tabular-nums">
            {{ dateFormat.format(new Date(`${item.date}T12:00:00Z`)) }} · {{ item.time }}
          </p>
          <p class="text-sm">
            Representante: {{ item.guardianName }} · {{ item.contact }}
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <UButton
              :disabled="!!busy"
              class="min-h-11"
              @click="decide(item.id, 'APPROVE')"
            >
              Aprobar
            </UButton>
            <UButton
              :disabled="!!busy"
              color="neutral"
              variant="outline"
              class="min-h-11"
              @click="decide(item.id, 'DECLINE')"
            >
              Rechazar
            </UButton>
          </div>
        </UCard>
      </li>
    </ul>
  </UContainer>
</template>
