<script setup lang="ts">
const { data: review, status, error, refresh } = await useFetch<{ id: string, name: string, indicators: string[] }[]>('/api/clinical/crecimiento-por-revisar')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
</script>

<template>
  <UContainer class="max-w-4xl space-y-4 px-4 py-4 pb-24 sm:px-6 sm:py-6">
    <div class="flex items-center gap-2">
      <UButton
        to="/"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
        aria-label="Volver a inicio"
        class="min-h-11 min-w-11 shrink-0"
      />
      <h1 class="text-lg font-semibold sm:text-2xl">
        Crecimiento por revisar
      </h1>
    </div>
    <p class="text-sm text-muted">
      Selección provisional para revisión médica; no constituye un diagnóstico ni se comunica automáticamente a las familias.
    </p>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo cargar la revisión"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending'"
      class="space-y-2"
      aria-label="Cargando pacientes por revisar"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-16 w-full"
      />
    </div>
    <UEmpty
      v-else-if="!review?.length"
      icon="i-lucide-chart-no-axes-combined"
      title="No hay pacientes por revisar"
    />
    <section
      v-else
      aria-label="Pacientes con crecimiento por revisar"
    >
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Pacientes · {{ review?.length }}
      </p>
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <ul class="divide-y divide-default">
          <li
            v-for="person in review"
            :key="person.id"
          >
            <NuxtLink
              :to="`/pacientes/${person.id}`"
              class="flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-4"
            >
              <UAvatar
                :text="person.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()"
                size="md"
                class="shrink-0"
              />
              <span class="min-w-0 flex-1"><span class="block font-semibold leading-snug">{{ person.name }}</span><span class="block text-xs text-muted sm:text-sm">{{ person.indicators.join(', ') }}</span></span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-muted"
                aria-hidden="true"
              />
            </NuxtLink>
          </li>
        </ul>
      </UCard>
    </section>
  </UContainer>
</template>
