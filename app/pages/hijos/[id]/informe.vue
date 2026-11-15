<script setup lang="ts">
const id = useRoute().params.id as string
const { data: reports, error, refresh } = await useFetch<{ id: string, approvedAt: string }[]>(`/api/hijos/${encodeURIComponent(id)}/informe`)
const date = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
</script>

<template>
  <UContainer class="max-w-4xl space-y-6 py-8 pb-24">
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo consultar esta información"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="reports">
      <nav aria-label="Ruta">
        <NuxtLink
          :to="`/hijos/${id}`"
          class="text-primary hover:underline"
        >Indicaciones</NuxtLink> / Informes
      </nav>
      <h1 class="text-2xl font-semibold">
        Informes aprobados
      </h1>
      <UEmpty
        v-if="!reports.length"
        title="No hay informes disponibles"
        description="Su pediatra puede preparar y aprobar un informe para usted."
      />
      <UCard
        v-for="report in reports"
        :key="report.id"
        class="space-y-3"
      >
        <p>Aprobado el {{ date.format(new Date(report.approvedAt)) }}</p>
        <UButton
          :href="`/api/hijos/${encodeURIComponent(id)}/informes/${encodeURIComponent(report.id)}/pdf`"
          target="_blank"
          rel="noopener"
          class="min-h-11"
        >
          Descargar PDF
        </UButton>
      </UCard>
    </template>
  </UContainer>
</template>
