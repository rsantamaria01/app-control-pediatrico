<script setup lang="ts">
const { data: review, error, refresh } = await useFetch<{ id: string, name: string, indicators: string[] }[]>('/api/clinical/crecimiento-por-revisar')
</script>

<template>
  <UContainer class="max-w-4xl space-y-5 py-6 pb-24">
    <UButton
      to="/"
      variant="link"
      icon="i-lucide-arrow-left"
    >
      Inicio
    </UButton>
    <h1 class="text-2xl font-semibold">
      Crecimiento por revisar
    </h1>
    <p class="text-sm text-muted">
      Selección provisional para revisión médica; no constituye un diagnóstico ni se comunica automáticamente a las familias.
    </p>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudo cargar la revisión"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <UEmpty
      v-else-if="!review?.length"
      title="No hay pacientes por revisar"
    />
    <UCard v-else>
      <ul class="divide-y divide-default">
        <li
          v-for="person in review"
          :key="person.id"
        >
          <NuxtLink
            :to="`/pacientes/${person.id}`"
            class="flex min-h-14 items-center justify-between gap-3 py-2 focus-visible:outline-2 focus-visible:outline-primary"
          ><span>{{ person.name }}</span><span class="text-sm text-muted">{{ person.indicators.join(', ') }}</span></NuxtLink>
        </li>
      </ul>
    </UCard>
  </UContainer>
</template>
