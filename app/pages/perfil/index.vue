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
const { user, signOut } = useUserSession()
const roles = computed(() => [navigation.value.some(item => item.to === '/admin/clinica') && 'Administración', navigation.value.some(item => item.to === '/pacientes') && 'Pediatra', navigation.value.some(item => item.to === '/agenda' && !navigation.value.some(link => link.to === '/pacientes')) && 'Asistente'].filter(Boolean).join(' · '))
const passwordOpen = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const passwordError = ref('')
const passwordSaved = ref(false)
const changingPassword = ref(false)
async function changePassword() {
  passwordError.value = ''
  passwordSaved.value = false
  changingPassword.value = true
  try {
    await $fetch('/api/auth/change-password', { method: 'POST', body: { currentPassword: currentPassword.value, newPassword: newPassword.value, revokeOtherSessions: false } })
    currentPassword.value = ''
    newPassword.value = ''
    passwordOpen.value = false
    passwordSaved.value = true
  } catch {
    passwordError.value = 'No se pudo cambiar la contraseña. Revise la contraseña actual y los requisitos.'
  } finally {
    changingPassword.value = false
  }
}
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
      <section v-if="isStaff && !navigationError" class="rounded-xl border border-default bg-default p-4">
        <div class="flex items-center gap-4">
          <UAvatar :text="user?.name?.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'CP'" size="xl" />
          <div class="min-w-0"><h2 class="text-lg font-semibold">{{ user?.name }}</h2><p class="text-sm text-muted">{{ roles }}</p></div>
        </div>
        <dl class="mt-4 grid gap-3 border-t border-default pt-4 text-sm sm:grid-cols-2">
          <div><dt class="text-muted">Usuario</dt><dd class="font-medium">{{ user?.username || '—' }}</dd></div>
          <div><dt class="text-muted">Correo electrónico</dt><dd class="break-all font-medium">{{ user?.email || '—' }}</dd></div>
        </dl>
      </section>
      <section v-if="isStaff && !navigationError" class="rounded-xl border border-default bg-default p-4">
        <h2 class="font-semibold">Seguridad</h2>
        <UAlert v-if="passwordError" color="error" variant="soft" :title="passwordError" class="my-3" />
        <UAlert v-if="passwordSaved" color="success" variant="soft" title="Contraseña actualizada" class="my-3" />
        <UButton v-if="!passwordOpen" variant="outline" color="neutral" class="mt-3 min-h-11" @click="passwordOpen = true">Cambiar contraseña</UButton>
        <form v-else class="mt-3 space-y-3" @submit.prevent="changePassword">
          <UFormField label="Contraseña actual" required><UInput v-model="currentPassword" type="password" autocomplete="current-password" required class="w-full" /></UFormField>
          <UFormField label="Nueva contraseña" description="Use al menos 12 caracteres." required><UInput v-model="newPassword" type="password" autocomplete="new-password" required minlength="12" class="w-full" /></UFormField>
          <div class="flex gap-2"><UButton type="submit" :loading="changingPassword" class="min-h-11">Guardar contraseña</UButton><UButton variant="ghost" color="neutral" class="min-h-11" @click="passwordOpen = false">Cancelar</UButton></div>
        </form>
      </section>
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
         variant="outline"
         color="error"
         icon="i-lucide-log-out"
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
