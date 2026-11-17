<script setup lang="ts">
import type { Checkup } from '#shared/types/preventive'

const props = defineProps<{ patientId: string }>()
const url = `/api/pacientes/${encodeURIComponent(props.patientId)}/preventivo`
const { data, error, refresh } = await useFetch<Checkup[]>(`${url}/controles`)
const individual = reactive({ date: '', reason: '' })
const completedAt = ref(new Date().toISOString().slice(0, 10))
const saveError = ref('')
const showIndividual = ref(false)
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const formatDate = (value: string) => dateFormat.format(new Date(`${value}T12:00:00Z`))
async function save() {
  saveError.value = ''
  try {
    await $fetch(`${url}/controles`, { method: 'POST', body: individual })
    Object.assign(individual, { date: '', reason: '' })
    showIndividual.value = false
    await refresh()
  } catch { saveError.value = 'Revise la fecha y motivo del control individual.' }
}
async function complete(item: Checkup) {
  saveError.value = ''
  try {
    await $fetch(`${url}/controles-completados`, { method: 'POST', body: { ...(item.key ? { releaseId: item.id.split(':')[0], key: item.key } : { individualId: item.id }), completedAt: completedAt.value } })
    await refresh()
  } catch { saveError.value = 'No se pudo registrar el control.' }
}
</script>

<template>
  <UCard :ui="{ body: 'p-0' }">
    <div class="flex flex-wrap items-start justify-between gap-3 p-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold">
          Controles por edad
        </h2>
        <p class="text-xs text-muted">
          Fechas derivadas de edades AAP en borrador para revisión médica; no son citas ni recordatorios definitivos.
        </p>
      </div>
      <UBadge
        v-if="data"
        color="neutral"
        variant="soft"
      >
        {{ data.length }} por revisar
      </UBadge>
    </div>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudieron consultar los controles"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <UEmpty
      v-else-if="!data?.length"
      title="No hay controles por revisar"
    />
    <div
      v-else
      class="overflow-x-auto"
      role="region"
      aria-label="Controles por revisar"
      tabindex="0"
    >
      <table
        class="w-full min-w-[640px] text-left text-sm tabular-nums"
        aria-label="Controles por revisar"
      >
        <thead>
          <tr>
            <th
              scope="col"
              class="px-4 py-3 font-medium text-muted"
            >
              Control
            </th>
            <th
              scope="col"
              class="px-4 py-3 font-medium text-muted"
            >
              Fecha
            </th>
            <th
              scope="col"
              class="px-4 py-3 font-medium text-muted"
            >
              Estado
            </th>
            <th
              scope="col"
              class="px-4 py-3 font-medium text-muted"
            >
              Fuente
            </th>
            <th
              scope="col"
              class="px-4 py-3 font-medium text-muted"
            >
              Acción
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in data"
            :key="item.id"
            class="border-t border-default"
          >
            <th
              scope="row"
              class="px-4 py-3 text-left font-semibold"
            >
              {{ item.label }}<span
                v-if="item.reason"
                class="block text-xs font-normal text-muted"
              >{{ item.reason }}</span>
            </th>
            <td class="px-4 py-3">
              {{ formatDate(item.date) }}<span v-if="item.endDate && item.endDate !== item.date"> – {{ formatDate(item.endDate) }}</span>
            </td>
            <td class="px-4 py-3">
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ item.badge }}
              </UBadge>
            </td>
            <td class="px-4 py-3 text-muted">
              {{ item.source }} · {{ item.version }} · {{ item.sourcePage }}
            </td>
            <td class="px-4 py-2">
              <UButton
                variant="outline"
                class="min-h-11"
                @click="complete(item)"
              >
                Registrar control realizado
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="space-y-3 border-t border-default p-4">
      <UFormField label="Fecha de control realizado">
        <UInput
          v-model="completedAt"
          type="date"
          class="w-full sm:max-w-xs"
        />
      </UFormField>
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-plus"
        class="min-h-11"
        @click="showIndividual = !showIndividual"
      >
        {{ showIndividual ? 'Cerrar formulario' : 'Agregar control individual' }}
      </UButton>
    </div>
    <form
      v-if="showIndividual"
      class="grid gap-3 border-t border-default p-4 sm:grid-cols-3"
      @submit.prevent="save"
    >
      <UFormField label="Fecha individual">
        <UInput
          v-model="individual.date"
          type="date"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField label="Motivo indicado por el médico">
        <UInput
          v-model="individual.reason"
          required
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        class="min-h-11 self-end"
      >
        Agregar control individual
      </UButton>
    </form>
    <UAlert
      v-if="saveError"
      color="error"
      :description="saveError"
    />
  </UCard>
</template>
