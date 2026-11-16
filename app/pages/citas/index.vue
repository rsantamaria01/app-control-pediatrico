<script setup lang="ts">
import type { FamilyChildSummary } from '../../../server/services/invitations'
import type { ParentAppointment } from '#shared/types/booking'
import type { Slot } from '#shared/types/scheduling'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const { data: children, error: childrenError, refresh: refreshChildren } = await useFetch<FamilyChildSummary[]>('/api/hijos', { default: () => [] })
const { data: items, error, refresh } = await useFetch<ParentAppointment[]>('/api/citas', { default: () => [] })
const form = reactive({ patientId: '', date: today, time: '', consent: false })
const { data: slots, error: slotsError, refresh: refreshSlots } = await useFetch<Slot[]>('/api/reservar/horarios', { query: computed(() => ({ from: form.date, to: form.date })), default: () => [] })
const message = ref('')
const busy = ref(false)
const dateFormat = new Intl.DateTimeFormat('es-EC', { dateStyle: 'long', timeZone: 'UTC' })
async function submit() {
  message.value = ''
  busy.value = true
  try {
    await $fetch('/api/citas', { method: 'POST', body: { ...form, consentVersion: 'DRAFT-2026-11' } })
    message.value = 'Solicitud enviada. Pendiente de aprobación; aún no es una cita confirmada.'
    form.time = ''
    await refresh()
    await refreshSlots()
  } catch {
    message.value = 'No se pudo enviar la solicitud. Revise el horario y los datos.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-2xl space-y-5 py-6 pb-24">
    <h1 class="text-2xl font-semibold">
      Citas
    </h1>
    <UAlert
      v-if="error || childrenError"
      color="error"
      title="No se pudieron consultar las citas"
      :actions="[{ label: 'Reintentar', onClick: () => { refresh(); refreshChildren() } }]"
    />
    <p
      v-if="message"
      role="status"
      class="text-sm"
    >
      {{ message }}
    </p>
    <UCard v-if="children?.length">
      <h2 class="mb-4 text-lg font-semibold">
        Solicitar cita
      </h2>
      <form
        class="space-y-4"
        @submit.prevent="submit"
      >
        <label
          class="block text-sm font-medium"
          for="booking-child"
        >¿Para quién?</label>
        <select
          id="booking-child"
          v-model="form.patientId"
          required
          class="min-h-11 w-full rounded-md border border-default bg-default px-3 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <option value="">
            Seleccione un hijo/a
          </option>
          <option
            v-for="child in children"
            :key="child.id"
            :value="child.id"
          >
            {{ child.name }}
          </option>
        </select>
        <label
          class="block text-sm font-medium"
          for="parent-date"
        >Fecha</label>
        <input
          id="parent-date"
          v-model="form.date"
          type="date"
          :min="today"
          required
          class="min-h-11 w-full rounded-md border border-default bg-default px-3 focus-visible:outline-2 focus-visible:outline-primary"
        >
        <UAlert
          v-if="slotsError"
          color="error"
          title="No se pudieron consultar los horarios"
          :actions="[{ label: 'Reintentar', onClick: () => refreshSlots() }]"
        />
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">
            Horarios libres
          </legend>
          <div class="grid grid-cols-3 gap-2">
            <label
              v-for="slot in slots"
              :key="slot.time"
              class="flex min-h-11 items-center justify-center rounded-md border border-default px-2 focus-within:outline-2 focus-within:outline-primary has-checked:border-primary has-checked:bg-primary/10"
            >
              <input
                v-model="form.time"
                type="radio"
                name="parent-time"
                :value="slot.time"
                required
                class="sr-only"
              >{{ slot.time }}
            </label>
          </div>
          <p
            v-if="!slots?.length"
            class="text-sm text-muted"
          >
            No hay horarios libres este día.
          </p>
        </fieldset>
        <label class="flex min-h-11 items-start gap-3 text-sm"><input
          v-model="form.consent"
          type="checkbox"
          required
          class="mt-1 size-5"
        >Acepto el tratamiento de los datos necesarios para solicitar esta cita. Texto de privacidad y consentimiento en borrador, pendiente de revisión legal.</label>
        <UButton
          type="submit"
          :loading="busy"
          :disabled="!form.time || !form.patientId || !form.consent"
          class="min-h-11 w-full justify-center"
        >
          Enviar solicitud
        </UButton>
        <p class="text-sm text-muted">
          La clínica revisará la solicitud. No se envía ningún correo de confirmación desde esta pantalla.
        </p>
      </form>
    </UCard>
    <UEmpty
      v-else-if="!childrenError"
      title="Aún no hay niños vinculados"
      description="La clínica debe verificar el vínculo familiar antes de solicitar una cita desde el portal."
    />
    <section
      class="space-y-3"
      aria-label="Estado de mis citas"
    >
      <h2 class="text-lg font-semibold">
        Mis solicitudes
      </h2>
      <UEmpty
        v-if="!items?.length"
        title="Sin solicitudes"
      />
      <UCard
        v-for="item in items"
        :key="item.id"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h3 class="font-semibold">
            {{ item.name }}
          </h3><UBadge
            color="neutral"
            variant="soft"
          >
            {{ { PENDING: 'Pendiente de aprobación', APPROVED: 'Aprobada', DECLINED: 'Rechazada', RESCHEDULED: 'Reprogramada', CANCELLED: 'Cancelada', ATTENDED: 'Atendida' }[item.status] }}
          </UBadge>
        </div>
        <p class="mt-2 text-sm tabular-nums">
          {{ dateFormat.format(new Date(`${item.date}T12:00:00Z`)) }} · {{ item.time }}
        </p>
        <p
          v-if="item.status === 'PENDING' || item.status === 'DECLINED'"
          class="mt-2 text-sm text-muted"
        >
          {{ item.status === 'PENDING' ? 'La clínica aún no ha aprobado esta cita.' : 'La solicitud no fue aprobada; puede solicitar otro horario.' }}
        </p>
      </UCard>
    </section>
  </UContainer>
</template>
