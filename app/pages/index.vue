<script setup lang="ts">
import type { PatientView } from '#shared/types/measurement'

const { data: navigation } = await useFetch<{ label: string, to: string }[]>('/api/auth/navigation')
const isDoctor = computed(() => Boolean(navigation.value?.some(item => item.to === '/pacientes')))
const isParent = computed(() => Boolean(navigation.value?.some(item => item.to === '/')) && !isDoctor.value)
const { data: patients, error, refresh } = await useFetch<PatientView[]>('/api/pacientes', { immediate: isDoctor.value, default: () => [] })
const { data: children, error: childrenError, refresh: refreshChildren } = await useFetch<{ id: string, name: string }[]>('/api/hijos', { immediate: isParent.value, default: () => [] })
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-8 pb-24">
    <template v-if="isDoctor">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-sm text-muted">
            Consulta clínica
          </p>
          <h1 class="text-2xl font-semibold">
            Inicio
          </h1>
        </div>
        <UButton
          to="/pacientes/nuevo"
          icon="i-lucide-plus"
          size="lg"
        >
          Nuevo paciente
        </UButton>
      </div>
      <UCard>
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold">
              Pacientes
            </h2>
            <p class="text-sm text-muted">
              Busque una ficha o registre una nueva visita.
            </p>
          </div>
          <UButton
            to="/pacientes"
            variant="outline"
          >
            Buscar pacientes
          </UButton>
        </div>
      </UCard>
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="No se pudieron consultar las fichas"
        :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
      />
      <UCard v-else>
        <h2 class="mb-4 text-lg font-semibold">
          Pacientes recientes
        </h2>
        <UEmpty
          v-if="!patients?.length"
          icon="i-lucide-users"
          title="Aún no hay pacientes"
          :actions="[{ label: 'Nuevo paciente', to: '/pacientes/nuevo' }]"
        />
        <ul
          v-else
          class="divide-y divide-default"
        >
          <li
            v-for="person in patients.slice(0, 8)"
            :key="person.id"
          >
            <NuxtLink
              :to="`/pacientes/${person.id}`"
              class="flex min-h-14 items-center justify-between rounded-md py-3 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            ><span>{{ person.name }}</span><UIcon
              name="i-lucide-chevron-right"
              aria-hidden="true"
            /></NuxtLink>
          </li>
        </ul>
      </UCard>
    </template>
    <template v-else-if="isParent">
      <h1 class="text-2xl font-semibold">
        Mis hijos
      </h1>
      <UAlert
        v-if="childrenError"
        color="error"
        variant="soft"
        title="No se pudieron consultar los datos"
        :actions="[{ label: 'Reintentar', onClick: () => refreshChildren() }]"
      />
      <UEmpty
        v-else-if="!children?.length"
        title="Aún no hay niños vinculados"
        description="Consulte con la clínica para verificar el vínculo familiar."
      />
      <div
        v-else
        class="grid gap-4 sm:grid-cols-2"
      >
        <UCard
          v-for="child in children"
          :key="child.id"
        >
          <h2 class="text-lg font-semibold">
            {{ child.name }}
          </h2>
          <UButton
            :to="`/hijos/${child.id}`"
            variant="outline"
            class="mt-3 min-h-11"
          >
            Ver crecimiento
          </UButton>
        </UCard>
      </div>
    </template>
    <UPageHero
      v-else
      title="Control Pediátrico"
      description="Registro de medidas y curvas de crecimiento según los Patrones de Crecimiento Infantil de la OMS."
    />
  </UContainer>
</template>
