<script setup lang="ts">
import type { AuditPage, DataRequest, DataRequestPage } from '#shared/types/admin'

const route = useRoute()
const tab = computed(() => route.query.tab === 'solicitudes' ? 'solicitudes' : 'registro')
const filters = reactive({ action: '', actorId: '', outcome: 'ALL', from: '', to: '' })
const applied = ref({ ...filters })
const page = ref(1)
const query = computed(() => ({
  page: page.value,
  pageSize: 25,
  ...Object.fromEntries(Object.entries(applied.value).filter(([key, value]) => value && !(key === 'outcome' && value === 'ALL') && key !== 'from' && key !== 'to')),
  ...(applied.value.from ? { from: `${applied.value.from}T00:00:00.000-05:00` } : {}),
  ...(applied.value.to ? { to: `${applied.value.to}T23:59:59.999-05:00` } : {})
}))
const { data: audit, error, status, refresh } = await useFetch<AuditPage>('/api/admin/auditoria', { query })
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ status: error.value.statusCode, statusText: 'Acceso denegado' })
const requestPage = ref(1)
const { data: requests, error: requestError, status: requestsStatus, refresh: refreshRequests } = await useFetch<DataRequestPage>('/api/admin/solicitudes', { query: computed(() => ({ page: requestPage.value })) })
if (import.meta.server && (requestError.value?.statusCode === 401 || requestError.value?.statusCode === 403)) throw createError({ status: requestError.value.statusCode, statusText: 'Acceso denegado' })
const feedback = ref('')
const busy = ref(false)
const statusLabels = { QUEUED: 'Pendiente', UNDER_REVIEW: 'En revisión', CLOSED: 'Cerrada' }
const typeLabels = { VIEW: 'Consulta', EXPORT: 'Exportación', DELETE: 'Eliminación' }
const dateFormat = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' })
function formatDate(value: string | Date) {
  return dateFormat.format(new Date(value))
}
function applyFilters() {
  page.value = 1
  applied.value = { ...filters }
}
async function download() {
  feedback.value = ''
  busy.value = true
  try {
    const csv = await $fetch<Blob>('/api/admin/auditoria.csv', { query: query.value, responseType: 'blob' })
    const url = URL.createObjectURL(csv)
    const link = document.createElement('a')
    link.href = url
    link.download = 'auditoria.csv'
    link.click()
    URL.revokeObjectURL(url)
  } catch {
    feedback.value = 'No se pudo exportar el registro'
  } finally {
    busy.value = false
  }
}
async function advance(item: DataRequest) {
  busy.value = true
  feedback.value = ''
  try {
    await $fetch(`/api/admin/solicitudes/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { status: 'UNDER_REVIEW' } })
    feedback.value = 'Estado actualizado'
    await refreshRequests()
  } catch {
    feedback.value = 'No se pudo actualizar la solicitud'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-8 pb-24">
    <h1 class="text-2xl font-semibold">
      Auditoría
    </h1>
    <nav
      aria-label="Secciones de auditoría"
      class="flex flex-wrap gap-2 border-b border-default pb-3"
    >
      <UButton
        to="/admin/auditoria"
        :variant="tab === 'registro' ? 'solid' : 'outline'"
        class="min-h-11"
        :aria-current="tab === 'registro' ? 'page' : undefined"
      >
        Registro
      </UButton>
      <UButton
        to="/admin/auditoria?tab=solicitudes"
        :variant="tab === 'solicitudes' ? 'solid' : 'outline'"
        class="min-h-11"
        :aria-current="tab === 'solicitudes' ? 'page' : undefined"
      >
        Solicitudes de datos
      </UButton>
    </nav>
    <UAlert
      v-if="feedback"
      :color="feedback.startsWith('No ') ? 'error' : 'success'"
      :title="feedback"
      role="status"
    />
    <section
      v-if="tab === 'registro'"
      class="space-y-4"
      aria-labelledby="audit-title"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="audit-title"
          class="text-lg font-semibold"
        >
          Registro de auditoría
        </h2><UButton
          variant="outline"
          icon="i-lucide-download"
          :loading="busy"
          :disabled="busy || !!error"
          class="min-h-11"
          @click="download"
        >
          Exportar CSV
        </UButton>
      </div>
      <form
        action="/api/admin/auditoria"
        method="get"
        aria-label="Filtrar auditoría"
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        @submit.prevent="applyFilters"
      >
        <UFormField label="Acción">
          <UInput
            v-model="filters.action"
            name="action"
            maxlength="100"
            class="w-full"
          />
        </UFormField>
        <UFormField label="ID de usuario">
          <UInput
            v-model="filters.actorId"
            name="actorId"
            maxlength="100"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Resultado">
          <USelect
            v-model="filters.outcome"
            name="outcome"
            :items="[{ label: 'Todos', value: 'ALL' }, { label: 'Permitido', value: 'ALLOWED' }, { label: 'Denegado', value: 'DENIED' }]"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Desde">
          <UInput
            v-model="filters.from"
            name="from"
            type="date"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Hasta">
          <UInput
            v-model="filters.to"
            name="to"
            type="date"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          class="min-h-11 self-end"
        >
          Aplicar filtros
        </UButton>
      </form>
      <UAlert
        v-if="error"
        color="error"
        title="No se pudo cargar el registro"
        :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
      />
      <USkeleton
        v-else-if="status === 'pending'"
        class="h-64 w-full"
      />
      <UCard v-else>
        <p
          v-if="!audit?.items.length"
          class="text-sm text-muted"
        >
          No hay eventos para estos filtros.
        </p>
        <div
          v-else
          role="region"
          aria-label="Eventos de auditoría"
          tabindex="0"
          class="max-w-full overflow-x-auto"
        >
          <table class="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr class="border-b border-default text-muted">
                <th
                  scope="col"
                  class="p-3"
                >
                  Fecha y hora
                </th><th
                  scope="col"
                  class="p-3"
                >
                  Usuario
                </th><th
                  scope="col"
                  class="p-3"
                >
                  Acción
                </th><th
                  scope="col"
                  class="p-3"
                >
                  Registro
                </th><th
                  scope="col"
                  class="p-3"
                >
                  Resultado
                </th>
              </tr>
            </thead><tbody>
              <tr
                v-for="event in audit.items"
                :key="event.id"
                class="border-b border-default"
              >
                <td class="whitespace-nowrap p-3">
                  {{ formatDate(event.occurredAt) }}
                </td><td class="break-all p-3">
                  {{ event.actorId ?? 'Sistema' }}
                </td><td class="p-3">
                  {{ event.action }}
                </td><td class="break-all p-3">
                  {{ event.subjectId ?? '—' }}
                </td><td class="p-3">
                  {{ event.outcome === 'ALLOWED' ? 'Permitido' : 'Denegado' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-if="audit"
          class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted"
        >
          <span>{{ audit.total }} eventos · página {{ page }}</span><div class="flex gap-2">
            <UButton
              variant="outline"
              color="neutral"
              :disabled="page <= 1"
              class="min-h-11"
              @click="page--"
            >
              Anterior
            </UButton><UButton
              variant="outline"
              color="neutral"
              :disabled="page * audit.pageSize >= audit.total"
              class="min-h-11"
              @click="page++"
            >
              Siguiente
            </UButton>
          </div>
        </div>
      </UCard>
    </section>
    <section
      v-else
      class="space-y-4"
      aria-labelledby="requests-title"
    >
      <h2
        id="requests-title"
        class="text-lg font-semibold"
      >
        Solicitudes de datos
      </h2><p class="text-sm text-muted">
        Borrador - pendiente de revisión legal
      </p>
      <UAlert
        v-if="requestError"
        color="error"
        title="No se pudieron cargar las solicitudes"
        :actions="[{ label: 'Reintentar', onClick: () => refreshRequests() }]"
      />
      <USkeleton
        v-else-if="requestsStatus === 'pending'"
        class="h-64 w-full"
      />
      <UCard v-else-if="!requests?.items.length">
        <p class="text-sm text-muted">
          No hay solicitudes.
        </p>
      </UCard>
      <ul
        v-else
        class="space-y-3"
      >
        <li
          v-for="item in requests.items"
          :key="item.id"
        >
          <UCard>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="font-semibold">
                  {{ typeLabels[item.type] }} · {{ statusLabels[item.status] }}
                </h3><p class="break-all text-sm text-muted">
                  Solicitante: {{ item.requesterId }} · {{ formatDate(item.createdAt) }}
                </p>
              </div><UButton
                v-if="item.status === 'QUEUED'"
                variant="outline"
                :disabled="busy"
                :loading="busy"
                class="min-h-11"
                @click="advance(item)"
              >
                Iniciar revisión
              </UButton>
            </div>
          </UCard>
        </li>
      </ul>
      <div
        v-if="requests"
        class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted"
      >
        <span>{{ requests.total }} solicitudes · página {{ requestPage }}</span>
        <div class="flex gap-2">
          <UButton
            variant="outline"
            color="neutral"
            :disabled="requestPage <= 1 || requestsStatus === 'pending'"
            class="min-h-11"
            @click="requestPage--"
          >
            Anterior
          </UButton>
          <UButton
            variant="outline"
            color="neutral"
            :disabled="requestPage * requests.pageSize >= requests.total || requestsStatus === 'pending'"
            class="min-h-11"
            @click="requestPage++"
          >
            Siguiente
          </UButton>
        </div>
      </div>
    </section>
  </UContainer>
</template>
