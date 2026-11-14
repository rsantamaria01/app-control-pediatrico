<script setup lang="ts">
import type { PatientView, VisitSnapshot } from '#shared/types/measurement'
import { ecuadorIdSchema } from '#shared/types/patient-registration'
import { formatGrowthValues } from '#shared/utils/growth-result'
import type { WhoIndicator } from '#shared/utils/enums'

const route = useRoute()
const id = route.params.id as string
const { data, error, refresh } = await useFetch<{ patient: PatientView, visits: VisitSnapshot[] }>(`/api/pacientes/${encodeURIComponent(id)}`)
const { data: navigation } = await useFetch<{ to: string }[]>('/api/auth/navigation')
const isDoctor = computed(() => navigation.value?.some(item => item.to === '/pacientes') ?? false)
const latest = computed(() => data.value?.visits[0])
const sharing = reactive<Record<string, boolean>>({})
const { data: sharingState } = await useFetch<Record<string, boolean>>(`/api/pacientes/${encodeURIComponent(id)}/visitas/compartir`, { immediate: isDoctor.value })
const { data: guardianStatus } = await useFetch<{ guardians: { email: string, status: string, lastSendError: string | null }[] }>(`/api/guardian-grants/${encodeURIComponent(id)}`, { immediate: isDoctor.value })
const { data: pendingContacts, refresh: refreshPendingContacts } = await useFetch<{ id: string, name: string, relationship: string, phone: string, email: string | null }[]>(`/api/pacientes/${encodeURIComponent(id)}/contactos-pendientes`, { immediate: isDoctor.value, default: () => [] })
const contactMatches = reactive<Record<string, { id: string, name: string, maskedContact: string } | null>>({})
const contactChecked = reactive<Record<string, boolean>>({})
const contactConfirmed = reactive<Record<string, boolean>>({})
const contactErrors = reactive<Record<string, string>>({})
const contactEdits = reactive<Record<string, { name: string, relationship: string, phone: string, email: string, proof: string }>>({})
function editableContact(contact: { id: string, name: string, relationship: string, phone: string, email: string | null }) {
  contactEdits[contact.id] ??= { name: contact.name, relationship: contact.relationship, phone: contact.phone, email: contact.email ?? '', proof: '' }
  return contactEdits[contact.id]!
}
async function checkPendingContact(contact: { id: string, name: string, relationship: string, phone: string, email: string | null }) {
  contactChecked[contact.id] = false
  contactConfirmed[contact.id] = false
  contactErrors[contact.id] = ''
  try {
    const edit = editableContact(contact)
    contactMatches[contact.id] = await $fetch('/api/guardian-grants/identity', { query: { phone: edit.phone, ...(edit.email ? { email: edit.email } : {}) } })
    contactChecked[contact.id] = true
  } catch {
    contactErrors[contact.id] = 'No se pudo verificar esta identidad. Revise el contacto con la familia.'
  }
}
async function retryContact(contact: { id: string, name: string, relationship: string, phone: string, email: string | null }) {
  if (!contactChecked[contact.id] || (contactMatches[contact.id] && !contactConfirmed[contact.id])) return
  contactErrors[contact.id] = ''
  const edit = editableContact(contact)
  const changed = edit.name !== contact.name || edit.relationship !== contact.relationship || edit.phone !== contact.phone || edit.email !== (contact.email ?? '')
  if (changed && edit.proof.trim().length < 8) {
    contactErrors[contact.id] = 'Registre cómo verificó nuevamente el vínculo antes de cambiar los datos.'
    return
  }
  try {
    const result = await $fetch<{ status: string }>(`/api/pacientes/${encodeURIComponent(id)}/contactos-pendientes/${encodeURIComponent(contact.id)}`, { method: 'POST', body: { ...(contactMatches[contact.id] ? { confirmedGuardianId: contactMatches[contact.id]!.id } : {}), ...(changed ? { name: edit.name, relationship: edit.relationship, phone: edit.phone, ...(edit.email ? { email: edit.email } : {}), proof: edit.proof } : {}) } })
    await refreshPendingContacts()
    if (result.status === 'FAILED') contactErrors[contact.id] = 'Vínculo registrado, pero falló el correo. Reenvíe la invitación desde Acceso familiar.'
  } catch {
    contactErrors[contact.id] = 'No se pudo vincular. Verifique los datos y vuelva a intentarlo.'
  }
}
function guardianLabel(status: string) {
  return status === 'ACTIVE' ? 'Activo' : status === 'PENDING' ? 'Pendiente de activación' : status === 'FAILED' ? 'Envío fallido · Reenviar invitación' : 'Sin invitar'
}
const shareError = ref('')
const patientWarning = ref('')
onMounted(() => {
  patientWarning.value = sessionStorage.getItem(`patient-contact-warning-${id}`) ?? ''
  sessionStorage.removeItem(`patient-contact-warning-${id}`)
})
const identity = ref('')
const identityError = ref('')
const history = reactive({ gestationWeeks: undefined as number | undefined, gestationExtraDays: 0, birthWeightKg: undefined as number | undefined, birthLengthCm: undefined as number | undefined, birthHeadCircumferenceCm: undefined as number | undefined, perinatalNotes: '', correctionUntilMonths: 24 as 24 | 36 })
let savedHistory: typeof history | undefined
watch(() => data.value?.patient, (person) => {
  if (!person) return
  Object.assign(history, {
    gestationWeeks: person.gestationDays === undefined ? undefined : Math.floor(person.gestationDays / 7),
    gestationExtraDays: person.gestationDays === undefined ? 0 : person.gestationDays % 7,
    birthWeightKg: person.birthWeightKg,
    birthLengthCm: person.birthLengthCm,
    birthHeadCircumferenceCm: person.birthHeadCircumferenceCm,
    perinatalNotes: person.perinatalNotes ?? '',
    correctionUntilMonths: person.correctionUntilMonths
  })
  savedHistory = { ...history }
}, { immediate: true })
const historyError = ref('')
async function saveIdentity() {
  identityError.value = ''
  if (!ecuadorIdSchema.safeParse(identity.value).success) {
    identityError.value = 'Cédula ecuatoriana inválida'
    return
  }
  try {
    await $fetch(`/api/pacientes/${encodeURIComponent(id)}/cedula`, { method: 'PATCH', body: { nationalId: identity.value } })
    await refresh()
  } catch { identityError.value = 'No se pudo guardar la cédula; revise si ya existe otra ficha.' }
}
async function saveHistory() {
  historyError.value = ''
  try {
    if (!savedHistory) return
    const body = {
      ...((history.gestationWeeks !== savedHistory.gestationWeeks || history.gestationExtraDays !== savedHistory.gestationExtraDays) && history.gestationWeeks !== undefined ? { gestationDays: history.gestationWeeks * 7 + history.gestationExtraDays } : {}),
      ...(history.birthWeightKg !== savedHistory.birthWeightKg && history.birthWeightKg !== undefined ? { birthWeightKg: history.birthWeightKg } : {}),
      ...(history.birthLengthCm !== savedHistory.birthLengthCm && history.birthLengthCm !== undefined ? { birthLengthCm: history.birthLengthCm } : {}),
      ...(history.birthHeadCircumferenceCm !== savedHistory.birthHeadCircumferenceCm && history.birthHeadCircumferenceCm !== undefined ? { birthHeadCircumferenceCm: history.birthHeadCircumferenceCm } : {}),
      ...(history.perinatalNotes !== savedHistory.perinatalNotes ? { perinatalNotes: history.perinatalNotes } : {}),
      ...(history.correctionUntilMonths !== savedHistory.correctionUntilMonths ? { correctionUntilMonths: history.correctionUntilMonths } : {})
    }
    await $fetch(`/api/pacientes/${encodeURIComponent(id)}/antecedentes`, { method: 'PATCH', body })
    await refresh()
  } catch { historyError.value = 'No se pudieron guardar los antecedentes. Revise las medidas y la edad gestacional.' }
}
async function changeSharing(visitId: string, shared: boolean) {
  shareError.value = ''
  try {
    await $fetch(`/api/pacientes/${encodeURIComponent(id)}/visitas/${encodeURIComponent(visitId)}/compartir`, { method: 'PATCH', body: { shared } })
    sharing[visitId] = shared
  } catch {
    shareError.value = 'No se pudo actualizar el acceso de la familia.'
  }
}
const latestResults = computed(() => latest.value?.results.filter(result => result.parentResultId === null) ?? [])
const recalculations = computed(() => [...new Set(latest.value?.results.map(result => result.recalculationId).filter((id): id is string => Boolean(id)) ?? [])])
const labels: Record<WhoIndicator, string> = {
  HEIGHT_FOR_AGE: 'Longitud/talla para la edad', WEIGHT_FOR_AGE: 'Peso para la edad',
  WEIGHT_FOR_LENGTH: 'Peso para la longitud', WEIGHT_FOR_HEIGHT: 'Peso para la talla',
  BMI_FOR_AGE: 'IMC para la edad', HEAD_CIRCUMFERENCE_FOR_AGE: 'Perímetro cefálico para la edad'
}
const weightFormat = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const lengthFormat = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-8 pb-24">
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo abrir la ficha"
      description="Compruebe su conexión e inténtelo otra vez."
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="data">
      <nav
        aria-label="Ruta"
        class="flex items-center gap-2 text-sm"
      >
        <NuxtLink
          to="/pacientes"
          class="text-primary hover:underline"
        >Pacientes</NuxtLink>
        <span class="text-muted">/</span>
        <span>{{ data.patient.name }}</span>
      </nav>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">
            {{ data.patient.name }}
          </h1>
          <p class="text-sm text-muted">
            {{ data.patient.sex === 'FEMALE' ? 'Niña' : 'Niño' }} · Nacimiento {{ data.patient.birthDate }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            :to="`/representantes/invitar?patient=${encodeURIComponent(id)}`"
            variant="outline"
            size="lg"
          >
            Invitar representante
          </UButton>
          <UButton
            :to="`/pacientes/${id}/visitas/nueva`"
            icon="i-lucide-plus"
            size="lg"
          >
            Nueva visita
          </UButton>
        </div>
      </div>
      <UAlert
        v-if="patientWarning"
        color="warning"
        variant="soft"
        :description="patientWarning"
      />
      <UCard class="space-y-4">
        <h2 class="font-semibold">
          Identificación y antecedentes perinatales
        </h2>
        <p>Fecha de nacimiento: {{ data.patient.birthDate }} · Cédula / NUI: {{ data.patient.nationalId ?? 'Sin registrar' }} · Historia clínica HSM: {{ data.patient.hsmRecord ?? 'Sin registrar' }}</p>
        <p>{{ data.patient.gestationDays === undefined ? 'Edad gestacional sin registrar · se considera a término hasta que se registre' : `Edad gestacional: ${Math.floor(data.patient.gestationDays / 7)} semanas y ${data.patient.gestationDays % 7} días` }}</p>
        <p v-if="data.patient.perinatalNotes">
          {{ data.patient.perinatalNotes }}
        </p>
        <form
          v-if="!data.patient.nationalId"
          class="flex flex-wrap items-end gap-3"
          @submit.prevent="saveIdentity"
        >
          <UFormField label="Agregar cédula / NUI">
            <UInput
              v-model="identity"
              inputmode="numeric"
              maxlength="10"
            />
          </UFormField>
          <UButton
            type="submit"
            class="min-h-11"
          >
            Guardar cédula
          </UButton>
        </form>
        <UAlert
          v-if="identityError"
          color="error"
          variant="soft"
          :description="identityError"
        />
        <form
          class="space-y-3"
          @submit.prevent="saveHistory"
        >
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UFormField label="Edad gestacional (semanas)">
              <UInputNumber
                v-model="history.gestationWeeks"
                :min="20"
                :max="43"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Días adicionales">
              <UInputNumber
                v-model="history.gestationExtraDays"
                :min="0"
                :max="6"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Peso al nacer (kg)">
              <UInputNumber
                v-model="history.birthWeightKg"
                :min="0.1"
                :max="20"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Talla al nacer (cm)">
              <UInputNumber
                v-model="history.birthLengthCm"
                :min="0.1"
                :max="80"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Perímetro cefálico al nacer (cm)">
              <UInputNumber
                v-model="history.birthHeadCircumferenceCm"
                :min="0.1"
                :max="60"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField label="Notas perinatales">
            <UTextarea
              v-model="history.perinatalNotes"
              class="w-full"
            />
          </UFormField>
          <UCheckbox
            :model-value="history.correctionUntilMonths === 36"
            label="Prematuro extremo: corregir hasta 36 meses"
            @update:model-value="history.correctionUntilMonths = $event ? 36 : 24"
          />
          <UButton
            type="submit"
            variant="outline"
            class="min-h-11"
          >
            Guardar antecedentes
          </UButton>
        </form>
        <UAlert
          v-if="historyError"
          color="error"
          variant="soft"
          :description="historyError"
        />
      </UCard>
      <UCard
        v-if="pendingContacts?.length"
        class="space-y-4"
      >
        <h2 class="font-semibold">
          Contactos pendientes de vincular
        </h2>
        <div
          v-for="contact in pendingContacts"
          :key="contact.id"
          class="space-y-2 rounded-lg border border-default p-3"
        >
          <p class="font-medium">
            {{ contact.name }} · {{ contact.relationship }}
          </p>
          <p class="text-sm">
            {{ contact.phone }}<span v-if="contact.email"> · {{ contact.email }}</span>
          </p>
          <p class="text-sm text-muted">
            El vínculo no se registró. Verifique la identidad antes de reintentar; la familia aún no tiene acceso.
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Nombre del contacto">
              <UInput
                v-model="editableContact(contact).name"
                class="w-full"
                @update:model-value="contactChecked[contact.id] = false"
              />
            </UFormField>
            <UFormField label="Parentesco del contacto">
              <UInput
                v-model="editableContact(contact).relationship"
                class="w-full"
                @update:model-value="contactChecked[contact.id] = false"
              />
            </UFormField>
            <UFormField label="Teléfono del contacto">
              <UInput
                v-model="editableContact(contact).phone"
                type="tel"
                class="w-full"
                @update:model-value="contactChecked[contact.id] = false"
              />
            </UFormField>
            <UFormField label="Correo del contacto">
              <UInput
                v-model="editableContact(contact).email"
                type="email"
                class="w-full"
                @update:model-value="contactChecked[contact.id] = false"
              />
            </UFormField>
          </div>
          <UFormField label="Cómo verificó la corrección">
            <UTextarea
              v-model="editableContact(contact).proof"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="button"
            variant="outline"
            class="min-h-11"
            :aria-label="`Verificar identidad de ${contact.name}`"
            @click="checkPendingContact(contact)"
          >
            Verificar identidad
          </UButton>
          <p
            v-if="contactChecked[contact.id] && !contactMatches[contact.id]"
            role="status"
          >
            Sin cuenta previa
          </p>
          <div v-if="contactChecked[contact.id] && contactMatches[contact.id]">
            <p>Cuenta existente: {{ contactMatches[contact.id]?.name }} · {{ contactMatches[contact.id]?.maskedContact }}</p>
            <UCheckbox
              v-model="contactConfirmed[contact.id]"
              label="Confirmo que es la misma persona"
            />
          </div>
          <UButton
            type="button"
            class="min-h-11"
            :disabled="!contactChecked[contact.id] || Boolean(contactMatches[contact.id] && !contactConfirmed[contact.id])"
            :aria-label="`Reintentar vínculo de ${contact.name}`"
            @click="retryContact(contact)"
          >
            Reintentar vínculo
          </UButton>
          <UAlert
            v-if="contactErrors[contact.id]"
            color="error"
            variant="soft"
            :description="contactErrors[contact.id]"
          />
        </div>
      </UCard>
      <UCard>
        <h2 class="font-semibold">
          Acceso familiar
        </h2>
        <p
          v-if="!guardianStatus?.guardians.length"
          class="text-sm text-muted"
        >
          Sin invitar
        </p>
        <p
          v-for="guardian in guardianStatus?.guardians"
          :key="guardian.email"
          class="text-sm"
        >
          {{ guardian.email }} · {{ guardianLabel(guardian.status) }}<span v-if="guardian.lastSendError"> · Último error de envío: {{ guardian.lastSendError }}</span>
        </p>
      </UCard>
      <UAlert
        v-if="shareError"
        color="error"
        variant="soft"
        :title="shareError"
      />
      <UCard
        v-if="data.visits.length"
        class="space-y-3"
      >
        <h2 class="font-semibold">
          Compartir con la familia
        </h2>
        <div
          v-for="item in data.visits"
          :key="item.id"
          class="flex flex-wrap items-center justify-between gap-2 border-t border-default py-2"
        >
          <span>{{ dateFormat.format(new Date(item.measuredAt)) }}</span>
          <UButton
            variant="outline"
            :aria-label="`${sharing[item.id] ?? sharingState?.[item.id] ?? item.shareWithFamily ? 'Dejar de compartir' : 'Compartir'} visita del ${dateFormat.format(new Date(item.measuredAt))}`"
            @click="changeSharing(item.id, !(sharing[item.id] ?? sharingState?.[item.id] ?? item.shareWithFamily))"
          >
            {{ (sharing[item.id] ?? sharingState?.[item.id] ?? item.shareWithFamily) ? 'Compartida · cambiar' : 'No compartida · cambiar' }}
          </UButton>
        </div>
      </UCard>
      <UEmpty
        v-if="!latest"
        icon="i-lucide-clipboard-list"
        title="Aún no hay mediciones"
        description="Registre la primera visita para ver los resultados."
        :actions="[{ label: 'Registrar primera visita', to: `/pacientes/${id}/visitas/nueva` }]"
      />
      <template v-else>
        <section
          aria-label="Última visita"
          class="space-y-3"
        >
          <h2 class="text-lg font-semibold">
            Última visita · {{ dateFormat.format(new Date(latest.measuredAt)) }}
          </h2>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UCard>
              <p class="text-sm text-muted">
                Peso
              </p><p class="text-xl font-semibold tabular-nums">
                {{ weightFormat.format(latest.weightKg) }} kg
              </p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">
                {{ latest.position === 'RECUMBENT' ? 'Longitud acostada' : 'Talla de pie' }}
              </p><p class="text-xl font-semibold tabular-nums">
                {{ lengthFormat.format(latest.lengthHeightCm) }} cm
              </p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">
                Perímetro cefálico
              </p><p class="text-xl font-semibold tabular-nums">
                {{ lengthFormat.format(latest.headCircumferenceCm) }} cm
              </p>
            </UCard>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UCard
              v-for="result in latestResults"
              :key="result.id"
            >
              <h3 class="text-sm font-medium">
                {{ labels[result.indicator as WhoIndicator] }}
              </h3>
              <p
                v-if="result.status === 'available'"
                class="mt-2 tabular-nums"
              >
                {{ formatGrowthValues(result.z, result.percentile) }}
              </p><p
                v-else
                class="mt-2 text-muted"
              >
                No disponible
              </p>
              <p
                v-if="result.status === 'available' && result.classification.name"
                class="text-sm"
              >
                {{ result.classification.name }}
              </p>
            </UCard>
          </div>
          <UCard v-if="recalculations.length">
            <h3 class="font-semibold">
              Resultados recalculados · revisión médica
            </h3>
            <p class="mt-1 text-sm text-muted">
              El registro original permanece sin cambios. Los resultados nuevos se muestran por separado y no se comparten automáticamente.
            </p>
            <div
              v-for="recalculationId in recalculations"
              :key="recalculationId"
              class="mt-3 space-y-2"
            >
              <p class="text-xs text-muted">
                Revisión {{ recalculationId }}
              </p>
              <ul class="grid gap-2 sm:grid-cols-2">
                <li
                  v-for="result in latest.results.filter(item => item.recalculationId === recalculationId)"
                  :key="result.id"
                  class="rounded-md border border-default p-2"
                >
                  <strong class="text-sm">{{ labels[result.indicator as WhoIndicator] }}</strong>
                  <p class="tabular-nums">
                    {{ result.status === 'available' ? formatGrowthValues(result.z, result.percentile) : 'No disponible' }}
                  </p>
                  <p
                    v-if="result.status === 'available'"
                    class="text-xs text-muted"
                  >
                    {{ result.reference.version }} · {{ result.reference.ageBasis === 'CORRECTED' ? 'Edad corregida' : 'Edad cronológica' }}
                  </p>
                </li>
              </ul>
            </div>
          </UCard>
        </section>
        <section class="space-y-3">
          <h2 class="text-lg font-semibold">
            Mediciones
          </h2><UCard>
            <div class="overflow-x-auto">
              <table
                aria-label="Mediciones"
                class="w-full min-w-[680px] text-left text-sm"
              >
                <thead>
                  <tr class="border-b border-default text-muted">
                    <th
                      scope="col"
                      class="p-3"
                    >
                      Fecha
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      Peso
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      Longitud/talla
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      P. cefálico
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      Z peso/edad · percentil
                    </th><th
                      scope="col"
                      class="p-3"
                    >
                      Registró
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in data.visits"
                    :key="item.id"
                    class="border-b border-default last:border-0"
                  >
                    <td class="p-3">
                      {{ dateFormat.format(new Date(item.measuredAt)) }}
                    </td><td class="p-3 tabular-nums">
                      {{ weightFormat.format(item.weightKg) }} kg
                    </td><td class="p-3 tabular-nums">
                      {{ lengthFormat.format(item.lengthHeightCm) }} cm
                    </td><td class="p-3 tabular-nums">
                      {{ lengthFormat.format(item.headCircumferenceCm) }} cm
                    </td><td class="p-3 tabular-nums">
                      <template
                        v-for="result in item.results.filter(result => result.parentResultId === null)"
                        :key="result.id"
                      >
                        <span v-if="result.indicator === WhoIndicator.WEIGHT_FOR_AGE">{{ result.status === 'available' ? formatGrowthValues(result.z, result.percentile) : 'No disponible' }}</span>
                      </template>
                    </td><td class="p-3">
                      {{ item.authorId }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>
        </section>
        <UCard
          v-if="latest.clinicianTrend || latest.parentAdvice || latest.privateNote"
          class="space-y-2"
        >
          <h2 class="font-semibold">
            Notas de la visita
          </h2><p v-if="latest.clinicianTrend">
            Tendencia indicada por el profesional: {{ latest.clinicianTrend }}
          </p><p v-if="latest.parentAdvice">
            Recomendaciones para la familia: {{ latest.parentAdvice }}
          </p><p v-if="latest.privateNote">
            Nota clínica privada: {{ latest.privateNote }}
          </p>
        </UCard>
      </template>
    </template>
  </UContainer>
</template>
