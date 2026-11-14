<script setup lang="ts">
import type { PatientView, VisitSnapshot } from '#shared/types/measurement'

const route = useRoute()
const id = route.params.id as string
const { data: patient } = await useFetch<PatientView>(`/api/pacientes/${encodeURIComponent(id)}/identidad`)
const state = reactive({ measuredAt: '', weightKg: undefined as number | undefined, lengthHeightCm: undefined as number | undefined, position: 'RECUMBENT' as 'RECUMBENT' | 'STANDING', headCircumferenceCm: undefined as number | undefined, privateNote: '', parentAdvice: '', clinicianTrend: '' })
const requestId = ref(crypto.randomUUID())

const error = ref('')
const saving = ref(false)
async function save() {
  saving.value = true
  error.value = ''
  try {
    await $fetch<VisitSnapshot>(`/api/pacientes/${encodeURIComponent(id)}/visitas`, { method: 'POST', body: {
      requestId: requestId.value, measuredAt: new Date(`${state.measuredAt}:00-05:00`).toISOString(), weightKg: state.weightKg,
      lengthHeightCm: state.lengthHeightCm, position: state.position, headCircumferenceCm: state.headCircumferenceCm,
      privateNote: state.privateNote, parentAdvice: state.parentAdvice, clinicianTrend: state.clinicianTrend
    } })
    await navigateTo(`/pacientes/${id}`)
  } catch {
    error.value = 'No se pudo guardar la visita. Revise las medidas y vuelva a intentarlo.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-3xl space-y-6 py-8 pb-24">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">
          Nueva visita
        </h1>
        <p
          v-if="patient"
          class="text-muted"
        >
          {{ patient.name }}
        </p>
      </div>
      <UButton
        :to="`/pacientes/${id}`"
        variant="outline"
        color="neutral"
      >
        Cancelar
      </UButton>
    </div>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :description="error"
    />
    <form
      class="space-y-5"
      @submit.prevent="save"
    >
      <UCard>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Fecha y hora"
            required
          >
            <UInput
              v-model="state.measuredAt"
              type="datetime-local"
              class="w-full"
              required
            />
          </UFormField>
          <UFormField
            label="Peso (kg)"
            required
          >
            <UInputNumber
              v-model="state.weightKg"
              :min="0.01"
              :max="250"
              :step="0.01"
              :increment="false"
              :decrement="false"
              class="w-full"
              required
            />
          </UFormField>
          <UFormField
            label="Longitud o talla (cm)"
            required
          >
            <UInputNumber
              v-model="state.lengthHeightCm"
              :min="40"
              :max="220"
              :step="0.1"
              :increment="false"
              :decrement="false"
              class="w-full"
              required
            />
          </UFormField>
          <UFormField label="Posición">
            <USelect
              v-model="state.position"
              :items="[{ label: 'Acostado', value: 'RECUMBENT' }, { label: 'De pie', value: 'STANDING' }]"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Perímetro cefálico (cm)"
            required
          >
            <UInputNumber
              v-model="state.headCircumferenceCm"
              :min="20"
              :max="80"
              :step="0.1"
              :increment="false"
              :decrement="false"
              class="w-full"
              required
            />
          </UFormField>
        </div>
      </UCard>
      <UCard>
        <div class="space-y-4">
          <h2 class="font-semibold">
            Observaciones y recomendaciones
          </h2>
          <UFormField label="Nota privada">
            <UTextarea
              v-model="state.privateNote"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Recomendaciones para la familia">
            <UTextarea
              v-model="state.parentAdvice"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Tendencia marcada por el profesional">
            <UTextarea
              v-model="state.clinicianTrend"
              class="w-full"
            />
          </UFormField>
          <p class="text-sm text-muted">
            Las notas privadas y la tendencia no se comparten con la familia.
          </p>
        </div>
      </UCard>
      <UButton
        type="submit"
        size="lg"
        :loading="saving"
        class="min-h-11"
      >
        Guardar visita
      </UButton>
    </form>
  </UContainer>
</template>
