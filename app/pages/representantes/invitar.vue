<script setup lang="ts">
import type { GuardianGrant } from '../../../server/services/invitations'

const search = ref('')
const selected = ref<{ id: string, name: string } | null>(null)
const contact = reactive({ name: '', email: '', proof: '' })
const status = ref('')
const pending = ref(false)
const candidates = ref<{ id: string, name: string, guardians: { email: string, status: string }[] }[]>([])
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

async function submit() {
  if (!selected.value || pending.value) return
  pending.value = true
  status.value = ''
  try {
    const result = await $fetch<GuardianGrant>('/api/guardian-grants', { method: 'POST', body: { patientId: selected.value.id, contact } })
    status.value = result.status === 'FAILED' ? 'No se pudo entregar la invitación. Puede reintentar.' : result.status === 'ACTIVE' ? 'Acceso habilitado para la persona verificada.' : 'Invitación pendiente de aceptación.'
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
            {{ guardian.email }} · {{ guardian.status }}
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
          label="Correo del representante"
          required
        >
          <UInput
            v-model="contact.email"
            type="email"
            class="w-full"
            required
          />
        </UFormField>
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
        >
          Registrar y enviar invitación
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
