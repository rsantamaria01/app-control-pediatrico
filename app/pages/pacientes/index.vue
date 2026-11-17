<script setup lang="ts">
import type { PatientView } from '#shared/types/measurement'

const route = useRoute()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const age = (birthDate: string) => {
  const today = new Date()
  const [year, month, day] = birthDate.split('-').map(Number)
  const months = (today.getFullYear() - year!) * 12 + today.getMonth() + 1 - month! - (today.getDate() < day! ? 1 : 0)
  return months < 12 ? `${months} meses` : `${Math.floor(months / 12)} años ${months % 12} meses`
}
const weight = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const { data: vaccineReview } = await useFetch<{ id: string }[]>('/api/clinical/vacunacion-por-revisar', { default: () => [] })
const pendingIds = computed(() => new Set(vaccineReview.value?.map(item => item.id) ?? []))
const { data: patients, status, error, refresh } = await useFetch<PatientView[]>('/api/pacientes', { query: computed(() => ({ q: query.value })), default: () => [] })
</script>

<template>
  <UContainer class="max-w-5xl space-y-4 px-4 py-4 pb-24 sm:px-6 sm:py-6">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-lg font-semibold sm:text-2xl">
        Pacientes
      </h1>
      <UButton
        to="/pacientes/nuevo"
        icon="i-lucide-plus"
        class="min-h-11 shrink-0 lg:hidden"
      >
        <span class="sm:hidden">Nuevo</span><span class="hidden sm:inline">Nuevo paciente</span>
      </UButton>
    </div>
    <UFormField
      label="Buscar por nombre o identificación"
      name="search"
      :ui="{ label: 'sr-only' }"
    >
      <UInput
        v-model="query"
        icon="i-lucide-search"
        type="search"
        placeholder="Buscar por nombre o identificación"
        class="w-full"
        size="lg"
        :ui="{ base: 'min-h-11 text-base' }"
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
      :title="query.trim() ? 'Sin resultados' : 'Aún no hay pacientes'"
      :description="query.trim() ? 'Pruebe con otro nombre, apellido o cédula.' : 'Registre un paciente para iniciar su seguimiento.'"
      :actions="query.trim() ? [] : [{ label: 'Nuevo paciente', to: '/pacientes/nuevo' }]"
    />
    <section
      v-else
      aria-label="Listado de pacientes"
    >
      <p class="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span>{{ query.trim() ? 'Resultados' : 'Pacientes' }} · {{ patients.length }}</span>
        <span>Orden A–Z</span>
      </p>
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <ul class="divide-y divide-default">
          <li
            v-for="person in patients"
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
              <span class="min-w-0 flex-1"><span class="block font-semibold leading-snug">{{ person.name }}</span><span class="block text-xs text-muted sm:text-sm">{{ age(person.birthDate) }} · {{ person.lastWeightKg === undefined ? 'Sin peso registrado' : `${weight.format(person.lastWeightKg)} kg` }}</span></span>
              <UBadge
                v-if="pendingIds.has(person.id)"
                color="neutral"
                variant="soft"
                size="xs"
                class="hidden shrink-0 sm:inline-flex"
              >Vacunas por revisar</UBadge>
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
