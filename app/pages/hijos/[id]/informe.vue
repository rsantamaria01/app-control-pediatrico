<script setup lang="ts">
const id = useRoute().params.id as string
const { data: reports, error, refresh } = await useFetch<{ id: string, approvedAt: string }[]>(`/api/hijos/${encodeURIComponent(id)}/informe`)
if (import.meta.server && error.value) throw createError({ statusCode: error.value.statusCode === 404 ? 404 : 503, statusMessage: 'No disponible' })
const date = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
</script>

<template>
  <UContainer class="max-w-4xl space-y-5 py-5 pb-24 sm:py-8">
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo consultar esta información"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="reports">
      <nav aria-label="Ruta" class="flex items-center gap-2 text-sm text-muted">
        <NuxtLink
          :to="`/hijos/${id}`"
          class="hover:text-primary hover:underline"
        >Mi hijo/a</NuxtLink>
        <UIcon name="i-lucide-chevron-right" aria-hidden="true" class="size-4" />
        <span aria-current="page" class="font-semibold text-default">Informes</span>
      </nav>
      <div class="space-y-1">
        <h1 class="text-2xl font-bold tracking-tight">Informe de crecimiento</h1>
        <p class="text-sm text-muted">Consulte los documentos que su pediatra ha revisado y aprobado para su familia.</p>
      </div>
      <UEmpty
        v-if="!reports.length"
        title="No hay informes disponibles"
        description="Su pediatra puede preparar y aprobar un informe para usted."
      />
      <section v-else aria-label="Informes aprobados" class="space-y-3">
        <UCard
          v-for="report in reports"
          :key="report.id"
          :ui="{ body: 'flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5' }"
        >
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-elevated text-primary">
              <UIcon name="i-lucide-file-text" aria-hidden="true" class="size-5" />
            </span>
            <div>
              <h2 class="font-semibold">Informe de crecimiento</h2>
              <p class="text-sm text-muted">Aprobado el {{ date.format(new Date(report.approvedAt)) }}</p>
            </div>
          </div>
          <UButton
            :href="`/api/hijos/${encodeURIComponent(id)}/informes/${encodeURIComponent(report.id)}/pdf`"
            target="_blank"
            rel="noopener"
            icon="i-lucide-download"
            variant="outline"
            color="neutral"
            class="min-h-11"
          >
            Ver PDF aprobado
          </UButton>
        </UCard>
      </section>
    </template>
  </UContainer>
</template>
