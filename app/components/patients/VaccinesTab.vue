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
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const formatDate = (value: string) => dateFormat.format(new Date(`${value}T12:00:00Z`))
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
  <UCard :ui="{ body: 'p-0' }">
    <div class="flex flex-wrap items-start justify-between gap-3 p-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold">
          Vacunas
        </h2>
        <p class="text-xs text-muted">
          Catálogo en borrador para revisión médica; sin esquema de recuperación automático.
        </p>
      </div>
      <div
        v-if="data"
        class="flex flex-wrap gap-2"
      >
        <UBadge
          color="neutral"
          variant="soft"
        >
          {{ data.applied.length }} aplicadas
        </UBadge>
        <UBadge
          color="neutral"
          variant="soft"
        >
          {{ data.pending.length }} por revisar
        </UBadge>
      </div>
    </div>
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
        v-if="data.pending.length || data.applied.length"
        class="overflow-x-auto"
        role="region"
        aria-label="Registro de vacunas"
        tabindex="0"
      >
        <table
          class="w-full min-w-[680px] text-left text-sm tabular-nums"
          aria-label="Vacunas registradas y por revisar"
        >
          <thead class="border-b border-default text-xs text-muted">
            <tr>
              <th
                scope="col"
                class="px-4 py-3 font-medium"
              >
                Vacuna
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-medium"
              >
                Dosis
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-medium"
              >
                Estado
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-medium"
              >
                Fecha
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-medium"
              >
                Procedencia
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-medium"
              >
                Acción
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-if="data.pending.length"
              class="bg-elevated text-xs font-semibold text-muted"
            >
              <th
                colspan="6"
                scope="rowgroup"
                class="px-4 py-2 text-left"
              >
                Por revisar con el médico
              </th>
            </tr>
            <tr
              v-for="item in data.pending"
              :key="item.id"
              class="border-t border-default align-top"
            >
              <th
                scope="row"
                class="px-4 py-3 text-left font-semibold"
              >
                {{ item.label }}
              </th>
              <td class="px-4 py-3">
                {{ item.doseLabel ?? 'Sin número de dosis en fuente' }}
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
                {{ item.recommendedAge ?? 'Sin edad documentada' }}
              </td>
              <td class="px-4 py-3 text-muted">
                {{ item.source }} · {{ item.version }} · {{ item.sourcePage }}<span v-if="item.minimumInterval"> · Intervalo documentado: {{ item.minimumInterval }}</span><span v-else> · Intervalo no documentado</span>
              </td>
              <td class="px-4 py-2">
                <UButton
                  variant="outline"
                  color="neutral"
                  class="min-h-11"
                  @click="selected = item"
                >
                  Registrar
                </UButton>
              </td>
            </tr>
            <tr
              v-if="data.applied.length"
              class="bg-elevated text-xs font-semibold text-muted"
            >
              <th
                colspan="6"
                scope="rowgroup"
                class="px-4 py-2 text-left"
              >
                Dosis aplicadas
              </th>
            </tr>
            <tr
              v-for="dose in data.applied"
              :key="dose.id"
              class="border-t border-default align-top"
            >
              <th
                scope="row"
                class="px-4 py-3 text-left font-semibold"
              >
                {{ dose.label }}
              </th>
              <td class="px-4 py-3">
                {{ dose.doseLabel ?? '—' }}
              </td>
              <td class="px-4 py-3">
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  Aplicada<span v-if="dose.external"> fuera de la clínica</span>
                </UBadge>
              </td>
              <td class="px-4 py-3">
                {{ formatDate(dose.appliedAt) }}
              </td>
              <td class="px-4 py-3 text-muted">
                {{ dose.catalogVersion }} · {{ dose.sourcePage }}<span v-if="dose.lot"> · Lote: {{ dose.lot }}</span><span v-if="dose.privateNote"> · Nota clínica: {{ dose.privateNote }}</span>
              </td>
              <td class="px-4 py-3">
                —
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-default p-4">
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-plus"
        class="min-h-11"
        @click="adding = !adding"
      >
        Vacuna complementaria
      </UButton>
      <span class="text-xs text-muted">Revise la procedencia de cada dosis antes de registrarla.</span>
    </div>
    <form
      v-if="adding"
      class="grid gap-3 border-t border-default p-4 sm:grid-cols-2"
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
    <UModal
      :open="Boolean(selected)"
      :title="`Registrar dosis · ${selected?.label ?? ''}`"
      @update:open="!$event && (selected = null)"
    >
      <template #body>
        <form
          v-if="selected"
          class="space-y-3"
          @submit.prevent="saveDose"
        >
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
          <UAlert
            v-if="saveError"
            color="error"
            :description="saveError"
          />
          <div class="flex justify-end gap-2">
            <UButton
              type="button"
              variant="outline"
              color="neutral"
              class="min-h-11"
              @click="selected = null"
            >
              Cancelar
            </UButton>
            <UButton
              type="submit"
              class="min-h-11"
            >
              Guardar dosis
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UAlert
      v-if="saveError && !selected"
      color="error"
      :description="saveError"
    />
  </UCard>
</template>
