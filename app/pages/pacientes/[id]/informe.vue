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
const { data: legacyReports } = await useFetch<{ id: string, approvedAt: string }[]>(`${url}/anteriores`)

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
  <UContainer class="max-w-5xl space-y-6 py-5 pb-24 sm:py-8">
    <UAlert
      v-if="accessError"
      color="error"
      variant="soft"
      title="No se pudo abrir la ficha"
    />
    <template v-else-if="access">
      <nav
        aria-label="Ruta"
        class="flex items-center gap-2 text-sm text-muted"
      >
        <NuxtLink
          :to="`/pacientes/${id}`"
          class="hover:text-primary hover:underline"
        >Ficha del paciente</NuxtLink>
        <UIcon
          name="i-lucide-chevron-right"
          aria-hidden="true"
          class="size-4"
        />
        <span aria-current="page" class="font-semibold text-default">
          Informe
        </span>
      </nav>
      <div class="space-y-1">
        <h1 class="text-2xl font-bold tracking-tight">
          Informe de crecimiento
        </h1>
        <p class="text-sm text-muted">
          Prepare una vista previa y apruebe el documento que recibirá la familia.
        </p>
      </div>
      <UCard :ui="{ body: 'space-y-5 p-4 sm:p-6' }">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold">
            Informe familiar
          </h2>
          <p class="text-sm text-muted">
            Solo controles compartidos, mediciones, curvas OMS verificadas e indicaciones compartidas. Sin puntuaciones Z, interpretación ni notas clínicas privadas.
          </p>
        </div>
        <div
          v-if="legacyReports?.length"
          class="space-y-2 rounded-lg border border-default bg-elevated p-4"
        >
          <p class="font-medium">
            Informe anterior sin PDF descargable
          </p>
          <p>Requiere una nueva vista previa y aprobación médica.</p>
          <p
            v-for="report in legacyReports"
            :key="report.id"
            class="text-sm text-muted"
          >
            Aprobado anteriormente el {{ date.format(new Date(report.approvedAt)) }} · {{ report.id }}
          </p>
        </div>
        <UButton
          :disabled="busy"
          :loading="busy"
          icon="i-lucide-file-text"
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
        <div
          v-if="draft"
          class="space-y-5 border-t border-default pt-5"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">
                Vista previa del PDF familiar
              </h3>
              <p class="text-sm text-muted">
                {{ draft.content.name }} · emitido el {{ date.format(new Date(draft.createdAt)) }}
              </p>
            </div>
            <UBadge
              :color="approved ? 'primary' : 'neutral'"
              variant="subtle"
              role="status"
            >
              {{ approved ? 'Aprobado para la familia' : 'Pendiente de aprobación' }}
            </UBadge>
          </div>
          <div class="rounded-lg border border-default bg-elevated p-2 sm:p-4">
            <iframe
              :src="`${url}/${encodeURIComponent(draft.id)}/vista-previa`"
              title="Documento PDF familiar para revisión antes de aprobar"
              class="block h-[70vh] min-h-[480px] w-full rounded-lg border border-default bg-default"
            />
          </div>
          <div class="space-y-3 rounded-lg border border-default p-4">
            <h3 class="font-semibold">
              Controles incluidos
            </h3>
            <div
              v-for="visit in draft.content.visits"
              :key="visit.id"
              class="border-b border-default pb-3 text-sm last:border-0 last:pb-0"
            >
              <p class="font-medium">
                {{ date.format(new Date(visit.measuredAt)) }}
              </p>
              <p class="mt-1 tabular-nums">
                Peso {{ number.format(visit.weightKg) }} kg · {{ visit.position === 'RECUMBENT' ? 'Longitud' : 'Talla' }} {{ number.format(visit.lengthHeightCm) }} cm · Perímetro cefálico {{ number.format(visit.headCircumferenceCm) }} cm
              </p>
              <p v-if="visit.parentAdvice" class="mt-1">
                Indicaciones: {{ visit.parentAdvice }}
              </p>
              <p v-if="visit.nextControlAt" class="mt-1">
                Próximo control: {{ date.format(new Date(visit.nextControlAt)) }}
              </p>
            </div>
            <p class="text-sm text-muted">
              {{ Object.keys(draft.content.charts).length ? 'El PDF incluye curvas OMS verificadas y las mediciones compartidas.' : 'Referencia OMS no disponible para este informe.' }}
            </p>
          </div>
          <UAlert
            v-if="!approved"
            color="neutral"
            variant="soft"
            title="Revise el documento antes de compartirlo"
            description="La familia podrá descargar exactamente este PDF después de su aprobación."
          />
          <UButton
            v-if="!approved"
            :disabled="busy"
            :loading="busy"
            icon="i-lucide-check"
            class="min-h-11"
            @click="approve"
          >
            Aprobar este informe para la familia
          </UButton>
        </div>
      </UCard>
      <UCard :ui="{ body: 'space-y-4 p-4 sm:p-6' }">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold">
            Informe médico
          </h2>
          <p class="text-sm text-muted">
            Contiene resultados clínicos y referencias para uso médico. Es independiente del informe aprobado para la familia.
          </p>
        </div>
        <UCheckbox
          v-model="includePrivateNotes"
          label="Incluir notas clínicas privadas en el PDF médico"
        />
        <UButton
          :href="`${url}/medico${includePrivateNotes ? '?includePrivateNotes=true' : ''}`"
          target="_blank"
          rel="noopener"
          icon="i-lucide-download"
          variant="outline"
          color="neutral"
          class="min-h-11"
        >
          Descargar PDF médico
        </UButton>
      </UCard>
    </template>
  </UContainer>
</template>
