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
  <div class="min-h-screen bg-muted">
    <div class="flex min-h-16 items-center gap-3 border-b border-default bg-default px-4 sm:px-6">
      <UButton
        to="/pacientes"
        icon="i-lucide-x"
        variant="ghost"
        color="neutral"
        aria-label="Volver a pacientes"
        class="min-h-11 lg:hidden"
      />
      <div class="min-w-0 flex-1">
        <p class="hidden text-sm text-muted lg:block">
          <NuxtLink
            to="/pacientes"
            class="hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
          >Pacientes</NuxtLink> › <strong class="font-semibold text-default">Nuevo paciente</strong>
        </p>
        <h1 class="text-base font-semibold lg:sr-only">
          Nuevo paciente
        </h1>
      </div>
      <UButton
        to="/pacientes"
        variant="outline"
        color="neutral"
        class="hidden min-h-11 sm:inline-flex"
      >
        Cancelar
      </UButton>
      <UButton
        type="submit"
        form="new-patient-form"
        :loading="saving"
        :disabled="Boolean(possibleMatches.length && !confirmPossibleMatches)"
        class="hidden min-h-11 sm:inline-flex"
      >
        Crear paciente
      </UButton>
    </div>
    <UContainer class="max-w-[920px] space-y-5 px-4 py-6 pb-32 sm:px-6 sm:pb-24">
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
        class="space-y-3 rounded-xl border border-default bg-default p-4"
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
        id="new-patient-form"
        class="space-y-5"
        @submit.prevent="save"
      >
        <UCard :ui="{ body: 'p-5 sm:p-5' }">
          <div class="space-y-4">
            <h2 class="text-lg font-semibold">
              Datos del paciente
            </h2>
            <div class="grid gap-4 sm:grid-cols-4">
              <UFormField
                class="sm:col-span-2"
                label="Nombres"
                required
              >
                <UInput
                  v-model="state.givenNames"
                  name="givenNames"
                  class="w-full"
                  size="lg"
                  required
                  autocomplete="given-name"
                />
              </UFormField>
              <UFormField
                class="sm:col-span-2"
                label="Apellidos"
                required
              >
                <UInput
                  v-model="state.surnames"
                  name="surnames"
                  class="w-full"
                  size="lg"
                  required
                  autocomplete="family-name"
                />
              </UFormField>
              <UFormField
                class="sm:col-span-2"
                label="Sexo registrado al nacer"
                required
              >
                <URadioGroup
                  v-model="state.sex"
                  name="sex"
                  :items="[{ label: 'Masculino', value: Gender.MALE }, { label: 'Femenino', value: Gender.FEMALE }]"
                  variant="card"
                  orientation="horizontal"
                  required
                  :ui="{ fieldset: 'flex gap-2', item: 'min-h-11 min-w-0 flex-1 rounded-lg px-3 py-2', label: 'text-sm' }"
                />
              </UFormField>
              <UFormField
                label="Fecha de nacimiento"
                required
              >
                <UInput
                  v-model="state.birthDate"
                  name="birthDate"
                  type="date"
                  class="w-full"
                  size="lg"
                  required
                />
              </UFormField>
              <UFormField
                label="Cédula / NUI"
                hint="Opcional"
              >
                <UInput
                  v-model="state.nationalId"
                  name="nationalId"
                  inputmode="numeric"
                  maxlength="10"
                  class="w-full"
                  size="lg"
                />
              </UFormField>
              <UFormField
                class="sm:col-span-2"
                label="Historia clínica HSM"
                hint="Opcional"
              >
                <UInput
                  v-model="state.hsmRecord"
                  name="hsmRecord"
                  class="w-full"
                  size="lg"
                />
              </UFormField>
            </div>
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-5 sm:p-5' }">
          <div class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-lg font-semibold">
                Contacto familiar
              </h2>
              <UButton
                type="button"
                variant="ghost"
                icon="i-lucide-plus"
                class="min-h-11"
                :disabled="state.contacts.length >= 8"
                @click="state.contacts.push(newContact())"
              >
                Agregar otro representante
              </UButton>
            </div>
            <div
              v-for="(contact, index) in state.contacts"
              :key="index"
              class="space-y-4 rounded-xl border border-default p-4"
            >
              <div
                v-if="index"
                class="flex items-center justify-between gap-2"
              >
                <h3 class="font-medium">
                  Representante {{ index + 1 }}
                </h3>
                <UButton
                  type="button"
                  variant="ghost"
                  color="neutral"
                  class="min-h-11"
                  @click="state.contacts.splice(index, 1)"
                >
                  Quitar
                </UButton>
              </div>
              <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <UFormField
                  label="Nombre completo"
                  required
                >
                  <UInput
                    v-model="contact.name"
                    :name="`contacts[${index}].name`"
                    class="w-full"
                    size="lg"
                    required
                    autocomplete="name"
                  />
                </UFormField>
                <UFormField
                  label="Parentesco"
                  required
                >
                  <UInput
                    v-model="contact.relationship"
                    :name="`contacts[${index}].relationship`"
                    class="w-full"
                    size="lg"
                    required
                  />
                </UFormField>
                <UFormField
                  label="Correo electrónico"
                  hint="Opcional"
                >
                  <UInput
                    v-model="contact.email"
                    :name="`contacts[${index}].email`"
                    type="email"
                    autocomplete="email"
                    class="w-full"
                    size="lg"
                  />
                </UFormField>
                <UFormField
                  label="Teléfono / WhatsApp"
                  required
                >
                  <UInput
                    v-model="contact.phone"
                    :name="`contacts[${index}].phone`"
                    type="tel"
                    inputmode="tel"
                    autocomplete="tel"
                    class="w-full"
                    size="lg"
                    placeholder="99 123 4567"
                    required
                  >
                    <template #leading>
                      <span class="text-sm text-muted">+593</span>
                    </template>
                  </UInput>
                </UFormField>
              </div>
              <div class="flex flex-wrap items-center gap-3">
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
                  class="text-sm text-muted"
                  role="status"
                >
                  Sin cuenta previa
                </p>
              </div>
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
                  :name="`contacts[${index}].proof`"
                  class="w-full"
                  required
                />
              </UFormField>
              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-3">
                <div>
                  <p class="font-medium">
                    Acceso familiar
                  </p>
                  <p class="text-sm text-muted">
                    Para enviar la invitación se requiere un correo electrónico válido.
                  </p>
                </div>
                <USwitch
                  v-model="contact.invite"
                  :disabled="!validEmail(contact.email)"
                  label="Invitar al portal de padres"
                />
              </div>
            </div>
          </div>
        </UCard>
        <p class="text-xs text-muted">
          Al crear, se abre la ficha del paciente para registrar su primera visita o agendar una cita.
        </p>
      </form>
    </UContainer>
    <div class="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-default bg-default px-4 py-3 sm:hidden">
      <UButton
        type="submit"
        form="new-patient-form"
        block
        size="lg"
        :loading="saving"
        :disabled="Boolean(possibleMatches.length && !confirmPossibleMatches)"
        class="min-h-11"
      >
        Crear paciente
      </UButton>
    </div>
  </div>
</template>
