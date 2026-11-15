<script setup lang="ts">
import { quickPatientSchema } from '#shared/types/patient-registration'
import { Gender } from '#shared/utils/enums'
import type { PatientView } from '#shared/types/measurement'

type Contact = { name: string, relationship: string, phone: string, email: string, invite: boolean, proof: string, confirmedGuardianId?: string, checked: boolean, match: { id: string, name: string, maskedContact: string } | null, confirmed: boolean, checkedKey: string }
const newContact = (): Contact => ({ name: '', relationship: '', phone: '', email: '', invite: false, proof: '', checked: false, match: null, confirmed: false, checkedKey: '' })
const state = reactive({ givenNames: '', surnames: '', birthDate: '', sex: Gender.FEMALE, nationalId: '', hsmRecord: '', contacts: [newContact()] })
const error = ref('')
const existingId = ref('')
const possibleMatches = ref<{ id: string, name: string }[]>([])
const confirmPossibleMatches = ref(false)
const saving = ref(false)
const validEmail = (value: string) => quickPatientSchema.shape.contacts.element.shape.email.safeParse(value).success && Boolean(value)
function key(contact: Contact) {
  return `${contact.email.trim().toLowerCase()}|${contact.phone.trim()}`
}
async function checkContact(contact: Contact) {
  contact.checked = false
  contact.match = null
  contact.confirmed = false
  error.value = ''
  try {
    const checkedKey = key(contact)
    const match = await $fetch<{ id: string, name: string, maskedContact: string } | null>('/api/guardian-grants/identity', { query: { ...(contact.email ? { email: contact.email } : {}), phone: contact.phone.startsWith('0') || contact.phone.startsWith('+593') ? contact.phone : `+593${contact.phone}` } })
    if (key(contact) !== checkedKey) return
    contact.match = match
    contact.checkedKey = checkedKey
    contact.checked = true
  } catch {
    error.value = 'No se pudo verificar la identidad. Revise el contacto e inténtelo otra vez.'
  }
}
async function save() {
  if (saving.value) return
  error.value = ''
  existingId.value = ''
  possibleMatches.value = []
  if (state.contacts.some(contact => !contact.checked || contact.checkedKey !== key(contact) || (contact.match && !contact.confirmed))) {
    error.value = 'Verifique cada representante y confirme las cuentas existentes antes de guardar.'
    return
  }
  if (state.contacts.some(contact => contact.invite && !validEmail(contact.email))) {
    error.value = 'Para enviar la invitación se requiere un correo electrónico válido.'
    return
  }
  saving.value = true
  try {
    const input = quickPatientSchema.parse({ givenNames: state.givenNames, surnames: state.surnames, birthDate: state.birthDate, sex: state.sex, ...(state.nationalId ? { nationalId: state.nationalId } : {}), ...(state.hsmRecord ? { hsmRecord: state.hsmRecord } : {}), confirmPossibleMatches: confirmPossibleMatches.value, contacts: state.contacts.map(contact => ({ name: contact.name, relationship: contact.relationship, phone: contact.phone.startsWith('0') || contact.phone.startsWith('+593') ? contact.phone : `+593${contact.phone}`, email: contact.email, invite: contact.invite && validEmail(contact.email), proof: contact.proof, ...(contact.match ? { confirmedGuardianId: contact.match.id } : {}) })) })
    const created = await $fetch<{ patient: PatientView, contacts: { status: string }[] }>('/api/pacientes/rapido', { method: 'POST', body: input })
    if (created.contacts.some(contact => contact.status === 'FAILED')) sessionStorage.setItem(`patient-contact-warning-${created.patient.id}`, 'Revise los contactos familiares: no se pudo completar uno o más vínculos o invitaciones. Puede reintentar desde la ficha.')
    await navigateTo(`/pacientes/${created.patient.id}`)
  } catch (cause) {
    const data = (cause as { data?: { data?: { existingPatientId?: string, possibleMatches?: { id: string, name: string }[] } } }).data?.data
    existingId.value = data?.existingPatientId ?? ''
    possibleMatches.value = data?.possibleMatches ?? []
    error.value = existingId.value ? 'Esta cédula ya está registrada.' : possibleMatches.value.length ? 'Encontramos posibles coincidencias. Revise las fichas antes de continuar.' : 'Revise los campos, la cédula y la verificación de los representantes.'
  } finally {
    saving.value = false
  }
}
watch(() => [state.givenNames, state.surnames, state.birthDate, state.nationalId], () => {
  confirmPossibleMatches.value = false
  possibleMatches.value = []
  existingId.value = ''
})
</script>

<template>
  <UContainer class="max-w-4xl space-y-6 py-8 pb-24">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">
        Nuevo paciente
      </h1>
      <UButton
        to="/pacientes"
        variant="outline"
        color="neutral"
        class="min-h-11"
      >
        Cancelar
      </UButton>
    </div>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :description="error"
      role="alert"
    />
    <UButton
      v-if="existingId"
      :to="`/pacientes/${existingId}`"
      variant="outline"
      class="min-h-11"
    >
      Abrir ficha existente
    </UButton>
    <div
      v-if="possibleMatches.length"
      class="space-y-3 rounded-lg border border-default p-4"
    >
      <p class="font-medium">
        Posibles pacientes existentes
      </p>
      <ul>
        <li
          v-for="match in possibleMatches"
          :key="match.id"
        >
          <UButton
            :to="`/pacientes/${match.id}`"
            variant="link"
            class="min-h-11"
          >
            Abrir ficha de {{ match.name }}
          </UButton>
        </li>
      </ul>
      <UCheckbox
        v-model="confirmPossibleMatches"
        label="He revisado las coincidencias y confirmo que es un paciente nuevo"
      />
    </div>
    <form
      class="space-y-6"
      @submit.prevent="save"
    >
      <UCard>
        <div class="space-y-4">
          <h2 class="text-lg font-semibold">
            Datos del paciente
          </h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Nombres"
              required
            >
              <UInput
                v-model="state.givenNames"
                class="w-full"
                required
                autocomplete="given-name"
              />
            </UFormField>
            <UFormField
              label="Apellidos"
              required
            >
              <UInput
                v-model="state.surnames"
                class="w-full"
                required
                autocomplete="family-name"
              />
            </UFormField>
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
              label="Sexo registrado al nacer"
              required
            >
              <USelect
                v-model="state.sex"
                :items="[{ label: 'Femenino', value: Gender.FEMALE }, { label: 'Masculino', value: Gender.MALE }]"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Cédula / NUI"
              hint="Opcional"
            >
              <UInput
                v-model="state.nationalId"
                inputmode="numeric"
                maxlength="10"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Historia clínica HSM"
              hint="Opcional"
            >
              <UInput
                v-model="state.hsmRecord"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </UCard>
      <UCard>
        <div class="space-y-5">
          <h2 class="text-lg font-semibold">
            Contacto familiar
          </h2>
          <div
            v-for="(contact, index) in state.contacts"
            :key="index"
            class="space-y-4 rounded-lg border border-default p-4"
          >
            <div class="flex items-center justify-between gap-2">
              <h3 class="font-medium">
                Representante {{ index + 1 }}
              </h3><UButton
                v-if="index"
                type="button"
                variant="ghost"
                class="min-h-11"
                @click="state.contacts.splice(index, 1)"
              >
                Quitar
              </UButton>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Nombre completo"
                required
              >
                <UInput
                  v-model="contact.name"
                  class="w-full"
                  required
                />
              </UFormField>
              <UFormField
                label="Parentesco"
                required
              >
                <UInput
                  v-model="contact.relationship"
                  class="w-full"
                  required
                />
              </UFormField>
              <UFormField
                label="Teléfono / WhatsApp"
                required
              >
                <UInput
                  v-model="contact.phone"
                  type="tel"
                  inputmode="tel"
                  class="w-full"
                  placeholder="99 123 4567"
                  required
                >
                  <template #leading>
                    <span class="text-sm text-muted">+593</span>
                  </template>
                </UInput>
              </UFormField>
              <UFormField
                label="Correo electrónico"
                hint="Opcional"
              >
                <UInput
                  v-model="contact.email"
                  type="email"
                  class="w-full"
                />
              </UFormField>
            </div>
            <UButton
              type="button"
              variant="outline"
              class="min-h-11"
              @click="checkContact(contact)"
            >
              Verificar representante
            </UButton>
            <p
              v-if="contact.checked && contact.checkedKey === key(contact) && !contact.match"
              class="text-sm"
              role="status"
            >
              Sin cuenta previa
            </p>
            <div
              v-if="contact.checked && contact.checkedKey === key(contact) && contact.match"
              class="space-y-2 rounded-lg border border-default p-3"
            >
              <p>Cuenta existente: {{ contact.match.name }} · {{ contact.match.maskedContact }}</p>
              <UCheckbox
                v-model="contact.confirmed"
                label="Confirmo que es la misma persona"
              />
            </div>
            <UFormField
              label="Cómo verificó el vínculo"
              required
            >
              <UTextarea
                v-model="contact.proof"
                class="w-full"
                required
              />
            </UFormField>
            <USwitch
              v-model="contact.invite"
              :disabled="!validEmail(contact.email)"
              label="Invitar al portal de padres"
            />
            <p class="text-sm text-muted">
              Para enviar la invitación se requiere un correo electrónico válido.
            </p>
          </div>
          <UButton
            type="button"
            variant="outline"
            class="min-h-11"
            :disabled="state.contacts.length >= 8"
            @click="state.contacts.push(newContact())"
          >
            Agregar otro representante
          </UButton>
        </div>
      </UCard>
      <UButton
        type="submit"
        size="lg"
        :loading="saving"
        :disabled="Boolean(possibleMatches.length && !confirmPossibleMatches)"
        class="min-h-11"
      >
        Crear paciente
      </UButton>
    </form>
  </UContainer>
</template>
