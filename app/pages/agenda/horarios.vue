<script setup lang="ts">
import type { AvailabilityInput } from '#shared/types/scheduling'

const { data: settings, error, refresh } = await useFetch<AvailabilityInput>('/api/agenda/horarios')
const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const hours = Array.from({ length: 49 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`).filter(time => time < '24:00')
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
  <UContainer class="max-w-6xl space-y-5 py-6 pb-24">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">
        Horarios de atención
      </h1><UButton
        to="/agenda"
        variant="outline"
      >
        Volver a agenda
      </UButton>
    </div>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudieron cargar los horarios"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-if="settings"
      class="grid min-w-0 gap-5 lg:grid-cols-2"
    >
      <UCard class="min-w-0">
        <h2 class="mb-3 text-lg font-semibold">
          Días y horas
        </h2>
        <div
          v-for="(label, weekday) in days"
          :key="label"
          class="flex min-w-0 min-h-16 flex-wrap items-center gap-2 border-t border-default py-2"
        >
          <label class="flex min-h-11 min-w-28 items-center gap-2"><input
            type="checkbox"
            :checked="settings.days.some(day => day.weekday === weekday)"
            @change="toggle(weekday, ($event.target as HTMLInputElement).checked)"
          >{{ label }}</label>
          <template v-if="settings.days.find(day => day.weekday === weekday)">
            <label class="text-sm">Desde <select
              v-model="settings.days.find(day => day.weekday === weekday)!.open"
              class="min-h-11 rounded-md border border-default bg-default"
            ><option
              v-for="hour in hours"
              :key="hour"
            >{{ hour }}</option></select></label>
            <label class="text-sm">Hasta <select
              v-model="settings.days.find(day => day.weekday === weekday)!.close"
              class="min-h-11 rounded-md border border-default bg-default"
            ><option
              v-for="hour in hours"
              :key="hour"
            >{{ hour }}</option></select></label>
          </template>
          <span
            v-else
            class="text-sm text-muted"
          >Cerrado</span>
        </div>
      </UCard>
      <div class="min-w-0 space-y-5">
        <UCard>
          <h2 class="mb-3 text-lg font-semibold">
            Duración de las citas
          </h2><label>Minutos <select
            v-model.number="settings.durationMinutes"
            class="ml-2 min-h-11 rounded-md border border-default bg-default px-2"
          ><option
            v-for="duration in [15, 20, 30, 45, 60]"
            :key="duration"
            :value="duration"
          >{{ duration }} min</option></select></label>
        </UCard>
        <UCard>
          <h2 class="mb-3 text-lg font-semibold">
            Días bloqueados
          </h2>
          <ul class="divide-y divide-default">
            <li
              v-for="(blocked, index) in settings.blocked"
              :key="index"
              class="flex min-h-11 items-center justify-between gap-2"
            >
              <span>{{ blocked.date }} · {{ blocked.from }}–{{ blocked.to }}</span><UButton
                variant="outline"
                @click="settings.blocked.splice(index, 1)"
              >
                Quitar
              </UButton>
            </li>
          </ul>
          <div class="mt-3 flex min-w-0 flex-wrap gap-2">
            <label>Fecha <input
              v-model="blockedDate"
              type="date"
              class="min-h-11 rounded-md border border-default bg-default"
            ></label><label>Desde <input
              v-model="blockedFrom"
              type="time"
              class="min-h-11 rounded-md border border-default bg-default"
            ></label><label>Hasta <input
              v-model="blockedTo"
              type="time"
              class="min-h-11 rounded-md border border-default bg-default"
            ></label><UButton
              variant="outline"
              @click="block"
            >
              Bloquear
            </UButton>
          </div>
        </UCard>
        <p
          v-if="message"
          role="status"
        >
          {{ message }}
        </p><UButton
          class="min-h-11"
          @click="save"
        >
          Guardar horarios
        </UButton>
      </div>
    </div>
  </UContainer>
</template>
