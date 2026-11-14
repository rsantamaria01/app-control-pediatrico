<script setup lang="ts">
import { patientSchema, type PatientView } from '#shared/types/measurement'
import { Gender } from '#shared/utils/enums'

const state = reactive({ name: '', birthDate: '', sex: Gender.FEMALE, gestationWeeks: undefined as number | undefined, gestationExtraDays: 0, correctionUntilMonths: 24 as 24 | 36, birthWeightKg: undefined as number | undefined, birthLengthCm: undefined as number | undefined, birthHeadCircumferenceCm: undefined as number | undefined })
const error = ref('')
const saving = ref(false)
async function save() {
  error.value = ''
  saving.value = true
  try {
    const input = patientSchema.parse({ name: state.name, birthDate: state.birthDate, sex: state.sex, correctionUntilMonths: state.correctionUntilMonths,
      ...(state.gestationWeeks !== undefined ? { gestationDays: state.gestationWeeks * 7 + state.gestationExtraDays } : {}),
      ...(state.birthWeightKg !== undefined ? { birthWeightKg: state.birthWeightKg } : {}),
      ...(state.birthLengthCm !== undefined ? { birthLengthCm: state.birthLengthCm } : {}),
      ...(state.birthHeadCircumferenceCm !== undefined ? { birthHeadCircumferenceCm: state.birthHeadCircumferenceCm } : {}) })
    const patient = await $fetch<PatientView>('/api/pacientes', { method: 'POST', body: input })
    await navigateTo(`/pacientes/${patient.id}`)
  } catch {
    error.value = 'Revise los datos del paciente y vuelva a intentarlo.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-4xl space-y-6 py-8 pb-24">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">
        Nuevo paciente
      </h1>
      <UButton
        to="/pacientes"
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
      class="space-y-6"
      @submit.prevent="save"
    >
      <UCard>
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">
            Datos del niño o niña
          </h2>
          <UFormField
            label="Nombre completo"
            required
          >
            <UInput
              v-model="state.name"
              class="w-full"
              required
              autocomplete="name"
            />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Fecha de nacimiento"
              required
            >
              <UInput
                v-model="state.birthDate"
                type="date"
                class="w-full"
                required
              />
            </UFormField>
            <UFormField
              label="Sexo"
              required
            >
              <USelect
                v-model="state.sex"
                :items="[{ label: 'Femenino', value: Gender.FEMALE }, { label: 'Masculino', value: Gender.MALE }]"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </UCard>
      <UCard>
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">
            Antecedentes al nacer
          </h2>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UFormField label="Edad gestacional (semanas)">
              <UInputNumber
                v-model="state.gestationWeeks"
                :min="20"
                :max="40"
                :increment="false"
                :decrement="false"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Días adicionales">
              <UInputNumber
                v-model="state.gestationExtraDays"
                :min="0"
                :max="6"
                :increment="false"
                :decrement="false"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Peso al nacer (kg)">
              <UInputNumber
                v-model="state.birthWeightKg"
                :min="0.1"
                :max="20"
                :step="0.01"
                :increment="false"
                :decrement="false"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Talla al nacer (cm)">
              <UInputNumber
                v-model="state.birthLengthCm"
                :min="20"
                :max="80"
                :step="0.1"
                :increment="false"
                :decrement="false"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Perímetro cefálico al nacer (cm)">
              <UInputNumber
                v-model="state.birthHeadCircumferenceCm"
                :min="20"
                :max="60"
                :step="0.1"
                :increment="false"
                :decrement="false"
                class="w-full"
              />
            </UFormField>
          </div>
          <UCheckbox
            :model-value="state.correctionUntilMonths === 36"
            label="Prematuro extremo: extender la edad corregida hasta 36 meses"
            @update:model-value="state.correctionUntilMonths = $event ? 36 : 24"
          />
          <p class="text-sm text-muted">
            La edad corregida se usa hasta los 24 meses; la extensión a 36 meses requiere menos de 28 semanas.
          </p>
        </div>
      </UCard>
      <UButton
        type="submit"
        size="lg"
        :loading="saving"
        class="min-h-11"
      >
        Crear paciente
      </UButton>
    </form>
  </UContainer>
</template>
