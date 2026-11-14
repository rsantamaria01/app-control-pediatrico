<script setup lang="ts">
import type { GuardianGrant } from '../../../server/services/invitations'

const search = ref('')
const selected = ref<{ id: string, name: string } | null>(null)
const contact = reactive({ name: '', email: '', phone: '', relationship: '', proof: '' })
const identity = ref<{ id: string, name: string, maskedContact: string } | null>(null)
const identityChecked = ref(false)
const confirmed = ref(false)
const verifiedEmail = ref('')
watch(() => [contact.email, contact.phone], () => {
  identity.value = null
  identityChecked.value = false
  verifiedEmail.value = ''
  confirmed.value = false
})
async function checkIdentity() {
  const email = contact.email.trim().toLowerCase()
  const phone = contact.phone.trim()
  identityChecked.value = false
  try {
    const match = await $fetch('/api/guardian-grants/identity', { query: { ...(email ? { email } : {}), ...(phone ? { phone } : {}) } })
    if (contact.email.trim().toLowerCase() !== email || contact.phone.trim() !== phone) return
    identity.value = match
    verifiedEmail.value = `${email}|${phone}`
    identityChecked.value = true
  } catch {
    status.value = 'No se pudo verificar la identidad. Inténtelo otra vez.'
  }
}
const status = ref('')
const initialPatient = useRoute().query.patient
const pending = ref(false)
const candidates = ref<{ id: string, name: string, guardians: { email: string, status: string, lastSendError: string | null }[] }[]>([])
function label(status: string) {
  return status === 'ACTIVE' ? 'Activo' : status === 'PENDING' ? 'Pendiente de activación' : 'Sin invitar'
}
const error = ref(false)
async function refresh() {
  error.value = false
  try {
    candidates.value = search.value.trim().length >= 2 ? await $fetch('/api/guardian-grants', { query: { q: search.value } }) : []
  } catch {
    candidates.value = []
    error.value = true
  }
}
watch(search, () => {
  void refresh()
})
if (typeof initialPatient === 'string') {
  const { data: initial } = await useFetch<{ id: string, name: string, guardians: { email: string, status: string, lastSendError: string | null }[] }>(`/api/guardian-grants/${encodeURIComponent(initialPatient)}`)
  if (initial.value) {
    selected.value = { id: initial.value.id, name: initial.value.name }
    candidates.value = [initial.value]
  }
}

async function submit() {
  if (!selected.value || pending.value || !identityChecked.value || verifiedEmail.value !== `${contact.email.trim().toLowerCase()}|${contact.phone.trim()}` || (identity.value && !confirmed.value)) return
  pending.value = true
  status.value = ''
  try {
    const result = await $fetch<GuardianGrant>('/api/guardian-grants', { method: 'POST', body: { patientId: selected.value.id, contact: { name: contact.name, proof: contact.proof, ...(contact.email ? { email: contact.email } : {}), ...(contact.phone ? { phone: contact.phone } : {}), ...(contact.relationship ? { relationship: contact.relationship } : {}), ...(identity.value ? { confirmedGuardianId: identity.value.id } : {}) } } })
    status.value = !contact.email ? 'Vínculo registrado. Sin invitar: agregue un correo para enviar la invitación.' : result.status === 'FAILED' ? 'No se pudo entregar la invitación. Puede reintentar.' : result.status === 'ACTIVE' ? 'Acceso habilitado para la persona verificada.' : 'Invitación pendiente de aceptación.'
    await refresh()
  } catch {
    status.value = 'No se pudo registrar la invitación. Inténtelo otra vez.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-2xl space-y-6 py-8 pb-24">
    <h1 class="text-2xl font-semibold">
      Invitar representante
    </h1>
    <p class="text-muted">
      Verifique el vínculo familiar antes de enviar una invitación.
    </p>
    <UCard class="space-y-4">
      <UFormField label="Buscar niño o niña">
        <UInput
          v-model="search"
          class="w-full"
          placeholder="Nombre"
        />
      </UFormField>
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        title="No se pudo buscar"
        :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
      />
      <ul
        v-if="search.length >= 2"
        class="divide-y divide-default"
      >
        <li
          v-for="child in candidates"
          :key="child.id"
          class="py-2"
        >
          <UButton
            variant="ghost"
            class="min-h-11"
            :aria-pressed="selected?.id === child.id"
            @click="selected = { id: child.id, name: child.name }"
          >
            {{ child.name }}
          </UButton>
          <p
            v-for="guardian in child.guardians"
            :key="guardian.email"
            class="pl-3 text-sm text-muted"
          >
            {{ guardian.email }} · {{ label(guardian.status) }}<span v-if="guardian.lastSendError"> · Último error de envío: {{ guardian.lastSendError }}</span>
          </p>
        </li>
      </ul>
    </UCard>
    <UCard
      v-if="selected"
      class="space-y-4"
    >
      <h2 class="text-lg font-semibold">
        Representante de {{ selected.name }}
      </h2>
      <form
        class="space-y-4"
        @submit.prevent="submit"
      >
        <UFormField
          label="Nombre del representante"
          required
        >
          <UInput
            v-model="contact.name"
            class="w-full"
            required
          />
        </UFormField>
        <UFormField
          label="Correo del representante (para enviar invitación)"
        >
          <UInput
            v-model="contact.email"
            type="email"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Teléfono / WhatsApp (si no hay correo)">
          <UInput
            v-model="contact.phone"
            type="tel"
            class="w-full"
            placeholder="09XXXXXXXX"
          />
        </UFormField>
        <UFormField label="Parentesco">
          <UInput
            v-model="contact.relationship"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="button"
          variant="outline"
          :disabled="!contact.email && !contact.phone"
          @click="checkIdentity"
        >
          Verificar representante
        </UButton>
        <p
          v-if="identityChecked && !identity"
          class="text-sm"
        >
          Sin cuenta previa · Sin invitar
        </p>
        <div
          v-if="identity"
          class="space-y-2 rounded-md border border-default p-3"
        >
          <p>Cuenta existente: {{ identity.name }} · {{ identity.maskedContact }}</p>
          <UCheckbox
            v-model="confirmed"
            label="Confirmo que es la misma persona"
          />
        </div>
        <UFormField
          label="Cómo verificó el vínculo"
          required
          description="Registre la evidencia comprobada; no introduzca datos clínicos."
        >
          <UTextarea
            v-model="contact.proof"
            class="w-full"
            required
          />
        </UFormField>
        <UButton
          type="submit"
          :loading="pending"
          :disabled="!identityChecked || verifiedEmail !== `${contact.email.trim().toLowerCase()}|${contact.phone.trim()}` || Boolean(identity && !confirmed)"
        >
          {{ !contact.email ? 'Registrar representante sin invitar' : candidates.find(child => child.id === selected?.id)?.guardians.some(guardian => guardian.email === contact.email) ? 'Reenviar invitación' : 'Registrar y enviar invitación' }}
        </UButton>
      </form>
      <p
        v-if="status"
        role="status"
      >
        {{ status }}
      </p>
    </UCard>
  </UContainer>
</template>
