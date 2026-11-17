<script setup lang="ts">
import type { PatientView, VisitSnapshot } from '#shared/types/measurement'
import type { ChartView } from '#shared/utils/chart-data'
import { ecuadorIdSchema } from '#shared/types/patient-registration'
import { formatGrowthValues } from '#shared/utils/growth-result'
import { WhoIndicator } from '#shared/utils/enums'

const route = useRoute()
const id = route.params.id as string
const { data, error, refresh } = await useFetch<{ patient: PatientView, visits: VisitSnapshot[] }>(`/api/pacientes/${encodeURIComponent(id)}`)
const { data: navigation } = await useFetch<{ to: string }[]>('/api/auth/navigation')
const isDoctor = computed(() => navigation.value?.some(item => item.to === '/pacientes') ?? false)
const latest = computed(() => data.value?.visits[0])
const { data: growth } = await useFetch<{ charts: Partial<Record<WhoIndicator, ChartView>> }>(`/api/pacientes/${encodeURIComponent(id)}/crecimiento`, { immediate: isDoctor.value })
const chartIndicator = ref<WhoIndicator>(WhoIndicator.WEIGHT_FOR_AGE)
const showGrowthTable = ref(false)
const chartIndicators = [WhoIndicator.WEIGHT_FOR_AGE, WhoIndicator.HEIGHT_FOR_AGE, WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE, WhoIndicator.BMI_FOR_AGE, WhoIndicator.WEIGHT_FOR_LENGTH, WhoIndicator.WEIGHT_FOR_HEIGHT]
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
    const result = await $fetch<{ status: string }>(`/api/pacientes/${encodeURIComponent(id)}/contactos-pendientes/${encodeURIComponent(contact.id)}`, { method: 'POST', body: { ...(contactMatches[contact.id] ? { confirmedGuardianId: contactMatches[contact.id]!.id } : {}), ...(changed ? { name: edit.name, relationship: edit.relationship, phone: edit.phone, email: edit.email, proof: edit.proof } : {}) } })
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
const patientSection = ref<'crecimiento' | 'visitas' | 'vacunas' | 'desarrollo' | 'controles' | 'antecedentes' | 'acceso'>('crecimiento')
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const birthFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const age = computed(() => {
  const birthDate = data.value?.patient.birthDate
  if (!birthDate) return ''
  const [year, month, day] = birthDate.split('-').map(Number)
  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number)
  const months = Math.max(0, (today[0]! - year!) * 12 + today[1]! - month! - (today[2]! < day! ? 1 : 0))
  return months < 12 ? `${months} meses` : `${Math.floor(months / 12)} años ${months % 12} meses`
})
const initials = computed(() => data.value?.patient.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() ?? '')
const indicatorValues = computed(() => latestResults.value.map(result => ({
  result,
  value: result.indicator === WhoIndicator.WEIGHT_FOR_AGE || result.indicator === WhoIndicator.WEIGHT_FOR_LENGTH || result.indicator === WhoIndicator.WEIGHT_FOR_HEIGHT ? `${weightFormat.format(latest.value!.weightKg)} kg` : result.indicator === WhoIndicator.HEIGHT_FOR_AGE ? `${lengthFormat.format(latest.value!.lengthHeightCm)} cm` : result.indicator === WhoIndicator.HEAD_CIRCUMFERENCE_FOR_AGE ? `${lengthFormat.format(latest.value!.headCircumferenceCm)} cm` : `${lengthFormat.format(latest.value!.bmi)} kg/m²`
})))
</script>

<template>
  <UContainer class="max-w-[1240px] space-y-5 py-4 pb-24 lg:py-6">
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
        class="hidden items-center gap-2 text-sm text-muted lg:flex"
      >
        <NuxtLink
          to="/pacientes"
          class="hover:text-primary hover:underline"
        >Pacientes</NuxtLink>
        <UIcon
          name="i-lucide-chevron-right"
          aria-hidden="true"
          class="size-4"
        />
        <span class="font-semibold text-default">{{ data.patient.name }}</span>
      </nav>
      <div class="flex items-center gap-2 lg:hidden">
        <UButton
          to="/pacientes"
          icon="i-lucide-chevron-left"
          variant="ghost"
          color="neutral"
          aria-label="Volver a pacientes"
          class="min-h-11 min-w-11"
        />
        <h1 class="min-w-0 flex-1 truncate font-semibold">
          {{ data.patient.name }}
        </h1>
      </div>
      <UCard :ui="{ body: 'p-4 sm:p-5' }">
        <div class="flex flex-wrap items-start gap-4 sm:gap-5">
          <UAvatar
            :text="initials"
            size="xl"
            class="hidden shrink-0 sm:flex"
          />
          <div class="min-w-0 flex-1 space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="hidden text-2xl font-bold text-default sm:block">
                {{ data.patient.name }}
              </h1>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ data.patient.sex === 'FEMALE' ? 'Niña' : 'Niño' }}
              </UBadge>
              <UBadge
                v-if="data.patient.gestationDays !== undefined"
                :color="data.patient.gestationDays < 259 ? 'primary' : 'neutral'"
                variant="soft"
              >
                {{ data.patient.gestationDays < 259 ? 'Prematuro' : 'A término' }} · {{ Math.floor(data.patient.gestationDays / 7) }}+{{ data.patient.gestationDays % 7 }} sem
              </UBadge>
              <UBadge
                class="sm:hidden"
                color="neutral"
                variant="soft"
              >
                {{ age }}
              </UBadge>
            </div>
            <dl class="hidden flex-wrap gap-x-8 gap-y-3 text-sm sm:flex">
              <div>
                <dt class="text-muted">
                  Edad
                </dt><dd class="font-semibold">
                  {{ age }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">
                  Nacimiento
                </dt><dd class="font-semibold">
                  {{ birthFormat.format(new Date(`${data.patient.birthDate}T12:00:00Z`)) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">
                  Cédula
                </dt><dd class="font-semibold">
                  {{ data.patient.nationalId ?? 'Sin registrar' }}
                </dd>
              </div>
              <div v-if="latest">
                <dt class="text-muted">
                  Última visita
                </dt><dd class="font-semibold">
                  {{ dateFormat.format(new Date(latest.measuredAt)) }}
                </dd>
              </div>
              <div v-if="latest?.nextControlAt">
                <dt class="text-muted">
                  Próximo control
                </dt><dd class="font-semibold">
                  {{ dateFormat.format(new Date(latest.nextControlAt)) }}
                </dd>
              </div>
            </dl>
            <p
              v-if="guardianStatus?.guardians.length"
              class="hidden text-sm text-muted sm:block"
            >
              Acceso familiar: {{ guardianStatus.guardians.map(guardian => `${guardian.email} · ${guardianLabel(guardian.status)}`).join(' · ') }}
            </p>
          </div>
          <div class="flex w-full flex-wrap gap-2 xl:w-auto">
            <UButton
              :to="`/pacientes/${id}/visitas/nueva`"
              icon="i-lucide-plus"
              class="min-h-11 flex-1 justify-center sm:flex-none"
            >
              Nueva visita
            </UButton>
            <UButton
              to="/agenda"
              icon="i-lucide-calendar-days"
              variant="outline"
              color="neutral"
              aria-label="Agendar cita"
              class="min-h-11 sm:hidden"
            />
            <UButton
              to="/agenda"
              icon="i-lucide-calendar-days"
              variant="outline"
              color="neutral"
              class="hidden min-h-11 sm:inline-flex"
            >
              Agendar cita
            </UButton>
            <UButton
              :to="`/pacientes/${id}/informe`"
              icon="i-lucide-file-text"
              variant="outline"
              color="neutral"
              aria-label="Informe PDF"
              class="min-h-11 sm:hidden"
            />
            <UButton
              :to="`/pacientes/${id}/informe`"
              icon="i-lucide-file-text"
              variant="outline"
              color="neutral"
              class="hidden min-h-11 sm:inline-flex"
            >
              Informe PDF
            </UButton>
          </div>
        </div>
      </UCard>
      <section
        v-if="latest && latestResults.length && patientSection === 'crecimiento'"
        aria-label="Resumen por indicador"
        class="flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible"
      >
        <button
          v-for="entry in indicatorValues"
          :key="entry.result.id"
          type="button"
          class="min-w-40 flex-1 space-y-2 rounded-xl border border-default bg-default p-3 text-left focus-visible:outline-2 focus-visible:outline-primary lg:min-w-0"
          :class="chartIndicator === entry.result.indicator ? 'border-primary' : ''"
          :aria-pressed="chartIndicator === entry.result.indicator"
          @click="chartIndicator = entry.result.indicator as WhoIndicator"
        >
          <span class="block text-xs font-medium text-muted">{{ labels[entry.result.indicator as WhoIndicator] }}</span>
          <span class="block text-xl font-bold tabular-nums">{{ entry.value }}</span>
          <span
            v-if="entry.result.status === 'available'"
            class="block text-sm tabular-nums"
          >{{ formatGrowthValues(entry.result.z, entry.result.percentile) }}</span>
          <span
            v-else
            class="block text-sm text-muted"
          >No disponible</span>
          <UBadge
            v-if="entry.result.status === 'available' && entry.result.classification.name"
            :color="entry.result.classification.tone === 'neutral' ? 'neutral' : 'warning'"
            variant="soft"
            class="max-w-full whitespace-normal"
          >
            {{ entry.result.classification.name }}
          </UBadge>
        </button>
      </section>
      <div class="min-w-0 overflow-hidden rounded-xl border border-default bg-default">
        <nav
          aria-label="Secciones del paciente"
          class="flex gap-1 overflow-x-auto border-b border-default px-3"
        >
          <button
            v-for="section in ([['crecimiento', 'Crecimiento'], ['visitas', 'Visitas'], ['vacunas', 'Vacunas'], ['desarrollo', 'Hitos'], ['controles', 'Controles'], ['antecedentes', 'Antecedentes'], ['acceso', 'Acceso familiar']] as const)"
            :key="section[0]"
            type="button"
            class="min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary"
            :class="patientSection === section[0] ? 'border-primary text-primary' : 'border-transparent text-muted'"
            :aria-pressed="patientSection === section[0]"
            @click="patientSection = section[0]"
          >
            {{ section[1] }}<span
              v-if="section[0] === 'visitas'"
              class="ml-1 text-xs"
            >{{ data.visits.length }}</span>
          </button>
        </nav>
      </div>
      <section
        v-if="patientSection === 'vacunas' || patientSection === 'desarrollo' || patientSection === 'controles'"
        aria-label="Seguimiento preventivo"
      >
        <PatientsVaccinesTab
          v-if="patientSection === 'vacunas'"
          :patient-id="id"
        />
        <PatientsMilestonesTab
          v-if="patientSection === 'desarrollo'"
          :patient-id="id"
        />
        <PatientsCheckupsTab
          v-if="patientSection === 'controles'"
          :patient-id="id"
        />
      </section>
      <UAlert
        v-if="patientWarning"
        color="warning"
        variant="soft"
        :description="patientWarning"
      />
      <div
        v-if="patientSection === 'antecedentes' || patientSection === 'acceso'"
        class="space-y-5"
      >
        <UCard
          v-if="patientSection === 'antecedentes'"
          class="space-y-4"
        >
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
          v-if="patientSection === 'acceso' && pendingContacts?.length"
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
        <UCard v-if="patientSection === 'acceso'">
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
        <UButton
          v-if="patientSection === 'acceso'"
          :to="`/representantes/invitar?patient=${encodeURIComponent(id)}`"
          icon="i-lucide-user-plus"
          variant="outline"
          class="min-h-11"
        >
          Invitar representante
        </UButton>
        <UAlert
          v-if="patientSection === 'acceso' && shareError"
          color="error"
          variant="soft"
          :title="shareError"
        />
        <UCard
          v-if="patientSection === 'acceso' && data.visits.length"
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
      </div>
      <UEmpty
        v-if="!latest && (patientSection === 'crecimiento' || patientSection === 'visitas')"
        icon="i-lucide-clipboard-list"
        title="Aún no hay mediciones"
        description="Registre la primera visita para ver los resultados."
        :actions="[{ label: 'Registrar primera visita', to: `/pacientes/${id}/visitas/nueva` }]"
      />
      <template v-if="latest">
        <section
          v-if="patientSection === 'visitas'"
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
        <section
          v-if="patientSection === 'crecimiento'"
          class="space-y-3"
          aria-label="Curvas de crecimiento"
        >
          <h2 class="text-lg font-semibold">
            Curvas de crecimiento OMS
          </h2>
          <div
            class="hidden gap-2 overflow-x-auto pb-1 sm:flex"
            role="group"
            aria-label="Indicador de crecimiento"
          >
            <UButton
              v-for="indicator in chartIndicators"
              :key="indicator"
              variant="outline"
              class="min-h-11 shrink-0"
              :aria-pressed="chartIndicator === indicator"
              @click="chartIndicator = indicator"
            >
              {{ labels[indicator] }}
            </UButton>
          </div>
          <div class="flex items-center gap-2 sm:hidden">
            <USelect
              v-model="chartIndicator"
              :items="chartIndicators.map(indicator => ({ label: labels[indicator], value: indicator }))"
              aria-label="Indicador de crecimiento"
              size="lg"
              class="min-w-0 flex-1"
            />
            <UButton
              variant="outline"
              class="min-h-11"
              :aria-pressed="showGrowthTable"
              @click="showGrowthTable = !showGrowthTable"
            >
              {{ showGrowthTable ? 'Gráfico' : 'Tabla' }}
            </UButton>
          </div>
          <UButton
            variant="outline"
            class="hidden min-h-11 sm:inline-flex"
            :aria-pressed="showGrowthTable"
            @click="showGrowthTable = !showGrowthTable"
          >
            {{ showGrowthTable ? 'Ver gráfico' : 'Ver tabla' }}
          </UButton>
          <div class="grid overflow-hidden rounded-xl border border-default bg-default xl:grid-cols-[minmax(0,1fr)_320px]">
            <div class="min-w-0 p-3 sm:p-5">
              <h3 class="mb-3 hidden text-base font-semibold sm:block">
                {{ labels[chartIndicator] }} · {{ data.patient.sex === 'FEMALE' ? 'Niña' : 'Niño' }}
              </h3>
              <template v-if="growth?.charts[chartIndicator]">
                <GrowthTable
                  v-if="showGrowthTable"
                  :view="growth.charts[chartIndicator]!"
                />
                <GrowthChart
                  v-else
                  :view="growth.charts[chartIndicator]!"
                />
              </template>
              <p
                v-else
                class="text-muted"
              >
                Referencia OMS no disponible.
              </p>
            </div>
            <aside
              class="space-y-4 border-t border-default p-4 xl:border-t-0 xl:border-l"
              aria-label="Resumen de la última visita"
            >
              <h3 class="font-semibold">
                Última visita · {{ dateFormat.format(new Date(latest.measuredAt)) }}
              </h3>
              <div class="text-sm">
                <p class="text-muted">
                  Medición
                </p>
                <p class="font-semibold tabular-nums">
                  {{ weightFormat.format(latest.weightKg) }} kg · {{ lengthFormat.format(latest.lengthHeightCm) }} cm {{ latest.position === 'RECUMBENT' ? 'acostado' : 'de pie' }} · PC {{ lengthFormat.format(latest.headCircumferenceCm) }} cm
                </p>
              </div>
              <div
                v-if="latest.parentAdvice"
                class="rounded-lg bg-primary/10 p-3 text-sm"
              >
                <p class="mb-1 font-semibold text-primary">
                  {{ (sharing[latest.id] ?? sharingState?.[latest.id] ?? latest.shareWithFamily) ? 'Visible para la familia' : 'No compartida con la familia' }}
                </p>
                <p>{{ latest.parentAdvice }}</p>
              </div>
              <div
                v-if="latest.privateNote"
                class="rounded-lg border border-dashed border-default p-3 text-sm"
              >
                <p class="mb-1 font-semibold text-muted">
                  Nota clínica privada
                </p>
                <p>{{ latest.privateNote }}</p>
              </div>
              <UButton
                variant="outline"
                color="neutral"
                class="min-h-11"
                @click="patientSection = 'visitas'"
              >
                Ver todas las visitas
              </UButton>
            </aside>
          </div>
        </section>
        <section
          v-if="patientSection === 'crecimiento' || patientSection === 'visitas'"
          class="space-y-3"
        >
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
          v-if="patientSection === 'visitas' && (latest.clinicianTrend || latest.parentAdvice || latest.privateNote)"
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
