<script setup lang="ts">
const { data, error, refresh } = await useFetch<{ id: string, eventKind: string, subjectId: string, dueDate: string | null, readAt: string | null, createdAt: string }[]>('/api/avisos', { default: () => [] })
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
const dates = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeZone: 'America/Guayaquil' })
async function markRead(id: string) {
  try {
    await $fetch(`/api/avisos/${encodeURIComponent(id)}/leer`, { method: 'POST' })
  } finally {
    await refresh()
  }
}
</script>

<template>
  <UContainer class="max-w-3xl space-y-6 py-8 pb-24">
    <h1 class="text-2xl font-semibold">
      Avisos
    </h1>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudieron cargar los avisos"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <UEmpty
      v-else-if="!data?.length"
      title="Aún no hay avisos"
    />
    <ul
      v-else
      class="space-y-3"
    >
      <li
        v-for="notice in data"
        :key="notice.id"
      >
        <UCard>
          <p class="font-semibold">
            {{ notice.eventKind === 'CHECKUP_DUE' ? 'Recordatorio de control indicado por su médico' : 'Aviso del portal' }}
          </p>
          <p class="text-sm text-muted">
            {{ notice.eventKind === 'CHECKUP_DUE' && notice.dueDate ? `Fecha indicada: ${dates.format(new Date(`${notice.dueDate}T12:00:00Z`))}` : dates.format(new Date(notice.createdAt)) }}
          </p>
          <UButton
            v-if="!notice.readAt"
            variant="link"
            class="min-h-11"
            @click="markRead(notice.id)"
          >
            Marcar leído
          </UButton>
        </UCard>
      </li>
    </ul>
    <UButton
      to="/perfil"
      variant="outline"
      class="min-h-11"
    >
      Preferencias de avisos
    </UButton>
  </UContainer>
</template>
