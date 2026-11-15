<script setup lang="ts">
import type { ReportDraft } from '../../../../server/services/reports'

const id = useRoute().params.id as string
const draft = ref<ReportDraft | null>(null)
const approved = ref(false)
const includePrivateNotes = ref(false)
const busy = ref(false)
const error = ref('')
const date = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const number = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
const url = `/api/pacientes/${encodeURIComponent(id)}/informes`
const { data: access, error: accessError } = await useFetch(`/api/pacientes/${encodeURIComponent(id)}`)

async function preview() {
  busy.value = true
  error.value = ''
  try {
    draft.value = await $fetch<ReportDraft>(url, { method: 'POST' })
    approved.value = false
  } catch {
    error.value = 'No se pudo preparar el informe. Verifique que haya controles compartidos.'
  } finally {
    busy.value = false
  }
}

async function approve() {
  if (!draft.value) return
  busy.value = true
  error.value = ''
  try {
    await $fetch(`${url}/${encodeURIComponent(draft.value.id)}/aprobar`, { method: 'POST' })
    approved.value = true
  } catch {
    error.value = 'No se pudo aprobar. Revise si las visitas siguen compartidas y genere una nueva vista previa.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-5xl space-y-6 py-8 pb-24">
    <UAlert
      v-if="accessError"
      color="error"
      variant="soft"
      title="No se pudo abrir la ficha"
    />
    <template v-else-if="access">
      <nav aria-label="Ruta">
        <NuxtLink
          :to="`/pacientes/${id}`"
          class="text-primary hover:underline"
        >Ficha del paciente</NuxtLink> / Informes
      </nav>
      <h1 class="text-2xl font-semibold">
        Informes de crecimiento
      </h1>
      <UCard class="space-y-4">
        <h2 class="font-semibold">
          Informe médico
        </h2>
        <p class="text-sm text-muted">
          Incluye mediciones, resultados, referencias y curvas oficiales disponibles. Las notas privadas solo se agregan si las selecciona expresamente.
        </p>
        <UCheckbox
          v-model="includePrivateNotes"
          label="Incluir notas clínicas privadas en el PDF médico"
        />
        <UButton
          :href="`${url}/medico${includePrivateNotes ? '?includePrivateNotes=true' : ''}`"
          target="_blank"
          rel="noopener"
          class="min-h-11"
        >
          Descargar PDF médico
        </UButton>
      </UCard>
      <UCard class="space-y-4">
        <h2 class="font-semibold">
          Informe familiar
        </h2>
        <p class="text-sm text-muted">
          Solo controles compartidos; sin resultados clínicos ni notas privadas. Revise cada informe antes de aprobarlo.
        </p>
        <UButton
          :disabled="busy"
          class="min-h-11"
          @click="preview"
        >
          Crear vista previa
        </UButton>
        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          :description="error"
        />
        <template v-if="draft">
          <p role="status">
            {{ approved ? 'Informe aprobado' : 'Vista previa pendiente de aprobación' }}
          </p>
          <iframe
            :src="`${url}/${encodeURIComponent(draft.id)}/vista-previa`"
            title="Vista previa del PDF familiar"
            class="h-[70vh] min-h-[480px] w-full rounded-lg border border-default"
          />
          <div class="rounded-lg border border-default p-4 space-y-3">
            <h3 class="font-medium">
              {{ draft.content.name }}
            </h3>
            <p
              v-for="visit in draft.content.visits"
              :key="visit.id"
              class="text-sm"
            >
              {{ date.format(new Date(visit.measuredAt)) }} · Peso {{ number.format(visit.weightKg) }} kg · {{ visit.position === 'RECUMBENT' ? 'Longitud' : 'Talla' }} {{ number.format(visit.lengthHeightCm) }} cm · Perímetro cefálico {{ number.format(visit.headCircumferenceCm) }} cm
              <span v-if="visit.parentAdvice" class="block">Indicaciones: {{ visit.parentAdvice }}</span>
              <span v-if="visit.nextControlAt" class="block">Próximo control: {{ date.format(new Date(visit.nextControlAt)) }}</span>
            </p>
            <h3 class="font-medium">
              Curvas de crecimiento OMS
            </h3>
            <p class="text-sm text-muted">
              {{ Object.keys(draft.content.charts).length ? 'Se incluyen curvas verificadas y puntos del paciente.' : 'Referencia OMS no disponible.' }}
            </p>
          </div>
          <UButton
            v-if="!approved"
            :disabled="busy"
            class="min-h-11"
            @click="approve"
          >
            Aprobar este informe para la familia
          </UButton>
        </template>
      </UCard>
    </template>
  </UContainer>
</template>
