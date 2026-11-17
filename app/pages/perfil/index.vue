<script setup lang="ts">
type NoticePreferences = { inApp: true, email: boolean, whatsapp: boolean }
const { data: navigation, error: navigationError, refresh: refreshNavigation } = await useFetch<{ to: string }[]>('/api/auth/navigation', { default: () => [] })
const isStaff = computed(() => navigation.value.some(item => item.to === '/pacientes' || item.to === '/agenda' || item.to.startsWith('/admin/')))
const isParent = computed(() => !navigationError.value && !isStaff.value && navigation.value.some(item => item.to === '/citas'))
const { data, error, status, refresh } = await useFetch<NoticePreferences>('/api/avisos/preferencias', { enabled: isParent })
const accessError = navigationError.value?.statusCode ?? error.value?.statusCode
if (import.meta.server && (accessError === 401 || accessError === 403)) throw createError({ statusCode: accessError, statusMessage: 'Acceso denegado' })
watch(isParent, async (allowed) => {
  if (allowed) await refresh()
})
const { signOut } = useUserSession()
const loggingOut = ref(false)
async function logout() {
  loggingOut.value = true
  try {
    await signOut({ onSuccess: async () => {
      await refreshNavigation()
      await navigateTo('/acceso')
    } })
  } finally {
    loggingOut.value = false
  }
}
const saving = ref(false)
const saveError = ref(false)
const saved = ref(false)
const colorMode = useColorMode()
async function updatePreference(channel: 'email' | 'whatsapp', event: Event) {
  if (!isParent.value) return
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
  <UContainer class="max-w-3xl space-y-4 px-4 py-5 pb-24 sm:px-6">
    <header class="flex min-h-11 items-center">
      <h1 class="text-xl font-semibold">
        Perfil
      </h1>
    </header>
    <div class="space-y-4">
      <UAlert
        v-if="navigationError"
        color="error"
        variant="soft"
        title="No se pudo verificar el acceso"
        :actions="[{ label: 'Reintentar', onClick: () => refreshNavigation() }]"
      />
      <UAlert
        v-else-if="isParent && error"
        color="error"
        variant="soft"
        title="No se pudieron cargar las preferencias"
        :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
      />
      <div
        v-else-if="isParent && (status === 'pending' || !data)"
        aria-label="Cargando preferencias de avisos"
      >
        <USkeleton class="h-48 w-full" />
      </div>
      <template v-if="isParent && data && !error && !navigationError">
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
      </template>
      <UEmpty
        v-if="isStaff && !navigationError"
        icon="i-lucide-bell-off"
        title="Notificaciones no disponibles"
        description="Los recordatorios del portal son solo para representantes. Las preferencias de avisos del personal aún no están disponibles."
      />
      <section
        v-if="!navigationError && ((isParent && data && !error) || isStaff)"
        class="rounded-xl border border-default bg-default p-4"
      >
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
      <div
        v-if="!navigationError && ((isParent && data && !error) || isStaff)"
        class="flex flex-wrap gap-3"
      >
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
        v-if="isStaff && !navigationError"
        variant="ghost"
        color="neutral"
        :loading="loggingOut"
        class="min-h-11"
        @click="logout"
      >
        Cerrar sesión
      </UButton>
      <UButton
        v-if="isParent && !navigationError"
        to="/avisos"
        variant="outline"
        class="min-h-11"
      >
        Ver avisos
      </UButton>
    </div>
  </UContainer>
</template>
