<script setup lang="ts">
import type { Appointment, Slot, AvailabilityInput } from '#shared/types/scheduling'
import type { BookingRequestView } from '#shared/types/booking'

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
const { data: requests } = await useFetch<BookingRequestView[]>('/api/agenda/solicitudes', { default: () => [] })
const { data: availability } = await useFetch<AvailabilityInput>('/api/agenda/horarios')
const isDoctor = computed(() => navigation.value?.some(item => item.to === '/pacientes'))
const newOpen = ref(false)
const detail = ref<Appointment | null>(null)
const message = ref('')
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = (date: string) => dateFormat.format(new Date(`${date}T12:00:00Z`))
const shortDay = new Intl.DateTimeFormat('es-EC', { weekday: 'short', timeZone: 'UTC' })
const monthLabel = computed(() => new Intl.DateTimeFormat('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${range.value.from}T12:00:00Z`)))
const periodLabel = computed(() => vista.value === 'mes' ? monthLabel.value : vista.value === 'semana' ? `${Number(range.value.from.slice(8))} – ${dayLabel(range.value.to)}` : dayLabel(selected.value))
const appointmentsFor = (day: string) => items.value?.filter(item => item.date === day).sort((a, b) => a.time.localeCompare(b.time)) ?? []
const calendarDays = computed(() => {
  const first = new Date(`${range.value.from}T12:00:00Z`)
  const offset = (first.getUTCDay() + 6) % 7
  return [...Array(offset).fill(''), ...days.value]
})
const hourMarks = Array.from({ length: 10 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`)
const appointmentTop = (time: string) => {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return Math.max(0, Math.min(496, (hour - 8 + minute / 60) * 56 + 2))
}
const statusLabel = (status: string) => ({ PENDING: 'Por confirmar', CONFIRMED: 'Confirmada', ATTENDED: 'Atendida', CANCELLED: 'Cancelada' })[status as 'PENDING' | 'CONFIRMED' | 'ATTENDED' | 'CANCELLED'] ?? status
const days = computed(() => {
  const dates: string[] = []
  for (let date = Date.parse(`${range.value.from}T00:00:00Z`); date <= Date.parse(`${range.value.to}T00:00:00Z`); date += 86400000) dates.push(new Date(date).toISOString().slice(0, 10))
  return dates
})
function step(direction: number) {
  const date = new Date(`${selected.value}T12:00:00Z`)
  if (vista.value === 'mes') {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + direction + 1, 0, 12))
    target.setUTCDate(Math.min(date.getUTCDate(), target.getUTCDate()))
    date.setTime(target.getTime())
  } else date.setUTCDate(date.getUTCDate() + direction * (vista.value === 'semana' ? 7 : 1))
  selected.value = date.toISOString().slice(0, 10)
}
async function save() {
  message.value = ''
  try {
    await $fetch('/api/agenda', { method: 'POST', body: { date: form.date, time: form.time, name: form.name, contact: form.contact, ...(isDoctor.value ? { reason: form.reason, ...(form.patientId ? { patientId: form.patientId } : {}) } : {}) } })
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
async function changeStatus(action: 'confirmar' | 'atender') {
  if (!detail.value) return
  message.value = ''
  try {
    await $fetch(`/api/agenda/${detail.value.id}/${action}`, { method: 'POST' })
    detail.value = null
    await refresh()
  } catch {
    message.value = 'No se pudo actualizar el estado de la cita. Recargue la agenda y vuelva a intentarlo.'
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
  <UContainer class="max-w-none space-y-5 px-4 py-4 pb-24 sm:px-6">
    <header class="flex flex-wrap items-center gap-3 border-b border-default pb-4">
      <h1 class="text-lg font-semibold">
        Agenda
      </h1>
      <nav
        aria-label="Vista de la agenda"
        class="order-3 grid w-full grid-cols-3 gap-0.5 rounded-lg bg-elevated p-1 sm:order-none sm:w-auto"
      >
        <NuxtLink
          v-for="view in [{ key: 'dia', label: 'Día' }, { key: 'semana', label: 'Semana' }, { key: 'mes', label: 'Mes' }]"
          :key="view.key"
          :to="{ query: { ...route.query, vista: view.key } }"
          :aria-current="vista === view.key ? 'page' : undefined"
          class="flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary"
          :class="vista === view.key ? 'bg-default text-highlighted shadow-sm' : 'text-muted'"
        >{{ view.label }}</NuxtLink>
      </nav>
      <div class="order-4 flex w-full items-center justify-between gap-1 sm:order-none sm:w-auto">
        <UButton
          aria-label="Fecha anterior"
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          @click="step(-1)"
        />
        <label
          for="agenda-date"
          class="relative cursor-pointer text-center text-sm font-semibold capitalize focus-within:outline-2 focus-within:outline-primary"
        >
          {{ periodLabel }}
          <input
            id="agenda-date"
            v-model="selected"
            aria-label="Seleccionar fecha"
            type="date"
            class="absolute inset-0 w-full cursor-pointer opacity-0"
          >
        </label>
        <UButton
          aria-label="Fecha siguiente"
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          @click="step(1)"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          class="hidden sm:inline-flex"
          @click="selected = today"
        >
          Hoy
        </UButton>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <UButton
          to="/agenda/solicitudes"
          color="neutral"
          variant="outline"
          class="hidden lg:inline-flex"
        >
          Solicitudes
        </UButton>
        <UButton
          to="/agenda/horarios"
          icon="i-lucide-sliders-horizontal"
          color="neutral"
          variant="outline"
          class="hidden sm:inline-flex"
        >
          Horarios
        </UButton>
        <UButton
          icon="i-lucide-plus"
          @click="newOpen = true; form.date = selected; form.time = ''"
        >
          <span class="hidden sm:inline">Nueva cita</span><span class="sm:hidden">Cita</span>
        </UButton>
      </div>
    </header>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo cargar la agenda"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else
      class="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div class="min-w-0 space-y-3">
        <div class="flex items-center justify-between gap-2 sm:hidden">
          <NuxtLink
            to="/agenda/horarios"
            class="flex min-h-11 items-center gap-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary"
          ><UIcon name="i-lucide-sliders-horizontal" /> Horarios</NuxtLink>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            @click="selected = today"
          >
            Hoy
          </UButton>
        </div>
        <NuxtLink
          v-if="requests?.length"
          to="/agenda/solicitudes"
          class="flex min-h-12 items-center gap-2 rounded-xl border border-default bg-default px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary sm:hidden"
        >
          <UBadge
            color="warning"
            variant="soft"
          >{{ requests.length }}</UBadge> Solicitudes pendientes <UIcon
            name="i-lucide-chevron-right"
            class="ml-auto"
          />
        </NuxtLink>
        <section
          v-if="vista === 'mes'"
          aria-label="Mes"
          class="rounded-xl border border-default bg-default p-3 sm:p-4"
        >
          <div class="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted sm:gap-1.5">
            <span
              v-for="weekday in ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']"
              :key="weekday"
            >{{ weekday }}</span>
          </div>
          <div class="mt-1.5 grid grid-cols-7 gap-1 sm:gap-1.5">
            <div
              v-for="(day, index) in calendarDays"
              :key="day || `empty-${index}`"
              class="min-w-0"
            >
              <button
                v-if="day"
                type="button"
                class="flex min-h-12 w-full flex-col items-center justify-center rounded-lg border border-default bg-default p-1 text-sm hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary sm:min-h-24 sm:items-start sm:justify-between sm:p-2"
                :class="day === selected ? 'border-primary' : day === today ? 'bg-primary/5' : ''"
                @click="selected = day; navigateTo({ query: { vista: 'dia', fecha: day } })"
              >
                <strong>{{ Number(day.slice(8)) }}</strong><span class="text-xs font-semibold text-primary">{{ appointmentsFor(day).length || '' }}<span class="hidden sm:inline"> {{ appointmentsFor(day).length === 1 ? 'cita' : 'citas' }}</span></span>
              </button>
            </div>
          </div>
          <p class="mt-3 text-xs text-muted">
            Número = citas del día. Toque un día para abrirlo.
          </p>
        </section>
        <section
          v-else-if="vista === 'semana'"
          aria-label="Semana"
          class="rounded-xl border border-default bg-default"
        >
          <div class="divide-y divide-default lg:hidden">
            <button
              v-for="day in days"
              :key="day"
              type="button"
              class="flex min-h-14 w-full items-center gap-2 px-3 text-left hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              :class="day === today ? 'bg-primary/5' : ''"
              @click="selected = day; navigateTo({ query: { vista: 'dia', fecha: day } })"
            >
              <strong class="min-w-0 flex-1 capitalize">{{ dayLabel(day) }}</strong><span class="truncate text-xs text-muted">{{ appointmentsFor(day)[0]?.time }} {{ appointmentsFor(day)[0]?.name }}</span><UBadge
                color="neutral"
                variant="soft"
              >
                {{ appointmentsFor(day).length }} citas
              </UBadge>
            </button>
          </div>
          <div class="hidden overflow-x-auto lg:block">
            <div class="min-w-[720px]">
              <div class="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-default">
                <div />
                <div
                  v-for="day in days"
                  :key="day"
                  class="border-l border-default px-2 py-2 text-center"
                  :class="day === today ? 'bg-primary/5' : ''"
                >
                  <span class="block text-xs font-semibold uppercase text-muted">{{ shortDay.format(new Date(`${day}T12:00:00Z`)) }}</span><strong
                    class="text-xl"
                    :class="day === today ? 'text-primary' : ''"
                  >{{ Number(day.slice(8)) }}</strong>
                </div>
              </div>
              <div class="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
                <div class="relative h-[504px] text-xs text-muted">
                  <span
                    v-for="(hour, index) in hourMarks"
                    :key="hour"
                    class="absolute right-2 tabular-nums"
                    :style="{ top: `${Math.min(index * 56, 480)}px` }"
                  >{{ hour }}</span>
                </div>
                <div
                  v-for="day in days"
                  :key="day"
                  class="relative h-[504px] border-l border-default bg-[repeating-linear-gradient(to_bottom,var(--ui-border)_0,var(--ui-border)_1px,transparent_1px,transparent_56px)]"
                  :class="day === today ? 'bg-primary/5' : ''"
                >
                  <button
                    v-for="item in appointmentsFor(day)"
                    :key="item.id"
                    type="button"
                    class="absolute inset-x-1 min-h-10 overflow-clip rounded-lg border border-primary bg-primary/10 px-1.5 py-1 text-left text-xs leading-tight text-primary focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary"
                    :class="item.status === 'PENDING' ? 'border-warning bg-warning/10 text-highlighted' : ''"
                    :style="{ top: `${appointmentTop(item.time)}px` }"
                    @click="openDetail(item)"
                  >
                    <strong>{{ item.time }}</strong> {{ item.name }}
                  </button>
                </div>
              </div>
              <p class="border-t border-default px-4 py-3 text-xs text-muted">
                Seleccione una cita para ver sus detalles. Los horarios libres se configuran en Horarios.
              </p>
            </div>
          </div>
        </section>
        <section
          v-else
          aria-label="Citas del día"
          class="overflow-clip rounded-xl border border-default bg-default"
        >
          <h2 class="border-b border-default px-4 py-3 text-base font-semibold capitalize">
            {{ dayLabel(selected) }}
          </h2>
          <ul
            v-if="appointmentsFor(selected).length"
            class="divide-y divide-default"
          >
            <li
              v-for="item in appointmentsFor(selected)"
              :key="item.id"
            >
              <button
                type="button"
                class="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
                @click="openDetail(item)"
              >
                <strong class="w-12 shrink-0 tabular-nums">{{ item.time }}</strong><span class="min-w-0 flex-1"><strong class="block truncate text-sm">{{ item.name }}</strong><span
                  v-if="isDoctor && item.reason"
                  class="block truncate text-xs text-muted"
                >{{ item.reason }}</span></span><UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ statusLabel(item.status) }}
                </UBadge>
              </button>
            </li>
          </ul>
          <p
            v-else
            class="px-4 py-6 text-sm text-muted"
          >
            Sin citas para este día
          </p>
        </section>
      </div>
      <aside class="min-w-0 space-y-4">
        <section class="rounded-xl border border-default bg-default">
          <div class="flex items-center justify-between border-b border-default px-4 py-3">
            <h2 class="text-base font-semibold">
              Solicitudes pendientes
            </h2><UBadge
              color="warning"
              variant="soft"
            >
              {{ requests?.length ?? 0 }}
            </UBadge>
          </div>
          <div
            v-for="request in requests?.slice(0, 3)"
            :key="request.id"
            class="border-b border-default px-4 py-3 text-sm"
          >
            <strong>{{ request.childName }}</strong><p class="mt-1 text-muted">
              Representante: {{ request.guardianName }}
            </p><p class="mt-1 tabular-nums">
              Pide: {{ dayLabel(request.date) }}, {{ request.time }}
            </p>
          </div>
          <NuxtLink
            to="/agenda/solicitudes"
            class="flex min-h-11 items-center px-4 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary"
          >Ver solicitudes</NuxtLink>
        </section>
        <section class="rounded-xl border border-default bg-default p-4 text-sm">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">
              Disponibilidad
            </h2><NuxtLink
              to="/agenda/horarios"
              class="text-primary focus-visible:outline-2 focus-visible:outline-primary"
            >Editar</NuxtLink>
          </div><p class="mt-3 text-muted">
            {{ availability?.days.length ?? 0 }} días de atención
          </p><p class="mt-2 text-muted">
            Duración {{ availability?.durationMinutes ?? '—' }} min
          </p><p class="mt-2 text-muted">
            {{ availability?.blocked.length ?? 0 }} bloqueos programados
          </p>
        </section>
      </aside>
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
            v-if="isDoctor"
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
          <p class="text-sm tabular-nums text-muted">
            {{ dayLabel(detail.date) }} · {{ detail.time }}
          </p>
          <UBadge
            color="neutral"
            variant="soft"
          >
            {{ statusLabel(detail.status) }}
          </UBadge>
          <p v-if="isDoctor && detail.reason">
            {{ detail.reason }}
          </p>
          <UButton
            v-if="isDoctor && detail.patientId"
            :to="`/pacientes/${detail.patientId}`"
            variant="outline"
          >
            Abrir ficha
          </UButton>
          <UAlert
            v-if="message"
            color="error"
            :title="message"
          />
          <div
            v-if="detail.status === 'PENDING' || detail.status === 'CONFIRMED'"
            class="flex flex-wrap gap-2"
          >
            <UButton
              v-if="detail.status === 'PENDING'"
              @click="changeStatus('confirmar')"
            >
              Confirmar cita
            </UButton>
            <UButton
              v-if="detail.status === 'CONFIRMED'"
              @click="changeStatus('atender')"
            >
              Marcar atendida
            </UButton>
          </div>
          <template v-if="detail.status !== 'CANCELLED' && detail.status !== 'ATTENDED'">
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
