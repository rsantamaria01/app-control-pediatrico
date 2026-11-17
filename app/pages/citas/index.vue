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
const monthFormat = new Intl.DateTimeFormat('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const selectedDate = computed(() => new Date(`${form.date}T12:00:00Z`))
const month = ref(today.slice(0, 7))
const monthLabel = computed(() => monthFormat.format(new Date(`${month.value}-01T12:00:00Z`)))
const calendarDays = computed(() => {
  const [year, number] = month.value.split('-').map(Number)
  const firstDay = new Date(Date.UTC(year!, number! - 1, 1)).getUTCDay()
  const count = new Date(Date.UTC(year!, number!, 0)).getUTCDate()
  return [...Array((firstDay + 6) % 7).fill(null), ...Array.from({ length: count }, (_, index) => `${month.value}-${String(index + 1).padStart(2, '0')}`)] as (string | null)[]
})
function changeMonth(offset: number) {
  const [year, number] = month.value.split('-').map(Number)
  month.value = new Date(Date.UTC(year!, number! - 1 + offset, 1)).toISOString().slice(0, 7)
}
watch(() => form.date, (date) => {
  form.time = ''
  if (date && /^\d{4}-\d{2}/.test(date)) month.value = date.slice(0, 7)
})
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
  <UContainer class="max-w-5xl space-y-5 py-5 pb-24 sm:py-7 lg:pb-8">
    <div class="flex items-center gap-2">
      <UButton
        to="/"
        icon="i-lucide-chevron-left"
        variant="ghost"
        color="neutral"
        aria-label="Volver al inicio"
        class="min-h-11 lg:hidden"
      />
      <h1 class="text-2xl font-bold tracking-tight">
        Citas
      </h1>
    </div>
    <UAlert
      v-if="error || childrenError"
      color="error"
      variant="soft"
      title="No se pudieron consultar las citas"
      :actions="[{ label: 'Reintentar', onClick: () => { refresh(); refreshChildren() } }]"
    />
    <p
      v-if="message"
      role="status"
      class="rounded-xl border border-default bg-default p-4 text-sm"
    >
      {{ message }}
    </p>
    <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <UCard
        v-if="children?.length"
        :ui="{ body: 'p-4 sm:p-5' }"
      >
        <h2 class="mb-4 text-lg font-semibold">
          Solicitar cita
        </h2>
        <form
          class="space-y-5"
          @submit.prevent="submit"
        >
          <fieldset>
            <legend class="mb-2 text-sm font-medium">
              ¿Para quién?
            </legend>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="child in children"
                :key="child.id"
                class="flex min-h-11 min-w-24 flex-1 cursor-pointer items-center justify-center rounded-lg border border-default px-4 text-sm font-semibold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary"
              >
                <input
                  v-model="form.patientId"
                  type="radio"
                  name="booking-child"
                  :value="child.id"
                  required
                  class="sr-only"
                >{{ child.name }}
              </label>
            </div>
          </fieldset>
          <div class="rounded-xl border border-default p-3 sm:p-4">
            <div class="mb-2 flex items-center justify-between gap-2">
              <UButton
                type="button"
                icon="i-lucide-chevron-left"
                variant="ghost"
                color="neutral"
                aria-label="Mes anterior"
                class="min-h-11"
                :disabled="month <= today.slice(0, 7)"
                @click="changeMonth(-1)"
              />
              <h3 class="font-semibold capitalize">
                {{ monthLabel }}
              </h3>
              <UButton
                type="button"
                icon="i-lucide-chevron-right"
                variant="ghost"
                color="neutral"
                aria-label="Mes siguiente"
                class="min-h-11"
                @click="changeMonth(1)"
              />
            </div>
            <div
              class="grid grid-cols-7 text-center text-xs font-semibold text-muted"
              aria-hidden="true"
            >
              <span
                v-for="weekday in ['L', 'M', 'X', 'J', 'V', 'S', 'D']"
                :key="weekday"
                class="py-2"
              >{{ weekday }}</span>
            </div>
            <div class="grid grid-cols-7 gap-1 text-center">
              <template
                v-for="(day, index) in calendarDays"
                :key="day ?? `empty-${index}`"
              >
                <span
                  v-if="!day"
                  aria-hidden="true"
                />
                <button
                  v-else
                  type="button"
                  :disabled="day < today"
                  :aria-label="dateFormat.format(new Date(`${day}T12:00:00Z`))"
                  :aria-pressed="form.date === day"
                  class="min-h-11 rounded-lg text-sm tabular-nums hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 disabled:hover:bg-transparent"
                  :class="form.date === day ? 'bg-primary font-semibold text-inverted hover:bg-primary' : ''"
                  @click="form.date = day"
                >
                  {{ Number(day.slice(-2)) }}
                </button>
              </template>
            </div>
          </div>
          <div>
            <label
              for="parent-date"
              class="mb-2 block text-sm font-medium"
            >Fecha seleccionada</label>
            <input
              id="parent-date"
              v-model="form.date"
              type="date"
              :min="today"
              required
              class="min-h-11 w-full rounded-lg border border-default bg-default px-3 focus-visible:outline-2 focus-visible:outline-primary"
            >
          </div>
          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">
              {{ dateFormat.format(selectedDate) }} · horarios libres
            </legend>
            <UAlert
              v-if="slotsError"
              color="error"
              variant="soft"
              title="No se pudieron consultar los horarios"
              :actions="[{ label: 'Reintentar', onClick: () => refreshSlots() }]"
            />
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <label
                v-for="slot in slots"
                :key="slot.time"
                class="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-default px-2 text-sm font-semibold tabular-nums focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary has-checked:border-primary has-checked:bg-primary has-checked:text-inverted"
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
              v-if="!slots?.length && !slotsError"
              class="text-sm text-muted"
            >
              No hay horarios libres este día.
            </p>
          </fieldset>
          <label class="flex min-h-11 items-start gap-3 rounded-lg bg-elevated p-3 text-sm"><input
            v-model="form.consent"
            type="checkbox"
            required
            class="mt-0.5 size-5 shrink-0"
          >Acepto el tratamiento de los datos necesarios para solicitar esta cita. Texto de privacidad y consentimiento en borrador, pendiente de revisión legal.</label>
          <p class="text-sm text-muted">
            La clínica revisará la solicitud. No se envía ningún correo de confirmación desde esta pantalla.
          </p>
          <UButton
            type="submit"
            :loading="busy"
            :disabled="!form.time || !form.patientId || !form.consent"
            class="min-h-11 w-full justify-center"
          >
            Enviar solicitud{{ form.time ? ` · ${form.time}` : '' }}
          </UButton>
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
          :ui="{ body: 'p-4 sm:p-5' }"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <h3 class="font-semibold">
              {{ item.name }}
            </h3>
            <UBadge
              color="neutral"
              variant="soft"
            >
              {{ { PENDING: 'Pendiente de aprobación', APPROVED: 'Aprobada', DECLINED: 'Rechazada', RESCHEDULED: 'Reprogramada', CANCELLED: 'Cancelada', ATTENDED: 'Atendida' }[item.status] }}
            </UBadge>
          </div>
          <dl class="mt-3 divide-y divide-default text-sm tabular-nums">
            <div class="flex justify-between gap-3 py-2">
              <dt class="text-muted">
                Fecha
              </dt><dd class="text-right font-medium">
                {{ dateFormat.format(new Date(`${item.date}T12:00:00Z`)) }}
              </dd>
            </div>
            <div class="flex justify-between gap-3 py-2">
              <dt class="text-muted">
                Hora
              </dt><dd class="font-medium">
                {{ item.time }}
              </dd>
            </div>
          </dl>
          <p
            v-if="item.status === 'PENDING' || item.status === 'DECLINED'"
            class="mt-2 text-sm text-muted"
          >
            {{ item.status === 'PENDING' ? 'La clínica aún no ha aprobado esta cita.' : 'La solicitud no fue aprobada; puede solicitar otro horario.' }}
          </p>
        </UCard>
      </section>
    </div>
  </UContainer>
</template>
