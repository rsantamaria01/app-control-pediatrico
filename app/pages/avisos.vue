<script setup lang="ts">
const { data: navigation, error: navigationError, refresh: refreshNavigation } = await useFetch<{ to: string }[]>('/api/auth/navigation', { default: () => [] })
const isStaff = computed(() => navigation.value.some(item => item.to === '/pacientes' || item.to === '/agenda' || item.to.startsWith('/admin/')))
const isParent = computed(() => !navigationError.value && !isStaff.value && navigation.value.some(item => item.to === '/citas'))
const { data, error, refresh } = await useFetch<{ id: string, eventKind: string, subjectId: string, dueDate: string | null, readAt: string | null, createdAt: string }[]>('/api/avisos', { default: () => [], enabled: isParent })
const accessError = navigationError.value?.statusCode ?? error.value?.statusCode
if (import.meta.server && (accessError === 401 || accessError === 403)) throw createError({ statusCode: accessError, statusMessage: 'Acceso denegado' })
watch(isParent, async (allowed) => {
  if (allowed) await refresh()
})
const dates = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeZone: 'America/Guayaquil' })
const calendarDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' })
const filter = ref<'all' | 'unread'>('all')
const unreadCount = computed(() => data.value?.filter(notice => !notice.readAt).length ?? 0)
const visible = computed(() => data.value?.filter(notice => filter.value === 'all' || !notice.readAt) ?? [])
const today = calendarDay.format(new Date())
const todayNotices = computed(() => visible.value.filter(notice => calendarDay.format(new Date(notice.createdAt)) === today))
const olderNotices = computed(() => visible.value.filter(notice => calendarDay.format(new Date(notice.createdAt)) !== today))
const titles: Record<string, string> = { CHECKUP_DUE: 'Recordatorio de control', VISIT_RECORDED: 'Nueva consulta compartida', BOOKING_APPROVED: 'Cita confirmada', BOOKING_PENDING: 'Solicitud de cita recibida', BOOKING_DECLINED: 'Solicitud de cita no aprobada', BOOKING_RESCHEDULED: 'Cita reprogramada', BOOKING_CANCELLED: 'Cita cancelada' }
const icons: Record<string, string> = { CHECKUP_DUE: 'i-lucide-clock', VISIT_RECORDED: 'i-lucide-message-square', BOOKING_APPROVED: 'i-lucide-check', BOOKING_PENDING: 'i-lucide-calendar-days', BOOKING_DECLINED: 'i-lucide-calendar-x', BOOKING_RESCHEDULED: 'i-lucide-calendar-days', BOOKING_CANCELLED: 'i-lucide-calendar-x' }
const reading = ref(false)
async function markAllRead() {
  if (!isParent.value) return
  reading.value = true
  try {
    for (const notice of visible.value.filter(item => !item.readAt)) await markRead(notice.id)
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
  <UContainer class="max-w-3xl px-0 pb-24 sm:px-4 sm:py-6">
    <header class="flex min-h-14 items-center justify-between gap-2 border-b border-default bg-default px-4 sm:rounded-t-xl sm:border-x sm:border-t">
      <h1 class="text-base font-semibold">
        Avisos
      </h1>
      <UButton
        v-if="isParent && unreadCount"
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
      v-if="isParent && !navigationError"
      aria-label="Filtrar avisos"
      class="m-4 flex rounded-lg bg-elevated p-1 text-sm"
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
    <div class="px-4">
      <UEmpty
        v-if="isStaff && !navigationError"
        icon="i-lucide-bell-off"
        title="Avisos no disponibles para el personal"
        description="Los avisos del portal son solo para representantes. Esta sección no muestra información de familias."
      />
      <UAlert
        v-else-if="navigationError"
        color="error"
        variant="soft"
        title="No se pudo verificar el acceso"
        :actions="[{ label: 'Reintentar', onClick: () => refreshNavigation() }]"
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
