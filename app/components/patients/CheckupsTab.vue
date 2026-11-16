<script setup lang="ts">
import type { Checkup } from '#shared/types/preventive'

const props = defineProps<{ patientId: string }>()
const url = `/api/pacientes/${encodeURIComponent(props.patientId)}/preventivo`
const { data, error, refresh } = await useFetch<Checkup[]>(`${url}/controles`)
const individual = reactive({ date: '', reason: '' })
const completedAt = ref(new Date().toISOString().slice(0, 10))
const saveError = ref('')
async function save() {
  saveError.value = ''
  try {
    await $fetch(`${url}/controles`, { method: 'POST', body: individual })
    Object.assign(individual, { date: '', reason: '' })
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
  <UCard class="space-y-4">
    <h2 class="text-lg font-semibold">
      Controles por edad
    </h2>
    <p class="text-sm text-muted">
      Edades AAP como borrador para revisión médica; no son citas, fechas previstas ni recordatorios definitivos.
    </p>
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
    >
      <table
        class="w-full min-w-[540px] text-left text-sm"
        aria-label="Controles por revisar"
      >
        <thead>
          <tr>
            <th class="p-2">
              Control
            </th>
            <th class="p-2">
              Fuente
            </th>
            <th class="p-2">
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
            <td class="p-2">
              {{ item.label }}<span v-if="item.date"> · {{ item.date }}</span><span v-if="item.reason"> · {{ item.reason }}</span><br>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ item.badge }}
              </UBadge>
            </td>
            <td class="p-2 text-muted">
              {{ item.source }} · {{ item.version }} · {{ item.sourcePage }}
            </td>
            <td class="p-2">
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
    <UFormField label="Fecha de control realizado">
      <UInput
        v-model="completedAt"
        type="date"
        class="w-full"
      />
    </UFormField>
    <form
      class="grid gap-3 sm:grid-cols-3"
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
