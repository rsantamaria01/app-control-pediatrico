<script setup lang="ts">
import type { DoseRecord, PendingVaccine } from '#shared/types/preventive'
import { draftBadge } from '#shared/types/catalog'

const props = defineProps<{ patientId: string }>()
const url = `/api/pacientes/${encodeURIComponent(props.patientId)}/preventivo`
const { data, error, refresh } = await useFetch<{ pending: PendingVaccine[], applied: DoseRecord[] }>(`${url}/vacunas`)
const selected = ref<PendingVaccine | null>(null)
const appliedAt = ref(new Date().toISOString().slice(0, 10))
const lot = ref('')
const privateNote = ref('')
const external = ref(false)
const saveError = ref('')
const adding = ref(false)
const complement = reactive({ label: '', doseLabel: '', source: '' })
async function saveDose() {
  if (!selected.value) return
  saveError.value = ''
  try {
    await $fetch(`${url}/dosis`, { method: 'POST', body: { ...(selected.value.kind === 'MSP' ? { releaseId: selected.value.id.split(':')[0], key: selected.value.key } : { complementaryId: selected.value.id }), appliedAt: appliedAt.value, lot: lot.value, privateNote: privateNote.value, external: external.value } })
    selected.value = null
    await refresh()
  } catch { saveError.value = 'No se pudo registrar la dosis. Revise la fecha y si ya fue registrada.' }
}
async function saveComplement() {
  saveError.value = ''
  try {
    await $fetch(`${url}/complementarias`, { method: 'POST', body: complement })
    adding.value = false
    Object.assign(complement, { label: '', doseLabel: '', source: '' })
    await refresh()
  } catch { saveError.value = 'Ingrese el nombre, dosis y procedencia indicada por el médico.' }
}
</script>

<template>
  <UCard class="space-y-4">
    <h2 class="text-lg font-semibold">
      Vacunas
    </h2>
    <p class="text-sm text-muted">
      Revisión médica de borradores; no son indicaciones definitivas ni un esquema de recuperación automático.
    </p>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudieron cargar las vacunas"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="data">
      <UEmpty
        v-if="!data.pending.length && !data.applied.length"
        title="No hay vacunas registradas"
        description="El catálogo puede no estar disponible aún."
      />
      <div
        v-if="data.pending.length"
        class="overflow-x-auto"
      >
        <h3 class="font-medium">
          Por revisar con el médico · {{ data.pending.length }}
        </h3>
        <table
          class="w-full min-w-[640px] text-left text-sm"
          aria-label="Vacunas por revisar"
        >
          <thead>
            <tr>
              <th class="p-2">
                Vacuna
              </th>
              <th class="p-2">
                Dosis
              </th>
              <th class="p-2">
                Procedencia
              </th>
              <th class="p-2">
                Acción
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in data.pending"
              :key="item.id"
              class="border-t border-default"
            >
              <td class="p-2 font-medium">
                {{ item.label }}<br>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ item.badge }}
                </UBadge>
              </td>
              <td class="p-2">
                {{ item.doseLabel ?? 'Sin número de dosis en fuente' }}
              </td>
              <td class="p-2 text-muted">
                {{ item.source }} · {{ item.version }} · {{ item.sourcePage }}<span v-if="item.recommendedAge"> · {{ item.recommendedAge }}</span><span v-if="item.minimumInterval"> · Intervalo documentado: {{ item.minimumInterval }}</span><span v-else> · Intervalo no documentado</span>
              </td>
              <td class="p-2">
                <UButton
                  variant="outline"
                  class="min-h-11"
                  @click="selected = item"
                >
                  Registrar dosis
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section
        v-if="data.applied.length"
        class="space-y-2"
      >
        <h3 class="font-medium">
          Dosis aplicadas · {{ data.applied.length }}
        </h3>
        <ul class="divide-y divide-default">
          <li
            v-for="dose in data.applied"
            :key="dose.id"
            class="py-2 text-sm"
          >
            {{ dose.label }} · {{ dose.doseLabel }} · {{ dose.appliedAt }} · {{ dose.catalogVersion }} · {{ dose.sourcePage }}<span v-if="dose.external"> · Aplicación externa</span><span v-if="dose.lot"> · Lote: {{ dose.lot }}</span><span v-if="dose.privateNote"> · Nota clínica: {{ dose.privateNote }}</span>
          </li>
        </ul>
      </section>
    </template>
    <UButton
      variant="outline"
      class="min-h-11"
      @click="adding = !adding"
    >
      + Vacuna complementaria
    </UButton>
    <form
      v-if="adding"
      class="grid gap-3 sm:grid-cols-2"
      @submit.prevent="saveComplement"
    >
      <UFormField label="Vacuna complementaria">
        <UInput
          v-model="complement.label"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField label="Dosis indicada">
        <UInput
          v-model="complement.doseLabel"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField label="Procedencia indicada por el médico">
        <UInput
          v-model="complement.source"
          required
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        class="min-h-11"
      >
        Guardar borrador
      </UButton>
    </form>
    <form
      v-if="selected"
      class="space-y-3 rounded-lg border border-default p-3"
      @submit.prevent="saveDose"
    >
      <h3 class="font-medium">
        Registrar dosis · {{ selected.label }}
      </h3>
      <p class="text-sm text-muted">
        {{ draftBadge }} · {{ selected.source }} · {{ selected.version }} · {{ selected.sourcePage }}
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Fecha de aplicación">
          <UInput
            v-model="appliedAt"
            type="date"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Lote (privado)">
          <UInput
            v-model="lot"
            class="w-full"
          />
        </UFormField>
      </div>
      <UFormField label="Nota clínica privada">
        <UTextarea
          v-model="privateNote"
          class="w-full"
        />
      </UFormField>
      <UCheckbox
        v-model="external"
        label="Aplicada fuera de la clínica"
      />
      <div class="flex gap-2">
        <UButton
          type="submit"
          class="min-h-11"
        >
          Guardar dosis
        </UButton>
        <UButton
          variant="outline"
          class="min-h-11"
          @click="selected = null"
        >
          Cancelar
        </UButton>
      </div>
    </form>
    <UAlert
      v-if="saveError"
      color="error"
      :description="saveError"
    />
  </UCard>
</template>
