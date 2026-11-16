<script setup lang="ts">
const props = defineProps<{ patientId: string }>()
const url = `/api/pacientes/${encodeURIComponent(props.patientId)}/preventivo`
const { data, error, refresh } = await useFetch<{ assessments: { id: string, label: string, domain: string, outcome: string, acquiredAgeMonths: number | null, privateNote: string | null }[], screenings: { id: string, instrument: string, category: string, appliedAt: string, result: string, privateNote: string | null }[], milestones: { id: string, label: string, source: string, minAgeMonths: string, maxAgeMonths: string }[], reminders: unknown[] }>(`${url}/desarrollo`)
const assessment = reactive({ label: '', domain: 'GROSS_MOTOR', outcome: 'NOT_ASSESSED', acquiredAgeMonths: undefined as number | undefined, privateNote: '' })
const screening = reactive({ category: 'DEVELOPMENT', instrument: '', appliedAt: new Date().toISOString().slice(0, 10), result: '', privateNote: '' })
const saveError = ref('')
async function saveAssessment() {
  saveError.value = ''
  try {
    await $fetch(`${url}/hitos`, { method: 'POST', body: { ...assessment, ...(assessment.outcome !== 'ACHIEVED' ? { acquiredAgeMonths: undefined } : {}) } })
    Object.assign(assessment, { label: '', outcome: 'NOT_ASSESSED', acquiredAgeMonths: undefined, privateNote: '' })
    await refresh()
  } catch { saveError.value = 'Revise el hito, resultado y edad de adquisición.' }
}
async function saveScreening() {
  saveError.value = ''
  try {
    await $fetch(`${url}/tamizajes`, { method: 'POST', body: screening })
    Object.assign(screening, { instrument: '', result: '', privateNote: '' })
    await refresh()
  } catch { saveError.value = 'Registre el instrumento y resultado del tamizaje aplicado.' }
}
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <UCard class="space-y-3">
      <h2 class="text-lg font-semibold">
        Desarrollo
      </h2>
      <UAlert
        v-if="error"
        color="error"
        title="No se pudo consultar el desarrollo"
        :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
      />
      <template v-else-if="data">
        <UEmpty
          v-if="!data.milestones.length && !data.assessments.length"
          title="Sin hitos de referencia validados"
          description="Puede registrar observaciones clínicas sin inferir edades esperadas ni requisitos entre hitos."
        />
        <p
          v-if="!data.milestones.length"
          class="text-sm text-muted"
        >
          No hay hitos OMS o CDC importados; no se muestran ventanas de edad sin fuente.
        </p>
        <ul class="divide-y divide-default">
          <li
            v-for="item in data.assessments"
            :key="item.id"
            class="py-2 text-sm"
          >
            {{ item.label }} · {{ item.domain }} · {{ item.outcome }}<span v-if="item.acquiredAgeMonths !== null"> · {{ item.acquiredAgeMonths }} meses</span><span v-if="item.privateNote"> · Nota clínica: {{ item.privateNote }}</span>
          </li>
        </ul>
      </template>
      <form
        class="space-y-3"
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
    <UCard class="space-y-3">
      <h2 class="text-lg font-semibold">
        Tamizajes
      </h2>
      <p class="text-sm text-muted">
        No hay recordatorios importados sin fuente validada. Un tamizaje figura como aplicado solo si se registran instrumento y resultado.
      </p>
      <ul
        v-if="data?.screenings.length"
        class="divide-y divide-default"
      >
        <li
          v-for="item in data.screenings"
          :key="item.id"
          class="py-2 text-sm"
        >
          {{ item.category }} · {{ item.instrument }} · {{ item.appliedAt }} · {{ item.result }}<span v-if="item.privateNote"> · Nota clínica: {{ item.privateNote }}</span>
        </li>
      </ul>
      <form
        class="space-y-3"
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
