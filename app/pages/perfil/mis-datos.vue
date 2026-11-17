<script setup lang="ts">
import type { DataRequest } from '#shared/types/admin'

const { data: navigation } = await useFetch<{ label: string, to: string }[]>('/api/auth/navigation')
const isAdmin = computed(() => !navigation.value || navigation.value.some(item => item.to === '/admin/clinica'))
const { data, error, status, refresh } = await useFetch<DataRequest[]>('/api/mis-datos/solicitudes', { immediate: !isAdmin.value })
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ status: error.value.statusCode, statusText: 'Acceso denegado' })
const pending = ref(false)
const feedback = ref('')
const confirmOpen = ref(false)
const dateFormat = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' })
const labels = { VIEW: 'Consulta', EXPORT: 'Exportación', DELETE: 'Eliminación' }
const statuses = { QUEUED: 'Pendiente', UNDER_REVIEW: 'En revisión', CLOSED: 'Cerrada' }
async function request(type: DataRequest['type']) {
  if (pending.value) return
  pending.value = true
  feedback.value = ''
  try {
    await $fetch('/api/mis-datos/solicitudes', { method: 'POST', body: { type } })
    confirmOpen.value = false
    feedback.value = isAdmin.value ? 'Solicitud registrada.' : 'Solicitud registrada. Puede consultar su estado aquí.'
    await refresh()
  } catch {
    feedback.value = 'No se pudo registrar la solicitud'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-3xl space-y-6 py-8 pb-24">
    <div>
      <h1 class="text-2xl font-semibold">
        Mis datos
      </h1><p class="text-sm text-muted">
        Borrador - pendiente de revisión legal
      </p>
    </div>
    <UAlert
      v-if="feedback"
      :color="feedback.startsWith('No ') ? 'error' : 'success'"
      :title="feedback"
      role="status"
    />
    <UCard>
      <h2 class="text-lg font-semibold">
        Solicitudes
      </h2><p class="mt-2 text-sm text-muted">
        Estas acciones registran una solicitud para revisión; no muestran, descargan ni eliminan datos automáticamente.
      </p>
      <div
        v-if="!error"
        class="mt-4 flex flex-wrap gap-3"
      >
        <UButton
          variant="outline"
          :loading="pending"
          class="min-h-11"
          @click="request('VIEW')"
        >
          Solicitar consulta
        </UButton><UButton
          variant="outline"
          :loading="pending"
          class="min-h-11"
          @click="request('EXPORT')"
        >
          Solicitar exportación
        </UButton><UButton
          color="error"
          variant="outline"
          class="min-h-11"
          @click="confirmOpen = true"
        >
          Solicitar eliminación
        </UButton>
      </div>
    </UCard>
    <UButton
      v-if="isAdmin"
      to="/admin/auditoria?tab=solicitudes"
      variant="outline"
      class="min-h-11"
    >
      Ver solicitudes de la clínica
    </UButton>
    <section
      v-else
      aria-labelledby="history-heading"
      class="space-y-3"
    >
      <h2
        id="history-heading"
        class="text-lg font-semibold"
      >
        Estado de mis solicitudes
      </h2>
      <UAlert
        v-if="error"
        color="error"
        title="No se pudieron cargar las solicitudes"
        :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
      />
      <USkeleton
        v-else-if="status === 'pending'"
        class="h-32 w-full"
      />
      <UCard v-else-if="!data?.length">
        <p class="text-sm text-muted">
          No hay solicitudes registradas.
        </p>
      </UCard>
      <ul
        v-else
        class="space-y-2"
      >
        <li
          v-for="item in data"
          :key="item.id"
        >
          <UCard>
            <p class="font-medium">
              {{ labels[item.type] }} · {{ statuses[item.status] }}
            </p><p class="text-sm text-muted">
              {{ dateFormat.format(new Date(item.createdAt)) }}
            </p>
          </UCard>
        </li>
      </ul>
    </section>
    <UButton
      to="/privacidad"
      variant="link"
      class="min-h-11"
    >
      Privacidad
    </UButton>
    <UModal
      v-model:open="confirmOpen"
      title="Solicitar eliminación"
      description="Borrador - pendiente de revisión legal. Se registrará una solicitud para revisión; no se borrarán datos automáticamente."
    >
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton
            variant="outline"
            color="neutral"
            class="min-h-11"
            @click="confirmOpen = false"
          >
            Cancelar
          </UButton><UButton
            color="error"
            :loading="pending"
            :disabled="pending"
            class="min-h-11"
            @click="request('DELETE')"
          >
            Registrar solicitud
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
