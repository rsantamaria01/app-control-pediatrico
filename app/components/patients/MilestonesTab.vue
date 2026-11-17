<script setup lang="ts">
const props = defineProps<{ patientId: string }>()
const url = `/api/pacientes/${encodeURIComponent(props.patientId)}/preventivo`
const { data, error, refresh } = await useFetch<{ assessments: { id: string, label: string, domain: string, outcome: string, acquiredAgeMonths: number | null, privateNote: string | null }[], screenings: { id: string, instrument: string, category: string, appliedAt: string, result: string, privateNote: string | null }[], milestones: { id: string, label: string, source: string, minAgeMonths: string, maxAgeMonths: string }[], reminders: { key: string, label: string, ageMonths: number, source: string, version: string, sourcePage: string, badge: string }[], remindersAvailable: boolean }>(`${url}/desarrollo`)
const assessment = reactive({ label: '', domain: 'GROSS_MOTOR', outcome: 'NOT_ASSESSED', acquiredAgeMonths: undefined as number | undefined, privateNote: '' })
const screening = reactive({ category: 'DEVELOPMENT', instrument: '', appliedAt: new Date().toISOString().slice(0, 10), result: '', privateNote: '' })
const saveError = ref('')
const showAssessment = ref(false)
const showScreening = ref(false)
const domains: Record<string, string> = { GROSS_MOTOR: 'Motor grueso', FINE_MOTOR: 'Motor fino', LANGUAGE: 'Lenguaje', SOCIAL: 'Social', COGNITIVE: 'Cognitivo' }
const outcomes: Record<string, string> = { ACHIEVED: 'Logrado', NOT_ACHIEVED: 'No logrado', NOT_ASSESSED: 'No evaluado' }
const categories: Record<string, string> = { DEVELOPMENT: 'Desarrollo', AUTISM: 'Autismo' }
const months = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
async function saveAssessment() {
  saveError.value = ''
  try {
    await $fetch(`${url}/hitos`, { method: 'POST', body: { ...assessment, ...(assessment.outcome !== 'ACHIEVED' ? { acquiredAgeMonths: undefined } : {}) } })
    Object.assign(assessment, { label: '', outcome: 'NOT_ASSESSED', acquiredAgeMonths: undefined, privateNote: '' })
    showAssessment.value = false
    await refresh()
  } catch { saveError.value = 'Revise el hito, resultado y edad de adquisición.' }
}
async function saveScreening() {
  saveError.value = ''
  try {
    await $fetch(`${url}/tamizajes`, { method: 'POST', body: screening })
    Object.assign(screening, { instrument: '', result: '', privateNote: '' })
    showScreening.value = false
    await refresh()
  } catch { saveError.value = 'Registre el instrumento y resultado del tamizaje aplicado.' }
}
</script>

<template>
  <div class="grid items-start gap-4 xl:grid-cols-2">
    <UCard :ui="{ body: 'space-y-4 p-4 sm:p-5' }">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">
            Desarrollo
          </h2>
          <p class="text-xs text-muted">
            Observaciones registradas y ventanas de edad solo con fuente importada.
          </p>
        </div>
        <UButton
          variant="outline"
          color="neutral"
          class="min-h-11"
          @click="showAssessment = !showAssessment"
        >
          {{ showAssessment ? 'Cerrar formulario' : 'Registrar hito' }}
        </UButton>
      </div>
      <UAlert
        v-if="error"
        color="error"
        title="No se pudo consultar el desarrollo"
        :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
      />
      <template v-else-if="data">
        <UEmpty
          v-if="!data.milestones.length && !data.assessments.length"
          title="Sin hitos registrados ni referencias importadas"
          description="Puede registrar observaciones clínicas sin inferir edades esperadas ni requisitos entre hitos."
        />
        <p
          v-if="!data.milestones.length && data.assessments.length"
          class="text-sm text-muted"
        >
          No hay hitos OMS o CDC importados; no se muestran ventanas de edad sin fuente.
        </p>
        <div
          v-if="data.milestones.length"
          class="flex flex-wrap gap-2"
          aria-label="Áreas del desarrollo"
        >
          <UBadge
            v-for="(label, domain) in domains"
            :key="domain"
            color="neutral"
            variant="soft"
          >
            {{ label }}
          </UBadge>
        </div>
        <div
          v-if="data.milestones.length"
          class="space-y-2"
          aria-label="Hitos de referencia con fuente"
        >
          <div
            v-for="item in data.milestones"
            :key="item.id"
            class="flex flex-wrap items-center justify-between gap-2 border-t border-default py-2 text-sm"
          >
            <span class="font-medium">{{ item.label }}</span>
            <span class="text-muted tabular-nums">{{ item.minAgeMonths }}–{{ item.maxAgeMonths }} meses · {{ item.source }}</span>
          </div>
        </div>
        <div
          v-if="data.assessments.length"
          class="space-y-2"
        >
          <h3 class="text-sm font-semibold">
            Observaciones registradas
          </h3>
          <ul class="divide-y divide-default">
            <li
              v-for="item in data.assessments"
              :key="item.id"
              class="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
            >
              <div>
                <p class="font-semibold">
                  {{ item.label }}
                </p>
                <p class="text-xs text-muted">
                  {{ domains[item.domain] ?? item.domain }}<span v-if="item.privateNote"> · Nota clínica: {{ item.privateNote }}</span>
                </p>
              </div>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ outcomes[item.outcome] ?? item.outcome }}<span v-if="item.acquiredAgeMonths !== null"> · {{ months.format(item.acquiredAgeMonths) }} meses</span>
              </UBadge>
            </li>
          </ul>
        </div>
      </template>
      <form
        v-if="showAssessment"
        class="space-y-3 border-t border-default pt-4"
        @submit.prevent="saveAssessment"
      >
        <h3 class="font-medium">
          Registrar observación
        </h3>
        <UFormField label="Hito observado">
          <UInput
            v-model="assessment.label"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Área">
          <select
            v-model="assessment.domain"
            class="min-h-11 w-full rounded-md border border-default p-2"
          >
            <option value="GROSS_MOTOR">
              Motor grueso
            </option>
            <option value="FINE_MOTOR">
              Motor fino
            </option>
            <option value="LANGUAGE">
              Lenguaje
            </option>
            <option value="SOCIAL">
              Social
            </option>
            <option value="COGNITIVE">
              Cognitivo
            </option>
          </select>
        </UFormField>
        <UFormField label="Resultado">
          <select
            v-model="assessment.outcome"
            class="min-h-11 w-full rounded-md border border-default p-2"
          >
            <option value="ACHIEVED">
              Logrado
            </option>
            <option value="NOT_ACHIEVED">
              No logrado
            </option>
            <option value="NOT_ASSESSED">
              No evaluado
            </option>
          </select>
        </UFormField>
        <UFormField
          v-if="assessment.outcome === 'ACHIEVED'"
          label="Edad de adquisición (meses)"
        >
          <UInputNumber
            v-model="assessment.acquiredAgeMonths"
            :min="0"
            :max="252"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Nota clínica privada">
          <UTextarea
            v-model="assessment.privateNote"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          class="min-h-11"
        >
          Guardar observación
        </UButton>
      </form>
    </UCard>
    <UCard :ui="{ body: 'space-y-4 p-4 sm:p-5' }">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <h2 class="text-lg font-semibold">
          Tamizajes del desarrollo y autismo
        </h2>
        <UButton
          variant="outline"
          color="neutral"
          class="min-h-11"
          @click="showScreening = !showScreening"
        >
          {{ showScreening ? 'Cerrar formulario' : 'Registrar tamizaje' }}
        </UButton>
      </div>
      <p class="text-sm text-muted">
        {{ data?.remindersAvailable ? 'Recordatorios de catálogo en borrador para revisión médica; no indican aplicación.' : 'Recordatorios no disponibles: no hay catálogo de tamizajes importado con procedencia.' }} Un tamizaje figura como aplicado solo si se registran instrumento y resultado.
      </p>
      <ul
        v-if="data?.reminders.length"
        class="divide-y divide-default"
        aria-label="Tamizajes por revisar"
      >
        <li
          v-for="item in data.reminders"
          :key="item.key"
          class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
        >
          <span>{{ item.label }} · {{ item.ageMonths }} meses <span class="text-xs text-muted">· {{ item.source }} · {{ item.version }} · {{ item.sourcePage }}</span></span>
          <UBadge
            color="neutral"
            variant="soft"
          >
            {{ item.badge }}
          </UBadge>
        </li>
      </ul>
      <ul
        v-if="data?.screenings.length"
        class="divide-y divide-default"
      >
        <li
          v-for="item in data.screenings"
          :key="item.id"
          class="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
        >
          <span><strong>{{ categories[item.category] ?? item.category }} · {{ item.instrument }}</strong> · {{ item.result }}<span v-if="item.privateNote"> · Nota clínica: {{ item.privateNote }}</span></span>
          <UBadge
            color="neutral"
            variant="soft"
          >
            Aplicado · {{ dateFormat.format(new Date(`${item.appliedAt}T12:00:00Z`)) }}
          </UBadge>
        </li>
      </ul>
      <form
        v-if="showScreening"
        class="space-y-3 border-t border-default pt-4"
        @submit.prevent="saveScreening"
      >
        <UFormField label="Tipo">
          <select
            v-model="screening.category"
            class="min-h-11 w-full rounded-md border border-default p-2"
          >
            <option value="DEVELOPMENT">
              Desarrollo
            </option>
            <option value="AUTISM">
              Autismo
            </option>
          </select>
        </UFormField>
        <UFormField label="Instrumento aplicado">
          <UInput
            v-model="screening.instrument"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Fecha de aplicación">
          <UInput
            v-model="screening.appliedAt"
            type="date"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Resultado">
          <UTextarea
            v-model="screening.result"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Nota clínica privada">
          <UTextarea
            v-model="screening.privateNote"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          class="min-h-11"
        >
          Guardar tamizaje aplicado
        </UButton>
      </form>
      <UAlert
        v-if="saveError"
        color="error"
        :description="saveError"
      />
    </UCard>
  </div>
</template>
