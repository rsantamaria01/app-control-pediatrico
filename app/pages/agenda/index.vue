<script setup lang="ts">
import type { Appointment, Slot } from '#shared/types/scheduling'

const route = useRoute()
const vista = computed(() => ['dia', 'semana', 'mes'].includes(String(route.query.vista)) ? String(route.query.vista) : 'dia')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const selected = ref(typeof route.query.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.fecha) ? route.query.fecha : today)
const range = computed(() => {
  const date = new Date(`${selected.value}T12:00:00Z`)
  if (vista.value === 'semana') {
    const weekday = (date.getUTCDay() + 6) % 7
    date.setUTCDate(date.getUTCDate() - weekday)
    const from = date.toISOString().slice(0, 10)
    date.setUTCDate(date.getUTCDate() + 6)
    return { from, to: date.toISOString().slice(0, 10) }
  }
  if (vista.value === 'mes') {
    const from = `${selected.value.slice(0, 7)}-01`
    return { from, to: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) }
  }
  return { from: selected.value, to: selected.value }
})
const { data: items, error, refresh } = await useFetch<Appointment[]>('/api/agenda', { query: range, default: () => [] })
const form = reactive({ date: selected.value, time: '', name: '', contact: '', reason: '', patientId: '' })
const { data: slots, refresh: refreshSlots } = await useFetch<Slot[]>('/api/agenda/disponibilidad', { query: computed(() => ({ from: form.date, to: form.date })), default: () => [] })
const { data: navigation } = await useFetch<{ label: string, to: string }[]>('/api/auth/navigation')
const isDoctor = computed(() => navigation.value?.some(item => item.to === '/pacientes'))
const newOpen = ref(false)
const detail = ref<Appointment | null>(null)
const message = ref('')
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (date: string) => dateFormat.format(new Date(`${date}T12:00:00Z`))
const days = computed(() => {
  const dates: string[] = []
  for (let date = Date.parse(`${range.value.from}T00:00:00Z`); date <= Date.parse(`${range.value.to}T00:00:00Z`); date += 86400000) dates.push(new Date(date).toISOString().slice(0, 10))
  return dates
})
function step(direction: number) {
  const date = new Date(`${selected.value}T12:00:00Z`)
  if (vista.value === 'mes') date.setUTCMonth(date.getUTCMonth() + direction)
  else date.setUTCDate(date.getUTCDate() + direction * (vista.value === 'semana' ? 7 : 1))
  selected.value = date.toISOString().slice(0, 10)
}
async function save() {
  message.value = ''
  try {
    await $fetch('/api/agenda', { method: 'POST', body: { date: form.date, time: form.time, name: form.name, contact: form.contact, reason: form.reason, ...(form.patientId ? { patientId: form.patientId } : {}) } })
    newOpen.value = false
    await refresh()
    await refreshSlots()
  } catch {
    message.value = 'No se pudo guardar la cita. Verifique los datos y el horario disponible.'
  }
}
async function move() {
  if (!detail.value) return
  message.value = ''
  try {
    await $fetch(`/api/agenda/${detail.value.id}`, { method: 'PATCH', body: { date: form.date, time: form.time } })
    detail.value = null
    await refresh()
    await refreshSlots()
  } catch {
    message.value = 'No se pudo reprogramar la cita. Seleccione otra hora libre.'
  }
}
async function cancel() {
  if (!detail.value || !confirm('¿Cancelar esta cita?')) return
  await $fetch(`/api/agenda/${detail.value.id}`, { method: 'DELETE' })
  detail.value = null
  await refresh()
  await refreshSlots()
}
function openDetail(item: Appointment) {
  detail.value = item
  form.date = item.date
  form.time = ''
}
</script>

<template>
  <UContainer class="max-w-6xl space-y-5 py-6 pb-24">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">
        Agenda
      </h1>
      <div class="flex gap-2">
        <UButton
          to="/agenda/horarios"
          variant="outline"
        >
          Horarios
        </UButton>
        <UButton
          icon="i-lucide-plus"
          @click="newOpen = true; form.date = selected; form.time = ''"
        >
          Nueva cita
        </UButton>
      </div>
    </div>
    <nav
      aria-label="Vista de la agenda"
      class="grid grid-cols-3 gap-2 rounded-lg bg-elevated p-1 sm:max-w-sm"
    >
      <NuxtLink
        v-for="view in [{ key: 'dia', label: 'Día' }, { key: 'semana', label: 'Semana' }, { key: 'mes', label: 'Mes' }]"
        :key="view.key"
        :to="{ query: { ...route.query, vista: view.key } }"
        :aria-current="vista === view.key ? 'page' : undefined"
        class="flex min-h-11 items-center justify-center rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary"
        :class="vista === view.key ? 'bg-default text-highlighted shadow-sm' : 'text-muted'"
      >{{ view.label }}</NuxtLink>
    </nav>
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        aria-label="Fecha anterior"
        icon="i-lucide-chevron-left"
        variant="outline"
        @click="step(-1)"
      />
      <label
        class="font-medium"
        for="agenda-date"
      >Fecha</label>
      <input
        id="agenda-date"
        v-model="selected"
        aria-label="Seleccionar fecha"
        type="date"
        class="min-h-11 rounded-md border border-default bg-default px-2 focus-visible:outline-2 focus-visible:outline-primary"
      >
      <UButton
        aria-label="Fecha siguiente"
        icon="i-lucide-chevron-right"
        variant="outline"
        @click="step(1)"
      />
    </div>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudo cargar la agenda"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else
      :class="vista === 'semana' ? 'grid gap-3 lg:grid-cols-7' : vista === 'mes' ? 'grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7' : 'space-y-3'"
    >
      <UCard
        v-for="day in days"
        :key="day"
        class="min-w-0"
      >
        <button
          v-if="vista !== 'dia'"
          type="button"
          class="mb-3 min-h-11 text-left font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
          @click="selected = day; navigateTo({ query: { vista: 'dia', fecha: day } })"
        >
          {{ dayLabel(day) }}
        </button>
        <h2
          v-else
          class="mb-3 text-lg font-semibold"
        >
          {{ dayLabel(day) }}
        </h2>
        <ul
          v-if="items?.some(item => item.date === day)"
          class="divide-y divide-default"
        >
          <li
            v-for="item in items.filter(entry => entry.date === day)"
            :key="item.id"
            class="py-2"
          >
            <button
              type="button"
              class="flex min-h-11 w-full flex-wrap items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
              @click="openDetail(item)"
            >
              <strong class="tabular-nums">{{ item.time }}</strong><span>{{ item.name }}</span><UBadge
                color="neutral"
                variant="soft"
              >
                {{ item.status }}
              </UBadge>
            </button>
          </li>
        </ul>
        <p
          v-else
          class="text-sm text-muted"
        >
          Sin citas
        </p>
      </UCard>
    </div>
    <UModal
      v-model:open="newOpen"
      title="Nueva cita"
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="save"
        >
          <UAlert
            v-if="message"
            color="error"
            :title="message"
          />
          <UFormField
            label="Nombre"
            required
          >
            <UInput
              v-model="form.name"
              required
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Contacto"
            required
          >
            <UInput
              v-model="form.contact"
              required
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Motivo"
            required
          >
            <UInput
              v-model="form.reason"
              required
              class="w-full"
            />
          </UFormField>
          <UFormField
            v-if="isDoctor"
            label="ID de paciente registrado (opcional)"
          >
            <UInput
              v-model="form.patientId"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Día">
            <input
              v-model="form.date"
              type="date"
              required
              class="min-h-11 w-full rounded-md border border-default bg-default px-2"
            >
          </UFormField>
          <UFormField label="Hora libre">
            <select
              v-model="form.time"
              required
              class="min-h-11 w-full rounded-md border border-default bg-default px-2"
            >
              <option value="">
                Seleccione hora
              </option><option
                v-for="slot in slots?.filter(item => item.free)"
                :key="slot.time"
                :value="slot.time"
              >
                {{ slot.time }}
              </option>
            </select>
          </UFormField>
          <UButton
            type="submit"
            class="min-h-11"
          >
            Guardar cita
          </UButton>
        </form>
      </template>
    </UModal>
    <UModal
      :open="Boolean(detail)"
      title="Cita"
      @update:open="value => { if (!value) detail = null }"
    >
      <template #body>
        <div
          v-if="detail"
          class="space-y-4"
        >
          <h2 class="text-lg font-semibold">
            {{ detail.name }}
          </h2>
          <p>{{ dayLabel(detail.date) }} · {{ detail.time }} · {{ detail.status }}</p>
          <p v-if="detail.reason">
            {{ detail.reason }}
          </p>
          <UButton
            v-if="isDoctor && detail.patientId"
            :to="`/pacientes/${detail.patientId}`"
            variant="outline"
          >
            Abrir ficha
          </UButton>
          <template v-if="detail.status !== 'CANCELLED' && detail.status !== 'ATTENDED'">
            <UAlert
              v-if="message"
              color="error"
              :title="message"
            />
            <UFormField label="Reprogramar · día">
              <input
                v-model="form.date"
                type="date"
                class="min-h-11 w-full rounded-md border border-default bg-default px-2"
              >
            </UFormField>
            <UFormField label="Hora libre">
              <select
                v-model="form.time"
                class="min-h-11 w-full rounded-md border border-default bg-default px-2"
              >
                <option value="">
                  Seleccione hora
                </option><option
                  v-for="slot in slots?.filter(item => item.free)"
                  :key="slot.time"
                  :value="slot.time"
                >
                  {{ slot.time }}
                </option>
              </select>
            </UFormField>
            <div class="flex flex-wrap gap-2">
              <UButton
                :disabled="!form.time"
                @click="move"
              >
                Guardar cambio
              </UButton><UButton
                color="error"
                variant="outline"
                @click="cancel"
              >
                Cancelar cita
              </UButton>
            </div>
          </template>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
