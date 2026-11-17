<script setup lang="ts">
import type { AvailabilityInput } from '#shared/types/scheduling'

const { data: settings, error, refresh } = await useFetch<AvailabilityInput>('/api/agenda/horarios')
const days = [{ label: 'Lunes', weekday: 1 }, { label: 'Martes', weekday: 2 }, { label: 'Miércoles', weekday: 3 }, { label: 'Jueves', weekday: 4 }, { label: 'Viernes', weekday: 5 }, { label: 'Sábado', weekday: 6 }, { label: 'Domingo', weekday: 0 }]
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const hours = [...Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`), '23:59']
const blockedDate = ref('')
const blockedFrom = ref('00:00')
const blockedTo = ref('23:59')
const message = ref('')
function toggle(weekday: number, enabled: boolean) {
  if (!settings.value) return
  settings.value.days = settings.value.days.filter(day => day.weekday !== weekday)
  if (enabled) settings.value.days.push({ weekday, open: '08:00', close: '17:00' })
}
async function save() {
  if (!settings.value) return
  message.value = ''
  try {
    await $fetch('/api/agenda/horarios', { method: 'PUT', body: settings.value })
    message.value = 'Horarios guardados'
  } catch {
    message.value = 'No se pudieron guardar los horarios. Revise las horas.'
  }
}
function block() {
  if (!settings.value || !blockedDate.value || blockedFrom.value >= blockedTo.value) return
  settings.value.blocked.push({ date: blockedDate.value, from: blockedFrom.value, to: blockedTo.value })
  blockedDate.value = ''
}
</script>

<template>
  <UContainer class="max-w-none space-y-5 px-4 py-5 pb-24 sm:px-6 sm:py-6">
    <header class="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-default pb-4">
      <div class="flex items-center gap-3">
        <UButton
          to="/agenda"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Volver a agenda"
        /><h1 class="text-lg font-semibold">
          Horarios de atención
        </h1>
      </div>
      <UButton
        class="min-h-11"
        :disabled="!settings"
        @click="save"
      >
        Guardar horarios
      </UButton>
    </header>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudieron cargar los horarios"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-if="settings"
      class="grid min-w-0 max-w-[1180px] items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
    >
      <section
        class="min-w-0 overflow-clip rounded-xl border border-default bg-default"
        aria-label="Días y horas"
      >
        <div class="px-4 py-3">
          <h2 class="text-base font-semibold">
            Días y horas
          </h2><p class="text-xs text-muted">
            Definen las horas libres que ven los padres y la página pública de reservas.
          </p>
        </div>
        <div
          v-for="day in days"
          :key="day.weekday"
          class="grid min-h-16 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-t border-default px-4 py-2 sm:grid-cols-[5.375rem_minmax(0,1fr)_auto] sm:gap-x-3"
        >
          <strong class="min-w-0 text-sm">{{ day.label }}</strong>
          <div class="col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:gap-3">
            <template v-if="settings.days.find(item => item.weekday === day.weekday)">
              <label
                class="sr-only"
                :for="`open-${day.weekday}`"
              >{{ day.label }} desde</label>
              <select
                :id="`open-${day.weekday}`"
                v-model="settings.days.find(item => item.weekday === day.weekday)!.open"
                class="min-h-11 w-[6.875rem] max-w-[calc(50%-0.75rem)] min-w-0 rounded-lg border border-default bg-default px-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-primary"
              >
                <option v-if="!hours.includes(settings.days.find(item => item.weekday === day.weekday)!.open)">
                  {{ settings.days.find(item => item.weekday === day.weekday)!.open }}
                </option>
                <option
                  v-for="hour in hours"
                  :key="hour"
                >
                  {{ hour }}
                </option>
              </select>
              <span class="text-sm text-muted">a</span>
              <label
                class="sr-only"
                :for="`close-${day.weekday}`"
              >{{ day.label }} hasta</label>
              <select
                :id="`close-${day.weekday}`"
                v-model="settings.days.find(item => item.weekday === day.weekday)!.close"
                class="min-h-11 w-[6.875rem] max-w-[calc(50%-0.75rem)] min-w-0 rounded-lg border border-default bg-default px-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-primary"
              >
                <option v-if="!hours.includes(settings.days.find(item => item.weekday === day.weekday)!.close)">
                  {{ settings.days.find(item => item.weekday === day.weekday)!.close }}
                </option>
                <option
                  v-for="hour in hours"
                  :key="hour"
                >
                  {{ hour }}
                </option>
              </select>
            </template>
            <span
              v-else
              class="text-sm text-muted"
            >Cerrado</span>
          </div>
          <label class="col-start-2 row-start-1 flex min-h-11 cursor-pointer items-center sm:col-start-3"><span class="sr-only">Atender {{ day.label }}</span><input
            type="checkbox"
            role="switch"
            class="peer sr-only"
            :checked="settings.days.some(item => item.weekday === day.weekday)"
            @change="toggle(day.weekday, ($event.target as HTMLInputElement).checked)"
          ><span class="flex h-7 w-11 items-center rounded-full bg-elevated p-0.5 transition-colors after:size-5 after:rounded-full after:bg-default after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" /></label>
        </div>
      </section>
      <div class="min-w-0 space-y-5">
        <section class="rounded-xl border border-default bg-default p-4">
          <h2 class="text-base font-semibold">
            Duración de las citas
          </h2>
          <p class="mt-3 text-sm text-muted">
            Control y consulta
          </p>
          <div
            class="mt-2 grid grid-cols-5 gap-1 rounded-lg bg-elevated p-1"
            role="group"
            aria-label="Duración de control y consulta"
          >
            <button
              v-for="duration in [15, 20, 30, 45, 60]"
              :key="duration"
              type="button"
              class="min-h-11 rounded-md text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary sm:text-sm"
              :class="settings.durationMinutes === duration ? 'bg-default text-highlighted shadow-sm' : 'text-muted'"
              :aria-pressed="settings.durationMinutes === duration"
              @click="settings.durationMinutes = duration"
            >
              {{ duration }} min
            </button>
          </div>
        </section>
        <section
          class="overflow-clip rounded-xl border border-default bg-default"
          aria-label="Días bloqueados"
        >
          <div class="px-4 py-3">
            <h2 class="text-base font-semibold">
              Días bloqueados
            </h2><p class="text-xs text-muted">
              Feriados, vacaciones o congresos
            </p>
          </div>
          <ul class="divide-y divide-default border-t border-default">
            <li
              v-for="(blocked, index) in settings.blocked"
              :key="index"
              class="flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-2"
            >
              <span class="min-w-0 text-sm tabular-nums">{{ dateFormat.format(new Date(`${blocked.date}T12:00:00Z`)) }}<template v-if="blocked.from !== '00:00' || blocked.to !== '23:59'"> · {{ blocked.from }}–{{ blocked.to }}</template></span><UButton
                class="min-h-11 shrink-0"
                variant="outline"
                @click="settings.blocked.splice(index, 1)"
              >
                Quitar
              </UButton>
            </li>
          </ul>
          <div class="grid min-w-0 grid-cols-2 items-end gap-3 border-t border-default p-4 text-sm lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label class="col-span-2 flex min-w-0 flex-col gap-1 lg:col-span-1">Fecha
              <input
                v-model="blockedDate"
                type="date"
                class="min-h-11 w-full min-w-0 rounded-lg border border-default bg-default px-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-primary"
              >
            </label>
            <label class="flex min-w-0 flex-col gap-1">Desde
              <input
                v-model="blockedFrom"
                type="time"
                class="min-h-11 w-full min-w-0 rounded-lg border border-default bg-default px-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-primary"
              >
            </label>
            <label class="flex min-w-0 flex-col gap-1">Hasta
              <input
                v-model="blockedTo"
                type="time"
                class="min-h-11 w-full min-w-0 rounded-lg border border-default bg-default px-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-primary"
              >
            </label>
            <UButton
              class="col-span-2 min-h-11 justify-self-end lg:col-span-3"
              variant="outline"
              @click="block"
            >
              Bloquear
            </UButton>
          </div>
        </section>
        <p
          v-if="message"
          role="status"
        >
          {{ message }}
        </p>
      </div>
    </div>
  </UContainer>
</template>
