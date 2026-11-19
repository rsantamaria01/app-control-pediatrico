<script setup lang="ts">
const { data: navigation, error: navigationError, refresh: refreshNavigation } = await useFetch<{ to: string }[]>('/api/auth/navigation', { default: () => [] })
const isStaff = computed(() => navigation.value.some(item => item.to === '/pacientes' || item.to === '/agenda' || item.to.startsWith('/admin/')))
const isParent = computed(() => !navigationError.value && !isStaff.value && navigation.value.some(item => item.to === '/citas'))
const { data, error, refresh } = await useFetch<{ id: string, eventKind: string, subjectId: string, dueDate: string | null, readAt: string | null, createdAt: string }[]>('/api/avisos', { default: () => [], enabled: isParent })
type StaffNotice = { id: string, title: string, context: string, icon: string, to: string, createdAt: string }
const { user } = useUserSession()
const { data: staffNotices, error: staffError, refresh: refreshStaff } = await useFetch<StaffNotice[]>('/api/avisos/personal', { default: () => [], enabled: isStaff })
const readStaffIds = useState<string[]>('read-staff-notices', () => [])
const storageKey = computed(() => `staff-notice-read:${user.value?.id ?? ''}`)
onMounted(() => {
  watch(storageKey, (key) => {
    try {
      readStaffIds.value = JSON.parse(localStorage.getItem(key) ?? '[]')
    } catch {
      readStaffIds.value = []
    }
  }, { immediate: true })
})
const staffUnread = computed(() => staffNotices.value.filter(notice => !readStaffIds.value.includes(notice.id)).length)
const relativeTime = new Intl.RelativeTimeFormat('es-EC', { numeric: 'auto' })
function when(date: string) {
  const hours = Math.round((Date.parse(date) - Date.now()) / 3600000)
  return Math.abs(hours) < 24 ? relativeTime.format(hours, 'hour') : relativeTime.format(Math.round(hours / 24), 'day')
}
function readStaff(id: string) {
  readStaffIds.value = [...new Set([...readStaffIds.value, id])].slice(-500)
  try {
    localStorage.setItem(storageKey.value, JSON.stringify(readStaffIds.value))
  } catch {
    // Read state stays in memory when storage is unavailable.
  }
}
const accessError = navigationError.value?.statusCode ?? error.value?.statusCode
if (import.meta.server && (accessError === 401 || accessError === 403)) throw createError({ statusCode: accessError, statusMessage: 'Acceso denegado' })
watch(isParent, async (allowed) => {
  if (allowed) await refresh()
})
const dates = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeZone: 'America/Guayaquil' })
const calendarDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' })
const filter = ref<'all' | 'unread'>('all')
const staffVisible = computed(() => staffNotices.value.filter(notice => filter.value === 'all' || !readStaffIds.value.includes(notice.id)))
const unreadCount = computed(() => isStaff.value ? staffUnread.value : data.value?.filter(notice => !notice.readAt).length ?? 0)
const visible = computed(() => data.value?.filter(notice => filter.value === 'all' || !notice.readAt) ?? [])
const today = calendarDay.format(new Date())
const todayNotices = computed(() => visible.value.filter(notice => calendarDay.format(new Date(notice.createdAt)) === today))
const olderNotices = computed(() => visible.value.filter(notice => calendarDay.format(new Date(notice.createdAt)) !== today))
const titles: Record<string, string> = { CHECKUP_DUE: 'Recordatorio de control', VISIT_RECORDED: 'Nueva consulta compartida', BOOKING_APPROVED: 'Cita confirmada', BOOKING_PENDING: 'Solicitud de cita recibida', BOOKING_DECLINED: 'Solicitud de cita no aprobada', BOOKING_RESCHEDULED: 'Cita reprogramada', BOOKING_CANCELLED: 'Cita cancelada' }
const icons: Record<string, string> = { CHECKUP_DUE: 'i-lucide-clock', VISIT_RECORDED: 'i-lucide-message-square', BOOKING_APPROVED: 'i-lucide-check', BOOKING_PENDING: 'i-lucide-calendar-days', BOOKING_DECLINED: 'i-lucide-calendar-x', BOOKING_RESCHEDULED: 'i-lucide-calendar-days', BOOKING_CANCELLED: 'i-lucide-calendar-x' }
const reading = ref(false)
async function markAllRead() {
  if (!isParent.value && !isStaff.value) return
  reading.value = true
  try {
    if (isStaff.value) {
      for (const notice of staffVisible.value.filter(item => !readStaffIds.value.includes(item.id))) readStaff(notice.id)
    } else {
      for (const notice of visible.value.filter(item => !item.readAt)) await markRead(notice.id)
    }
  } finally {
    reading.value = false
  }
}
async function markRead(id: string) {
  if (!isParent.value) return
  try {
    await $fetch(`/api/avisos/${encodeURIComponent(id)}/leer`, { method: 'POST' })
  } finally {
    await refresh()
  }
}
</script>

<template>
  <UContainer class="max-w-3xl space-y-4 px-4 py-5 pb-24 sm:px-6">
    <header class="flex min-h-11 items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">
        Avisos
      </h1>
      <UButton
        v-if="(isParent || isStaff) && unreadCount"
        variant="ghost"
        color="neutral"
        :loading="reading"
        class="min-h-11"
        @click="markAllRead"
      >
        Marcar leídos
      </UButton>
    </header>
    <nav
      v-if="(isParent || isStaff) && !navigationError"
      aria-label="Filtrar avisos"
      class="flex rounded-lg bg-elevated p-1 text-sm"
    >
      <button
        type="button"
        :aria-pressed="filter === 'all'"
        class="min-h-10 flex-1 rounded-md px-2 focus-visible:outline-2 focus-visible:outline-primary"
        :class="filter === 'all' ? 'bg-default font-semibold shadow-sm' : 'text-muted'"
        @click="filter = 'all'"
      >
        Todos
      </button>
      <button
        type="button"
        :aria-pressed="filter === 'unread'"
        class="min-h-10 flex-1 rounded-md px-2 focus-visible:outline-2 focus-visible:outline-primary"
        :class="filter === 'unread' ? 'bg-default font-semibold shadow-sm' : 'text-muted'"
        @click="filter = 'unread'"
      >
        Sin leer · {{ unreadCount }}
      </button>
    </nav>
    <div class="rounded-xl border border-default bg-default p-4">
      <UAlert
        v-if="navigationError"
        color="error"
        variant="soft"
        title="No se pudo verificar el acceso"
        :actions="[{ label: 'Reintentar', onClick: () => refreshNavigation() }]"
      />
      <UAlert
        v-else-if="isStaff && staffError"
        color="error"
        variant="soft"
        title="No se pudieron cargar los avisos"
        :actions="[{ label: 'Reintentar', onClick: () => refreshStaff() }]"
      />
      <UEmpty
        v-else-if="isStaff && !staffVisible.length"
        title="Sin avisos nuevos"
      />
      <UAlert
        v-else-if="isParent && error"
        color="error"
        variant="soft"
        title="No se pudieron cargar los avisos"
        :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
      />
      <UEmpty
        v-else-if="isParent && !visible.length"
        :title="filter === 'unread' ? 'No hay avisos sin leer' : 'Aún no hay avisos'"
      />
      <UEmpty
        v-else-if="!navigation?.length"
        title="No hay avisos disponibles"
        description="Inicie sesión para consultar sus avisos."
      />
    </div>
    <section
      v-if="isStaff && !staffError && !navigationError && staffVisible.length"
      aria-label="Avisos del personal"
      class="overflow-hidden rounded-xl border border-default bg-default"
    >
      <ul class="divide-y divide-default">
        <li
          v-for="notice in staffVisible"
          :key="notice.id"
          class="flex items-center gap-3 px-4 py-3"
          :class="!readStaffIds.includes(notice.id) ? 'bg-primary/5' : ''"
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated"><UIcon
            :name="notice.icon"
            class="size-5"
            aria-hidden="true"
          /></span>
          <NuxtLink
            :to="notice.to"
            class="min-w-0 flex-1 py-2 hover:text-primary"
          >
            <span class="block font-semibold">{{ notice.title }}</span>
            <span class="block truncate text-sm text-muted">{{ notice.context }} · {{ when(notice.createdAt) }}</span>
          </NuxtLink>
          <UButton
            v-if="!readStaffIds.includes(notice.id)"
            variant="ghost"
            color="neutral"
            icon="i-lucide-check"
            :aria-label="`Marcar como leído: ${notice.title}, ${notice.context}`"
            class="min-h-11 min-w-11"
            @click="readStaff(notice.id)"
          />
        </li>
      </ul>
    </section>
    <template v-if="isParent && !error && !navigationError && visible.length">
      <section
        v-for="group in [{ label: 'HOY', items: todayNotices }, { label: 'ANTERIORES', items: olderNotices }]"
        :key="group.label"
        class="mt-3"
      >
        <template v-if="group.items.length">
          <h2 class="px-4 pb-2 text-xs font-semibold text-muted">
            {{ group.label }}
          </h2>
          <ul class="divide-y divide-default bg-default">
            <li
              v-for="notice in group.items"
              :key="notice.id"
              class="flex gap-3 px-4 py-3"
              :class="!notice.readAt ? 'bg-primary/5' : ''"
            >
              <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated text-muted"><UIcon
                :name="icons[notice.eventKind] || 'i-lucide-bell'"
                class="size-5"
                aria-hidden="true"
              /></span>
              <div class="min-w-0 flex-1 text-sm">
                <p class="font-semibold">
                  {{ titles[notice.eventKind] || 'Aviso del portal' }}
                </p>
                <p
                  v-if="notice.eventKind === 'CHECKUP_DUE'"
                  class="text-muted"
                >
                  Recordatorio de control indicado por su médico<span v-if="notice.dueDate"> · Fecha indicada: {{ dates.format(new Date(`${notice.dueDate}T12:00:00Z`)) }}</span>
                </p>
                <p
                  v-else
                  class="text-muted"
                >
                  Consulte los detalles con la clínica.
                </p>
                <p class="text-xs text-muted">
                  {{ dates.format(new Date(notice.createdAt)) }}
                </p>
                <UButton
                  v-if="!notice.readAt"
                  variant="link"
                  class="min-h-10 px-0"
                  @click="markRead(notice.id)"
                >
                  Marcar leído<span class="sr-only">: {{ titles[notice.eventKind] || 'Aviso del portal' }}</span>
                </UButton>
              </div>
              <span
                v-if="!notice.readAt"
                class="mt-2 size-2 shrink-0 rounded-full bg-primary"
                aria-label="Sin leer"
              />
            </li>
          </ul>
        </template>
      </section>
    </template>
    <UButton
      v-if="isParent && !navigationError"
      to="/perfil"
      variant="outline"
      class="mx-4 mt-5 min-h-11"
    >
      Preferencias de avisos
    </UButton>
  </UContainer>
</template>
