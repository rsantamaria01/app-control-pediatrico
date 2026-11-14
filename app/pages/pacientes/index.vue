<script setup lang="ts">
import type { PatientView } from '#shared/types/measurement'

const query = ref('')
const age = (birthDate: string) => {
  const today = new Date()
  const [year, month, day] = birthDate.split('-').map(Number)
  const months = (today.getFullYear() - year!) * 12 + today.getMonth() + 1 - month! - (today.getDate() < day! ? 1 : 0)
  return months < 12 ? `${months} meses` : `${Math.floor(months / 12)} años ${months % 12} meses`
}
const weight = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const { data: patients, status, error, refresh } = await useFetch<PatientView[]>('/api/pacientes', { query: { q: query }, default: () => [] })
</script>

<template>
  <UContainer class="max-w-5xl space-y-6 py-8 pb-24">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="text-sm text-muted">
          Consulta clínica
        </p>
        <h1 class="text-2xl font-semibold">
          Pacientes
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
    <UFormField
      label="Buscar por nombre o identificación"
      name="search"
    >
      <UInput
        v-model="query"
        icon="i-lucide-search"
        placeholder="Buscar por nombre o identificación"
        class="w-full"
        size="lg"
      />
    </UFormField>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo consultar pacientes"
      description="Compruebe su conexión e inténtelo otra vez."
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending'"
      class="space-y-3"
      aria-label="Cargando pacientes"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-16 w-full"
      />
    </div>
    <UEmpty
      v-else-if="!patients?.length"
      icon="i-lucide-users"
      title="Aún no hay pacientes"
      description="Registre un paciente para iniciar su seguimiento."
      :actions="[{ label: 'Nuevo paciente', to: '/pacientes/nuevo' }]"
    />
    <UCard v-else>
      <p class="mb-2 text-sm text-muted">
        Orden A–Z
      </p>
      <ul class="divide-y divide-default">
        <li
          v-for="person in patients"
          :key="person.id"
        >
          <NuxtLink
            :to="`/pacientes/${person.id}`"
            class="flex min-h-14 items-center gap-3 rounded-md px-2 py-3 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <UAvatar
              :text="person.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()"
              size="md"
            />
            <span class="min-w-0 flex-1"><span class="block truncate font-medium">{{ person.name }}</span><span class="block text-sm text-muted">{{ age(person.birthDate) }} · {{ person.lastWeightKg === undefined ? 'Sin peso registrado' : `${weight.format(person.lastWeightKg)} kg` }}</span></span>
            <UIcon
              name="i-lucide-chevron-right"
              aria-hidden="true"
            />
          </NuxtLink>
        </li>
      </ul>
    </UCard>
  </UContainer>
</template>
