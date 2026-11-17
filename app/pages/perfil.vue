<script setup lang="ts">
type NoticePreferences = { inApp: true, email: boolean, whatsapp: boolean }
const { data, error, status, refresh } = await useFetch<NoticePreferences>('/api/avisos/preferencias')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
const saving = ref(false)
const saveError = ref(false)
const saved = ref(false)
async function updatePreference(channel: 'email' | 'whatsapp', event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.checked
  saving.value = true
  saveError.value = false
  saved.value = false
  try {
    data.value = await $fetch<NoticePreferences>('/api/avisos/preferencias', { method: 'PUT', body: { [channel]: value } })
    saved.value = true
  } catch {
    input.checked = data.value?.[channel] ?? false
    saveError.value = true
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-3xl space-y-6 py-8 pb-24">
    <h1 class="text-2xl font-semibold">
      Preferencias de avisos
    </h1>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudieron cargar las preferencias"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending' || !data"
      aria-label="Cargando preferencias de avisos"
    >
      <USkeleton class="h-48 w-full" />
    </div>
    <template v-else>
      <UAlert
        v-if="saveError"
        color="error"
        variant="soft"
        title="No se pudo guardar la preferencia. Inténtelo de nuevo."
        role="alert"
      />
      <UAlert
        v-else-if="saved"
        color="success"
        variant="soft"
        title="Preferencia guardada"
        role="status"
      />
      <UCard>
        <fieldset
          class="space-y-4"
          :disabled="saving"
        >
          <legend class="text-lg font-semibold">
            Recordatorios
          </legend>
          <p class="text-sm text-muted">
            Usted decide si desea recibir recordatorios por correo o WhatsApp. Activar un canal no garantiza que se envíen mensajes.
          </p>
          <label class="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              :checked="data.email"
              @change="updatePreference('email', $event)"
            >
            Recibir recordatorios por correo electrónico
          </label>
          <label class="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              :checked="data.whatsapp"
              @change="updatePreference('whatsapp', $event)"
            >
            Recibir recordatorios por WhatsApp
          </label>
          <p class="text-sm text-muted">
            Los dos canales están desactivados hasta que usted los autorice. Los avisos en la aplicación siempre están disponibles.
          </p>
        </fieldset>
      </UCard>
    </template>
    <div class="flex flex-wrap gap-3">
      <UButton
        to="/perfil/mis-datos"
        variant="outline"
        class="min-h-11"
      >
        Mis datos
      </UButton>
      <UButton
        to="/privacidad"
        variant="outline"
        class="min-h-11"
      >
        Privacidad
      </UButton>
    </div>
    <UButton
      to="/avisos"
      variant="outline"
      class="min-h-11"
    >
      Ver avisos
    </UButton>
  </UContainer>
</template>
