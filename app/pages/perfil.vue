<script setup lang="ts">
type NoticePreferences = { inApp: true, email: boolean, whatsapp: boolean }
const { data, error, status, refresh } = await useFetch<NoticePreferences>('/api/avisos/preferencias')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
const saving = ref(false)
const saveError = ref(false)
const saved = ref(false)
const colorMode = useColorMode()
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
  <UContainer class="max-w-3xl px-0 pb-24 sm:px-4 sm:py-6">
    <header class="flex min-h-14 items-center border-b border-default bg-default px-4 sm:rounded-t-xl sm:border-x sm:border-t">
      <h1 class="text-base font-semibold">
        Perfil
      </h1>
    </header>
    <div class="space-y-4 px-4 pt-4">
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
        <section class="overflow-hidden rounded-xl border border-default bg-default">
          <fieldset :disabled="saving">
            <legend class="px-4 py-3 text-sm font-bold">
              Recordatorios
            </legend>
            <p class="px-4 pb-2 text-xs text-muted">
              Active los canales que prefiera. Los mensajes externos dependen de su disponibilidad.
            </p>
            <label class="flex min-h-13 items-center justify-between gap-3 border-t border-default px-4">
              <span>Email</span>
              <input
                type="checkbox"
                :checked="data.email"
                class="size-5 accent-primary"
                @change="updatePreference('email', $event)"
              >
            </label>
            <label class="flex min-h-13 items-center justify-between gap-3 border-t border-default px-4">
              <span>WhatsApp</span>
              <input
                type="checkbox"
                :checked="data.whatsapp"
                class="size-5 accent-primary"
                @change="updatePreference('whatsapp', $event)"
              >
            </label>
            <div class="flex min-h-13 items-center justify-between gap-3 border-t border-default px-4">
              <span>En la app</span>
              <UBadge
                color="primary"
                variant="soft"
              >
                Siempre activo
              </UBadge>
            </div>
          </fieldset>
        </section>
        <section class="rounded-xl border border-default bg-default p-4">
          <h2 class="mb-2 text-sm font-bold">
            Apariencia
          </h2>
          <div
            class="flex rounded-lg bg-elevated p-1"
            role="group"
            aria-label="Tema"
          >
            <button
              v-for="option in [{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }, { value: 'system', label: 'Sistema' }]"
              :key="option.value"
              type="button"
              :aria-pressed="colorMode.preference === option.value"
              class="min-h-10 flex-1 rounded-md text-sm focus-visible:outline-2 focus-visible:outline-primary"
              :class="colorMode.preference === option.value ? 'bg-default font-semibold shadow-sm' : 'text-muted'"
              @click="colorMode.preference = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </section>
      </template>
      <UButton
        to="/avisos"
        variant="outline"
        class="min-h-11"
      >
        Ver avisos
      </UButton>
    </div>
  </UContainer>
</template>
